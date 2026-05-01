import { describe, expect, test } from "bun:test";
import { extractCompanySuffix, extractNameParts, preserveCase } from "../src/core/mirror.ts";

describe("mirror utilities", () => {
  describe("extractNameParts", () => {
    test("single token becomes first-only", () => {
      expect(extractNameParts("Madonna")).toEqual({ first: "Madonna", last: "" });
    });

    test("two tokens first last", () => {
      expect(extractNameParts("John Doe")).toEqual({ first: "John", last: "Doe" });
    });

    test("three tokens fold remainder into last", () => {
      expect(extractNameParts("Mary Jane Watson")).toEqual({ first: "Mary", last: "Jane Watson" });
    });

    test("trims whitespace", () => {
      expect(extractNameParts("  Ada Lovelace  ")).toEqual({ first: "Ada", last: "Lovelace" });
    });
  });

  describe("extractCompanySuffix", () => {
    test("detects Records suffix", () => {
      expect(extractCompanySuffix("ABC Records")).toEqual({ prefix: "ABC", suffix: "Records" });
    });

    test("detects LLC with period", () => {
      expect(extractCompanySuffix("Globex LLC.")).toEqual({ prefix: "Globex", suffix: "LLC." });
    });

    test("returns empty suffix when unknown", () => {
      expect(extractCompanySuffix("Acme Sandwich Shop")).toEqual({
        prefix: "Acme Sandwich Shop",
        suffix: "",
      });
    });
  });

  describe("preserveCase", () => {
    test("upper source upper replacement", () => {
      expect(preserveCase("JOHN DOE", "jamie roberts")).toBe("JAMIE ROBERTS");
    });

    test("lower source lower replacement", () => {
      expect(preserveCase("john doe", "Jamie Roberts")).toBe("jamie roberts");
    });

    test("title case first char", () => {
      expect(preserveCase("John doe", "jamie roberts")).toBe("Jamie roberts");
    });
  });
});
