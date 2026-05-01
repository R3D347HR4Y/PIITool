import { afterEach, describe, expect, test } from "bun:test";
import {
  assertFullRoundtrip,
  assertSecretsReplacedAndRestored,
  cleanupVault,
  defaultVaultPath,
  makeTool,
} from "./helpers.ts";

afterEach(() => cleanupVault(defaultVaultPath));

describe("basic anonymize/deanonymize", () => {
  test("roundtrips email and company", async () => {
    const tool = makeTool();
    await assertSecretsReplacedAndRestored(tool, "John Doe emailed meryl.l@blackwaterlab.eu from Blackwater Labs.", [
      "meryl.l@blackwaterlab.eu",
      "Blackwater Labs",
    ]);
    tool.close();
  });

  test("full paragraph roundtrip when every fake span is discoverable", async () => {
    const tool = makeTool();
    await assertFullRoundtrip(tool, "Jane Roe uses jane@solo.dev only.");
    tool.close();
  });
});

describe("coherence", () => {
  test("email domain matches company mirror", async () => {
    const tool = makeTool();
    const input = "Contact r.williams@abcrecords.com at ABC Records.";
    const anon = await tool.anonymize(input);

    const companyRep = anon.replacements.find((r) => r.kind === "company");
    const emailRep = anon.replacements.find((r) => r.kind === "email");

    expect(companyRep).toBeDefined();
    expect(emailRep).toBeDefined();

    const companyDomainBase = companyRep!.fake.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
    expect(emailRep!.fake).toContain(companyDomainBase);
    tool.close();
  });

  test("company suffix is preserved", async () => {
    const tool = makeTool();
    const input = "She works at Globex Records.";
    const anon = await tool.anonymize(input);
    const companyRep = anon.replacements.find((r) => r.kind === "company");
    expect(companyRep).toBeDefined();
    expect(companyRep!.fake).toMatch(/Records$/);
    tool.close();
  });

  test("person plus email cluster picks coherent email local shape", async () => {
    const tool = makeTool();
    const input = "Taylor Reed wrote from t.reed@northapps.tech.";
    const anon = await tool.anonymize(input);
    const emailRep = anon.replacements.find((r) => r.kind === "email");
    expect(emailRep).toBeDefined();
    expect(emailRep!.fake).toMatch(/^[^\s@]{1,3}\.[^\s@]+@/);
    await assertSecretsReplacedAndRestored(tool, input, ["t.reed@northapps.tech", "Taylor Reed"]);
    tool.close();
  });
});

describe("family name consistency", () => {
  test("people with same last name get same fake last name", async () => {
    const tool = makeTool();
    const input = "John Williams met Sarah Williams at the conference.";
    const anon = await tool.anonymize(input);

    const personReps = anon.replacements.filter((r) => r.kind === "person");
    expect(personReps.length).toBe(2);

    const lastNames = personReps.map((r) => r.fake.split(/\s+/).slice(1).join(" "));
    expect(lastNames[0]).toBe(lastNames[1]);

    const firstNames = personReps.map((r) => r.fake.split(/\s+/)[0]);
    expect(firstNames[0]).not.toBe(firstNames[1]);
    tool.close();
  });

  test("three siblings share synthetic surname", async () => {
    const tool = makeTool();
    const input = "Pat Kelly, Sam Kelly, and Quinn Kelly RSVP yes.";
    const anon = await tool.anonymize(input);
    const lasts = anon.replacements
      .filter((r) => r.kind === "person")
      .map((r) => r.fake.split(/\s+/).pop());
    expect(new Set(lasts).size).toBe(1);
    tool.close();
  });
});

