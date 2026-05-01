import { describe, expect, test } from "bun:test";
import { normalizeValue, stableHash, stableId } from "../src/core/normalize.ts";

describe("normalize helpers", () => {
  test("normalizeValue collapses whitespace and lowercases", () => {
    expect(normalizeValue("  Foo\tBAR  ")).toBe("foo bar");
  });

  test("stableHash is deterministic length hex", () => {
    expect(stableHash("same")).toBe(stableHash("same"));
    expect(stableHash("same")).not.toBe(stableHash("different"));
    expect(stableHash("x")).toMatch(/^[a-f0-9]{64}$/);
  });

  test("stableId prefixes hash window", () => {
    expect(stableId("p", "abc")).toMatch(/^p_[a-f0-9]{16}$/);
  });
});
