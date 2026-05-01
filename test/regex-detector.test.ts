import { describe, expect, test } from "bun:test";
import { RegexDetector } from "../src/detectors/regex.ts";
import type { EntityKind } from "../src/core/schema.ts";

async function kinds(text: string): Promise<EntityKind[]> {
  const d = new RegexDetector();
  const out = await d.detect(text);
  return out.spans.map((s) => s.kind);
}

async function spanTexts(text: string): Promise<string[]> {
  const d = new RegexDetector();
  const out = await d.detect(text);
  return out.spans.map((s) => s.text);
}

describe("RegexDetector spans", () => {
  test("detects email with plus and subdomain", async () => {
    const t = await spanTexts("Reach team+noreply@mail.internal.acme.io.");
    expect(t.some((x) => x.includes("+"))).toBe(true);
    expect(await kinds("team+noreply@mail.internal.acme.io")).toContain("email");
  });

  test("detects https URL", async () => {
    expect(await kinds('See https://docs.example.com/page?q=1">')).toContain("url");
  });

  test("detects bare domain with listed TLD", async () => {
    expect(await kinds("DNS points at widgets.blackwaterlab.eu")).toContain("domain");
  });

  test("detects phone US spaced", async () => {
    expect(await kinds("Dial +1 415 555 0199 today")).toContain("phone");
  });

  test("detects phone with parentheses", async () => {
    expect(await kinds("Old (415) 555-0100 number")).toContain("phone");
  });

  test("detects TAX id phrase", async () => {
    const t = await spanTexts("Registered TAX id: 832923492 here");
    expect(t.some((x) => x.toLowerCase().startsWith("tax"))).toBe(true);
  });

  test("detects SSN label", async () => {
    expect(await kinds("SSN: 123-45-6789 leaked")).toContain("id");
  });

  test("detects company with Studio suffix without grabbing preceding verb", async () => {
    const t = await spanTexts("Lease renewed with Northwind Studio today");
    expect(t).toContain("Northwind Studio");
  });

  test("detects handle", async () => {
    expect(await kinds("Ping @coder_mcp for help")).toContain("handle");
  });

  test("detects person two-token capitalized name", async () => {
    const t = await spanTexts("Signed by Lopez Garcia yesterday");
    expect(t.some((x) => x.includes("Lopez") && x.includes("Garcia"))).toBe(true);
  });

  test("detects person pattern requires dotted middle initial form when present", async () => {
    const dotted = await spanTexts("Dr. Marie S. Curie attended");
    expect(dotted.some((x) => x.includes("Curie"))).toBe(false);

    const plainTwo = await spanTexts("Alan Turing attended");
    expect(plainTwo.some((x) => x.includes("Alan"))).toBe(true);
  });

  test("skips gmail.com domain span but still gets full email span", async () => {
    const d = new RegexDetector();
    const out = await d.detect("Write me a@mail.com not user@gmail.com");
    const texts = out.spans.map((s) => s.text);
    expect(texts.some((x) => x === "user@gmail.com")).toBe(true);
    expect(texts.some((x) => x.toLowerCase() === "gmail.com")).toBe(false);
  });

  test("skips blocked two-word person false positive", async () => {
    const out = await new RegexDetector().detect("Discuss null pointer fixes");
    expect(out.spans.filter((s) => s.kind === "person").length).toBe(0);
  });
});