describe("format preservation", () => {
  test("phone format preserved US spaced", async () => {
    const tool = makeTool();
    const input = "Call +1 232 1765 now.";
    const anon = await tool.anonymize(input);
    const phoneRep = anon.replacements.find((r) => r.kind === "phone");
    expect(phoneRep).toBeDefined();
    expect(phoneRep!.fake).toMatch(/^\+\d\s\d{3}\s\d{4}$/);
    tool.close();
  });

  test("phone preserves parentheses template when match includes opening paren", async () => {
    const tool = makeTool();
    const input = "Desk line +1 (415) 555-0100";
    const anon = await tool.anonymize(input);
    const phoneRep = anon.replacements.find((r) => r.kind === "phone");
    expect(phoneRep).toBeDefined();
    expect(phoneRep!.fake).toMatch(/^\+1 \(\d{3}\) \d{3}-\d{4}$/);
    tool.close();
  });

  test("international spaced phone keeps separators", async () => {
    const tool = makeTool();
    const input = "Paris line +33 6 12 34 56 78";
    const anon = await tool.anonymize(input);
    const phoneRep = anon.replacements.find((r) => r.kind === "phone");
    expect(phoneRep).toBeDefined();
    expect(phoneRep!.fake.startsWith("+")).toBe(true);
    expect(phoneRep!.fake.includes(" ")).toBe(true);
    tool.close();
  });

  test("ID prefix preserved for TAX label", async () => {
    const tool = makeTool();
    const input = "TAX id: 832923492 is registered.";
    const anon = await tool.anonymize(input);
    const idRep = anon.replacements.find((r) => r.kind === "id");
    expect(idRep).toBeDefined();
    expect(idRep!.fake).toMatch(/^TAX id: \d+$/);
    tool.close();
  });

  test("SSN label preserved while digits are reshuffled without separators", async () => {
    const tool = makeTool();
    const input = "Leak SSN: 123-45-6789 please stop.";
    const anon = await tool.anonymize(input);
    const idRep = anon.replacements.find((r) => r.kind === "id");
    expect(idRep).toBeDefined();
    expect(idRep!.fake).toMatch(/^SSN: \d{9}$/);
    tool.close();
  });
});

describe("false positive reduction", () => {
  test("place names not treated as people", async () => {
    const tool = makeTool();
    const input = "The office is on State Street in Monterey Park.";
    const anon = await tool.anonymize(input);
    expect(anon.replacements.filter((r) => r.kind === "person").length).toBe(0);
    tool.close();
  });

  test("common two-word phrases not treated as people", async () => {
    const tool = makeTool();
    const input = "Use open source and best practices for code review.";
    const anon = await tool.anonymize(input);
    expect(anon.replacements.length).toBe(0);
    tool.close();
  });
});

describe("realistic TLDs", () => {
  test("no .example TLD in output", async () => {
    const tool = makeTool();
    const input = "Email john.smith@acmecorp.com for details.";
    const anon = await tool.anonymize(input);
    expect(anon.text).not.toContain(".example");
    tool.close();
  });

  test("standalone domain anonymized uses allowed TLD set", async () => {
    const tool = makeTool();
    const input = "CNAME targets rollout.blackwaterlab.eu today.";
    const anon = await tool.anonymize(input);
    expect(anon.text).toMatch(/\.(com|net|org|io|co|biz|info|app|tech|dev|eu)\b/);
    expect(anon.text).not.toContain("blackwaterlab.eu");
    tool.close();
  });
});

describe("multi-entity payloads", () => {
  test("handles URL plus email plus phone together", async () => {
    const tool = makeTool();
    const input =
      "Open https://portal.vendor.co/login then mail alerts@vendor.co or call +44 20 7946 0958.";
    await assertSecretsReplacedAndRestored(tool, input, ["https://portal.vendor.co/login", "alerts@vendor.co", "+44 20 7946 0958"]);
    tool.close();
  });

  test("handle replacement roundtrips", async () => {
    const tool = makeTool();
    const input = "Boost @infra_team alerts.";
    await assertSecretsReplacedAndRestored(tool, input, ["@infra_team"]);
    tool.close();
  });

  test("multiple distinct companies keep suffix classes", async () => {
    const tool = makeTool();
    const input = "Contracts with Apex Labs and Horizon Systems finalized.";
    const anon = await tool.anonymize(input);
    const companies = anon.replacements.filter((r) => r.kind === "company");
    expect(companies.length).toBe(2);
    expect(companies.some((c) => /Labs$/.test(c.fake))).toBe(true);
    expect(companies.some((c) => /Systems$/.test(c.fake))).toBe(true);
    tool.close();
  });
});

describe("PiiTool.detect", () => {
  test("returns deduped spans for mixed PII", async () => {
    const tool = makeTool();
    const out = await tool.detect("Team: Ada Lovelace <ada@bletchley.io> +33 6 00 11 22 33");
    const kinds = out.spans.map((s) => s.kind);
    expect(kinds).toContain("email");
    expect(kinds).toContain("phone");
    expect(new Set(out.spans.map((s) => `${s.start}:${s.end}:${s.kind}`)).size).toBe(out.spans.length);
    tool.close();
  });
});

