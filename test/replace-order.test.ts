import { describe, expect, test } from "bun:test";
import { applySpanReplacements } from "../src/core/replace.ts";
import type { PiiSpan, Replacement } from "../src/core/schema.ts";

describe("applySpanReplacements", () => {
  test("replaces right-to-left without breaking indices", () => {
    const spans: PiiSpan[] = [
      { start: 6, end: 17, text: "alice@co.uk", kind: "email", confidence: 1, source: "t" },
      { start: 0, end: 5, text: "Alice", kind: "person", confidence: 1, source: "t" },
    ];
    const resolve = (span: PiiSpan): Replacement | null => {
      if (span.kind === "person") return { real: span.text, fake: "Quinn", kind: "person", entityId: "r1", mirrorId: "m1" };
      return { real: span.text, fake: "q@z.co", kind: "email", entityId: "r2", mirrorId: "m2" };
    };
    const { text } = applySpanReplacements("Alice alice@co.uk tail", spans, resolve);
    expect(text).toContain("Quinn");
    expect(text).toContain("q@z.co");
    expect(text.endsWith(" tail")).toBe(true);
  });

  test("skips spans outside bounds", () => {
    const spans: PiiSpan[] = [{ start: 100, end: 110, text: "x", kind: "person", confidence: 1, source: "t" }];
    const { text } = applySpanReplacements("short", spans, () => ({
      real: "x",
      fake: "y",
      kind: "person",
      entityId: "r",
      mirrorId: "m",
    }));
    expect(text).toBe("short");
  });
});
