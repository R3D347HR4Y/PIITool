import { describe, expect, test } from "bun:test";
import { OllamaDetector } from "../src/detectors/ollama.ts";
import { OllamaSecurityAgent } from "../src/security/agent.ts";

const runLlm = process.env.PIITOOL_TEST_LLM === "1";
const maybeDescribe = runLlm ? describe : describe.skip;
const baseUrl = process.env.PIITOOL_OLLAMA_BASE_URL ?? "http://localhost:11434";
const model = process.env.PIITOOL_OLLAMA_MODEL ?? "qwen2.5:7b";
const keepAlive = process.env.PIITOOL_OLLAMA_KEEP_ALIVE ?? "10m";

maybeDescribe("LLM integration with Ollama", () => {
  test("OllamaDetector extracts normal PII and secrets", async () => {
    await assertOllamaReady();
    const detector = new OllamaDetector({ baseUrl, model, timeoutMs: 60_000, keepAlive });
    const text = "Alice Martin from Acme Labs uses OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456.";

    const result = await detector.detect(text);
    expect(result.spans.length).toBeGreaterThan(0);
    expect(result.spans.some((span) => span.text.includes("sk-") || span.text.includes("OPENAI_API_KEY"))).toBe(true);
  }, 120_000);

  test("OllamaSecurityAgent blocks or escalates public secret exfiltration", async () => {
    await assertOllamaReady();
    const agent = new OllamaSecurityAgent({
      baseUrl,
      model,
      timeoutMs: 60_000,
      keepAlive,
      defaultDecision: "pending_approval",
    });

    const decision = await agent.decide(
      {
        direction: "in",
        targetType: "mcp_tool",
        targetName: "blog.publish",
        input: {
          title: "debug notes",
          body: "publish this key: PIITOOL_SECRET_123456789012",
        },
      },
      [],
    );

    expect(["deny", "pending_approval"]).toContain(decision.decision);
    expect(["high", "critical", "medium"]).toContain(decision.riskLevel);
  }, 120_000);
});

async function assertOllamaReady(): Promise<void> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `Ollama integration tests require Ollama at ${baseUrl} with model ${model}. ` +
        `Run: ollama pull ${model}. Cause: ${String(error)}`,
    );
  }
}