describe("deterministic vault mapping", () => {
  test("second anonymize call reuses mirrors", async () => {
    const tool = makeTool();
    const input = "Ping rico@maps.io";
    const first = await tool.anonymize(input);
    const second = await tool.anonymize(input);
    const e1 = first.replacements.find((r) => r.kind === "email");
    const e2 = second.replacements.find((r) => r.kind === "email");
    expect(e1?.fake).toBe(e2?.fake);
    tool.close();
  });
});

describe("full spec example", () => {
  test("Robin Williams / ABC Records scenario", async () => {
    const tool = makeTool();
    const input =
      "Robin Williams, male Singer at ABC Records, 40 years old, r.williams@abcrecords.com, " +
      "+1 232 1765, facebook.com/u/robin-williams. " +
      "ABC Records, incorporated in 1987, TAX id: 832923492, based in California.";
    const anon = await tool.anonymize(input);

    expect(anon.text).not.toContain("Robin Williams");
    expect(anon.text).not.toContain("r.williams@abcrecords.com");
    expect(anon.text).not.toContain("ABC Records");

    expect(anon.text).toContain("Singer");
    expect(anon.text).toContain("40 years old");
    expect(anon.text).toContain("1987");
    expect(anon.text).toContain("California");

    const companyRep = anon.replacements.find((r) => r.kind === "company");
    expect(companyRep).toBeDefined();
    expect(companyRep!.fake).toMatch(/Records$/);

    const restored = await tool.deanonymize(anon.text);
    expect(restored.text).toContain("ABC Records");
    tool.close();
  });
});

describe("edge cases", () => {
  test("empty string is stable", async () => {
    const tool = makeTool();
    const out = await tool.anonymize("");
    expect(out.text).toBe("");
    expect(out.replacements.length).toBe(0);
    const back = await tool.deanonymize("");
    expect(back.text).toBe("");
    tool.close();
  });

  test("text with no detectable PII unchanged", async () => {
    const tool = makeTool();
    const input = "the quick brown fox jumps";
    const out = await tool.anonymize(input);
    expect(out.text).toBe(input);
    expect(out.replacements.length).toBe(0);
    tool.close();
  });
});

describe("identifier labels", () => {
  test("VAT style label roundtrips", async () => {
    const tool = makeTool();
    await assertSecretsReplacedAndRestored(tool, "EU filing VAT #: NL123456789B01 complete.", ["VAT #: NL123456789B01"]);
    tool.close();
  });

  test("SIREN label detected and roundtrips", async () => {
    const tool = makeTool();
    await assertSecretsReplacedAndRestored(tool, "Legal SIREN: 123456789 ok.", ["SIREN: 123456789"]);
    tool.close();
  });
});

describe("multiple emails", () => {
  test("two addresses in one sentence roundtrip", async () => {
    const tool = makeTool();
    await assertFullRoundtrip(
      tool,
      "Mail x@acme.co then cc y@beta.co about the rollout.",
    );
    tool.close();
  });

  test("short co.uk mailbox still detected", async () => {
    const tool = makeTool();
    await assertSecretsReplacedAndRestored(tool, "Send a@b.co.uk a note.", ["a@b.co.uk"]);
    tool.close();
  });
});

describe("deanonymize without prior mapping", () => {
  test("unknown fake email is left unchanged", async () => {
    const tool = makeTool();
    const input = "Ping ghost@never-seen-before.test ok";
    const out = await tool.deanonymize(input);
    expect(out.replacements.length).toBe(0);
    expect(out.text).toBe(input);
    tool.close();
  });
});

describe("complex combined scenarios", () => {
  test("person + company + two emails share one synthetic domain base", async () => {
    const tool = makeTool();
    const input =
      "Jamie Liu at Northwind Labs confirmed finance@northwindlabs.io and ops@northwindlabs.io.";
    const anon = await tool.anonymize(input);
    expect(anon.text).not.toContain("Jamie Liu");
    expect(anon.text).not.toContain("finance@northwindlabs.io");
    const emailFakes = anon.replacements.filter((r) => r.kind === "email");
    expect(emailFakes.length).toBe(2);
    const domainLabels = emailFakes.map((r) => r.fake.split("@")[1]?.split(".")[0]);
    expect(new Set(domainLabels).size).toBe(1);

    const restored = await tool.deanonymize(anon.text);
    expect(restored.text).toContain("Jamie Liu");
    expect(restored.text).toContain("Northwind Labs");
    expect(restored.text).toContain("finance@northwindlabs.io");
    expect(restored.text).toContain("ops@northwindlabs.io");
    tool.close();
  });
});
