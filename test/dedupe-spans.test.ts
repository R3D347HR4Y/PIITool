import { describe, expect, test } from "bun:test";
import { dedupeSpans } from "../src/detectors/regex.ts";
import type { PiiSpan } from "../src/core/schema.ts";

function span(partial: Partial<PiiSpan> & Pick<PiiSpan, "start" | "end" | "text" | "kind">): PiiSpan {
  return {
    confidence: partial.confidence ?? 1,
    source: partial.source ?? "test",
    ...partial,
  };
}

describe("dedupeSpans", () => {
  test("keeps highest-confidence overlapping span when same length tie-breaker", () => {
    const spans: PiiSpan[] = [
      span({ start: 0, end: 6, text: "secret", kind: "person", confidence: 0.5 }),
      span({ start: 0, end: 6, text: "secret", kind: "email", confidence: 0.99 }),
    ];
    const out = dedupeSpans(spans);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("email");
  });

  test("prefers longer span when overlaps fully embed shorter span", () => {
    const spans: PiiSpan[] = [
      span({ start: 4, end: 14, text: "short", kind: "domain", confidence: 0.9 }),
      span({ start: 4, end: 28, text: "longer.email.span@", kind: "email", confidence: 0.95 }),
    ];
    const out = dedupeSpans(spans);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("email");
  });

  test("allows disjoint spans", () => {
    const spans: PiiSpan[] = [
      span({ start: 0, end: 5, text: "alice", kind: "person", confidence: 0.8 }),
      span({ start: 10, end: 28, text: "alice@corp.co.uk", kind: "email", confidence: 0.99 }),
    ];
    const out = dedupeSpans(spans);
    expect(out.length).toBe(2);
  });
});
