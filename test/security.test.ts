import { afterEach, describe, expect, test } from "bun:test";
import { OllamaSecurityAgent, StaticSecurityAgent } from "../src/security/agent.ts";
import { SecurityEngine } from "../src/security/engine.ts";
import { evaluatePolicy } from "../src/security/policy.ts";
import { SecurityStore } from "../src/security/store.ts";
import type { SecurityRule, ToolCallContext } from "../src/security/types.ts";
import { cleanupVault } from "./helpers.ts";

const securityVault = "./test-security.sqlite";

afterEach(() => cleanupVault(securityVault));

function makeStore(): SecurityStore {
  return new SecurityStore(securityVault);
}

function baseRule(patch: Partial<SecurityRule> = {}): SecurityRule {
  return {
    id: patch.id ?? "rule_1",
    targetType: patch.targetType ?? "mcp_tool",
    targetName: patch.targetName ?? "filesystem.read_file",
    direction: patch.direction ?? "inout",
    effect: patch.effect ?? "allow_always_call",
    paramMatch: patch.paramMatch ?? {},
    scope: patch.scope ?? { type: "none", filesystem: [], network: false },
    priority: patch.priority ?? 0,
    createdAt: patch.createdAt ?? "now",
  };
}

function ctx(patch: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    targetType: patch.targetType ?? "mcp_tool",
    targetName: patch.targetName ?? "filesystem.read_file",
    direction: patch.direction ?? "in",
    input: patch.input ?? { path: "/Users/red/PIITool/README.md" },
    output: patch.output,
    metadata: patch.metadata,
  };
}

describe("Security policy", () => {
  test("supersafe inout allow rule permits matching tool", () => {
    const result = evaluatePolicy([baseRule()], ctx());
    expect(result.matched).toBe(true);
    expect(result.decision).toBe("allow");
  });

  test("parameter-specific rule only applies to matching path", () => {
    const rule = baseRule({ paramMatch: { path: { under: ["/Users/red/PIITool"] } } });
    expect(evaluatePolicy([rule], ctx({ input: { path: "/Users/red/PIITool/src/core.ts" } })).decision).toBe("allow");
    expect(evaluatePolicy([rule], ctx({ input: { path: "/etc/passwd" } })).matched).toBe(false);
  });

  test("deny high priority beats broad allow", () => {
    const allow = baseRule({ id: "allow", targetName: "*", effect: "allow_always_global", priority: 1 });
    const deny = baseRule({ id: "deny", effect: "deny_always_call", priority: 100 });
    const result = evaluatePolicy([allow, deny], ctx());
    expect(result.decision).toBe("deny");
    expect(result.rule?.id).toBe("deny");
  });
});

describe("SecurityEngine", () => {
  test("policy allow bypasses SecurityAgent", async () => {
    const store = makeStore();
    store.addRule(baseRule());
    const agent = new StaticSecurityAgent({ decision: "deny", riskLevel: "critical", reasons: ["should not run"] });
    const engine = new SecurityEngine(store, agent, { mode: "agent", timeoutMs: 50, defaultDecision: "pending_approval" });

    const result = await engine.evaluateIn(ctx());
    expect(result.decision).toBe("allow");
    expect(agent.calls.length).toBe(0);
    store.close();
  });

  test("non-supersafe input calls SecurityAgent allow", async () => {
    const store = makeStore();
    const agent = new StaticSecurityAgent({ decision: "allow", riskLevel: "low", reasons: ["ok"] });
    const engine = new SecurityEngine(store, agent, { mode: "agent", timeoutMs: 50, defaultDecision: "pending_approval" });

    const result = await engine.evaluateIn(ctx());
    expect(result.decision).toBe("allow");
    expect(agent.calls.length).toBe(1);
    store.close();
  });

  test("SecurityAgent deny blocks toolcall", async () => {
    const store = makeStore();
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "deny", riskLevel: "high", reasons: ["dangerous"] }),
      { mode: "agent", timeoutMs: 50, defaultDecision: "pending_approval" },
    );

    const result = await engine.evaluateIn(ctx());
    expect(result.decision).toBe("deny");
    expect(result.reasons).toContain("dangerous");
    store.close();
  });

  test("pending creates row and approve resolves waiter", async () => {
    const store = makeStore();
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "pending_approval", riskLevel: "medium", reasons: ["ask human"] }),
      { mode: "agent", timeoutMs: 500, defaultDecision: "pending_approval" },
    );

    const result = await engine.evaluateIn(ctx());
    expect(result.decision).toBe("pending_approval");
    expect(store.listPending("pending").length).toBe(1);

    const waiting = engine.waitForApproval(result.pendingId!);
    engine.approvePending(result.pendingId!);
    expect(await waiting).toBe("approved");
    store.close();
  });

  test("approve-always-call creates persisted allow rule", async () => {
    const store = makeStore();
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "pending_approval", riskLevel: "medium", reasons: ["ask human"] }),
      { mode: "agent", timeoutMs: 50, defaultDecision: "pending_approval" },
    );
    const result = await engine.evaluateIn(ctx());
    engine.approvePending(result.pendingId!, "allow_always_call");
    expect(store.listRules().some((rule) => rule.effect === "allow_always_call")).toBe(true);
    store.close();
  });

  test("output check can block return while input allowed", async () => {
    const store = makeStore();
    store.addRule(baseRule({ direction: "in", effect: "allow_always_call" }));
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "deny", riskLevel: "high", reasons: ["leaky output"] }),
      { mode: "agent", timeoutMs: 50, defaultDecision: "pending_approval" },
    );

    expect((await engine.evaluateIn(ctx())).decision).toBe("allow");
    expect((await engine.evaluateOut(ctx({ direction: "out", output: { secret: "x" } }))).decision).toBe("deny");
    store.close();
  });

  test("scope request is persisted in pending decision", async () => {
    const store = makeStore();
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({
        decision: "pending_approval",
        riskLevel: "medium",
        reasons: ["needs readonly fs"],
        requiredScope: { type: "readonly_fs", filesystem: ["/tmp"], network: false },
      }),
      { mode: "agent", timeoutMs: 50, defaultDecision: "pending_approval" },
    );

    const result = await engine.evaluateIn(ctx());
    const pending = store.getPending(result.pendingId!);
    expect(pending?.agentDecision.requiredScope?.type).toBe("readonly_fs");
    store.close();
  });
});

describe("SecurityAgent fallback", () => {
  test("OllamaSecurityAgent returns pending when local model unavailable", async () => {
    const agent = new OllamaSecurityAgent({
      baseUrl: "http://127.0.0.1:1",
      model: "missing",
      timeoutMs: 1,
      defaultDecision: "pending_approval",
    });
    const result = await agent.decide(ctx(), []);
    expect(result.decision).toBe("pending_approval");
    expect(result.reasons).toContain("security_agent_unavailable");
  });
});
