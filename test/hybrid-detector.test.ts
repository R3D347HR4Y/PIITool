import { describe, expect, test } from "bun:test";
import { HybridDetector } from "../src/detectors/hybrid.ts";
import { RegexDetector } from "../src/detectors/regex.ts";

describe("HybridDetector", () => {
  test("still returns regex spans when second detector rejects", async () => {
    const hybrid = new HybridDetector([
      new RegexDetector(),
      {
        detect(): never {
          throw new Error("offline LLM");
        },
      },
    ]);
    const out = await hybrid.detect("Contact ada.lovelace@acme.co.uk please");
    expect(out.spans.some((s) => s.kind === "email")).toBe(true);
  });

  test("merges duplicate spans from parallel detectors via dedupe", async () => {
    const dup = {
      async detect(text: string) {
        const r = await new RegexDetector().detect(text);
        return r;
      },
    };
    const hybrid = new HybridDetector([new RegexDetector(), dup]);
    const out = await hybrid.detect("Email bob@corp.example.net ok");
    const emails = out.spans.filter((s) => s.kind === "email");
    expect(emails.length).toBeLessThanOrEqual(1);
  });
});
