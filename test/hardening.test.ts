import { afterEach, describe, expect, test } from "bun:test";
import { SecurityEngine } from "../src/security/engine.ts";
import { SecurityStore } from "../src/security/store.ts";
import { StaticSecurityAgent } from "../src/security/agent.ts";
import { LegislatorService } from "../src/security/legislator.ts";
import { cleanupVault } from "./helpers.ts";

const vaultPath = "./test-hardening.sqlite";
afterEach(() => cleanupVault(vaultPath));

describe("H1: raw secret guard on policy allow", () => {
  test("raw secret in payload forces pending even with broad allow", async () => {
    const store = new SecurityStore(vaultPath);
    store.addRule({
      targetType: "mcp_tool",
      targetName: "config.write",
      direction: "in",
      effect: "allow_always_call",
      paramMatch: {},
      scope: { type: "none", filesystem: [], network: false },
      priority: 10,
    });
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "allow", riskLevel: "low", reasons: [] }),
      { mode: "policy", timeoutMs: 100, defaultDecision: "pending_approval" },
    );
    const result = await engine.evaluateIn({
      targetType: "mcp_tool",
      targetName: "config.write",
      input: { value: "sk-abcdefghijklmnop1234567" },
    });
    expect(result.decision).toBe("pending_approval");
    expect(result.reasons).toContain("secret_alias_requires_param_specific_approval");
    store.close();
  });

  test("params-specific rule allows raw secret through", async () => {
    const store = new SecurityStore(vaultPath);
    store.addRule({
      targetType: "mcp_tool",
      targetName: "config.write",
      direction: "in",
      effect: "allow_always_call_params",
      paramMatch: { value: { equals: "sk-abcdefghijklmnop1234567" } },
      scope: { type: "none", filesystem: [], network: false },
      priority: 10,
    });
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "allow", riskLevel: "low", reasons: [] }),
      { mode: "policy", timeoutMs: 100, defaultDecision: "pending_approval" },
    );
    const result = await engine.evaluateIn({
      targetType: "mcp_tool",
      targetName: "config.write",
      input: { value: "sk-abcdefghijklmnop1234567" },
    });
    expect(result.decision).toBe("allow");
    store.close();
  });
});

describe("H6: LLM can only escalate, never downgrade", () => {
  test("LLM allow is overridden to pending when secret alias present", async () => {
    const store = new SecurityStore(vaultPath);
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "allow", riskLevel: "low", reasons: ["safe_destination"] }),
      { mode: "agent", timeoutMs: 100, defaultDecision: "pending_approval" },
    );
    const result = await engine.evaluateIn({
      targetType: "mcp_tool",
      targetName: "email.send",
      input: { body: "PIITOOL_SECRET_abcdef123456" },
    });
    expect(result.decision).toBe("pending_approval");
    expect(result.reasons).toContain("llm_allow_overridden_secret_detected");
    store.close();
  });

  test("LLM deny is preserved even without secrets", async () => {
    const store = new SecurityStore(vaultPath);
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "deny", riskLevel: "high", reasons: ["dangerous"] }),
      { mode: "agent", timeoutMs: 100, defaultDecision: "pending_approval" },
    );
    const result = await engine.evaluateIn({
      targetType: "mcp_tool",
      targetName: "shell.exec",
      input: { cmd: "rm -rf /" },
    });
    expect(result.decision).toBe("deny");
    store.close();
  });

  test("LLM allow passes when no secrets present", async () => {
    const store = new SecurityStore(vaultPath);
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "allow", riskLevel: "low", reasons: ["safe"] }),
      { mode: "agent", timeoutMs: 100, defaultDecision: "pending_approval" },
    );
    const result = await engine.evaluateIn({
      targetType: "mcp_tool",
      targetName: "notes.read",
      input: { path: "/notes/todo.txt" },
    });
    expect(result.decision).toBe("allow");
    store.close();
  });
});

describe("H7: legislator guardrails", () => {
  test("rejects global allow-all rule creation", async () => {
    const store = new SecurityStore(vaultPath);
    const legislator = new LegislatorService(store);
    const result = await legislator.handleMessage('allow "*"');
    expect(result.message ?? result.decision?.explanation).toContain("forbidden");
    store.close();
  });

  test("rejects allow_always_global via legislator", async () => {
    const store = new SecurityStore(vaultPath);
    const legislator = new LegislatorService(store);
    const result = await legislator.handleMessage('allow global "shell.exec"');
    expect(result.message ?? result.decision?.explanation).toContain("Rejected");
    store.close();
  });

  test("allows specific tool rule", async () => {
    const store = new SecurityStore(vaultPath);
    const legislator = new LegislatorService(store);
    const result = await legislator.handleMessage('allow "filesystem.read_file"');
    expect(result.after?.some((r: { targetName: string }) => r.targetName === "filesystem.read_file")).toBe(true);
    store.close();
  });

  test("respects max rules limit", async () => {
    const store = new SecurityStore(vaultPath);
    for (let i = 0; i < 20; i++) {
      store.addRule({
        targetType: "mcp_tool",
        targetName: `tool_${i}`,
        direction: "in",
        effect: "allow_always_call",
        paramMatch: {},
        scope: { type: "none", filesystem: [], network: false },
        priority: 1,
      });
    }
    const legislator = new LegislatorService(store);
    const result = await legislator.handleMessage('allow "tool_extra"');
    expect(result.message).toContain("Rule limit reached");
    store.close();
  });
});
