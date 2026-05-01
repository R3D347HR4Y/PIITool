import { afterEach, describe, expect, test } from "bun:test";
import { StaticSecurityAgent } from "../src/security/agent.ts";
import { SecurityEngine } from "../src/security/engine.ts";
import { containsSecretAlias, redactSecretsForGateway } from "../src/security/secrets.ts";
import { SecurityStore } from "../src/security/store.ts";
import { cleanupVault, makeTool } from "./helpers.ts";

const vaultPath = "./test-secrets.sqlite";

afterEach(() => cleanupVault(vaultPath));

describe("secret/API key PII", () => {
  test("API keys and env assignments are anonymized to stable aliases", async () => {
    const tool = makeTool({ vaultPath });
    const input = "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456";
    const anon = await tool.anonymize(input);

    expect(anon.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(anon.text).toMatch(/PIITOOL_SECRET_\d{12}/);
    expect(anon.replacements[0]?.kind).toBe("secret");

    const again = await tool.anonymize(input);
    expect(again.text).toBe(anon.text);
    tool.close();
  });

  test("secret aliases deanonymize only when secret kind is allowed", async () => {
    const tool = makeTool({ vaultPath });
    const input = "Use token sk-abcdefghijklmnopqrstuvwxyz123456";
    const anon = await tool.anonymize(input);

    const safe = await tool.deanonymize(anon.text, { excludeKinds: ["secret"] });
    expect(safe.text).toBe(anon.text);

    const real = await tool.deanonymize(anon.text, { includeKinds: ["secret"] });
    expect(real.text).toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    tool.close();
  });
});

describe("secret-aware security", () => {
  test("broad allow does not auto-release secret aliases", async () => {
    const store = new SecurityStore(vaultPath);
    store.addRule({
      targetType: "mcp_tool",
      targetName: "email.send",
      direction: "in",
      effect: "allow_always_call",
      paramMatch: {},
      scope: { type: "none", filesystem: [], network: false },
      priority: 10,
    });
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "allow", riskLevel: "low", reasons: ["unused"] }),
      { mode: "agent", timeoutMs: 50, defaultDecision: "pending_approval" },
    );

    const result = await engine.evaluateIn({
      targetType: "mcp_tool",
      targetName: "email.send",
      input: { body: "PIITOOL_SECRET_123456789012" },
    });

    expect(result.decision).toBe("pending_approval");
    expect(result.reasons).toContain("secret_alias_requires_param_specific_approval");
    store.close();
  });

  test("param-specific allow can approve secret alias for appropriate service", async () => {
    const store = new SecurityStore(vaultPath);
    store.addRule({
      targetType: "mcp_tool",
      targetName: "secrets.set",
      direction: "in",
      effect: "allow_always_call_params",
      paramMatch: { service: { equals: "openai" } },
      scope: { type: "none", filesystem: [], network: false },
      priority: 100,
    });
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "deny", riskLevel: "critical", reasons: ["unused"] }),
      { mode: "agent", timeoutMs: 50, defaultDecision: "pending_approval" },
    );

    const result = await engine.evaluateIn({
      targetType: "mcp_tool",
      targetName: "secrets.set",
      input: { service: "openai", value: "PIITOOL_SECRET_123456789012" },
    });

    expect(result.decision).toBe("allow");
    store.close();
  });

  test("pending payloads redact raw secrets before gateway exposure", async () => {
    const store = new SecurityStore(vaultPath);
    const engine = new SecurityEngine(
      store,
      new StaticSecurityAgent({ decision: "pending_approval", riskLevel: "high", reasons: ["secret"] }),
      { mode: "agent", timeoutMs: 50, defaultDecision: "pending_approval" },
    );

    const result = await engine.evaluateIn({
      targetType: "mcp_tool",
      targetName: "blog.publish",
      input: { body: "sk-abcdefghijklmnopqrstuvwxyz123456" },
    });
    const pending = store.getPending(result.pendingId!);
    expect(JSON.stringify(pending?.input)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(JSON.stringify(pending?.input)).toContain("[SECRET_VALUE_REDACTED]");
    store.close();
  });
});

describe("secret helpers", () => {
  test("detects aliases and redacts raw secrets", () => {
    expect(containsSecretAlias({ value: "PIITOOL_SECRET_123456789012" })).toBe(true);
    expect(redactSecretsForGateway("token sk-abcdefghijklmnopqrstuvwxyz123456")).toBe("token [SECRET_VALUE_REDACTED]");
  });
});
