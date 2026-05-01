import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import type { EntityKind } from "../src/core/schema.ts";
import { cleanupVault, makeTool } from "./helpers.ts";

const vaultPath = "./test-all-usecases.sqlite";
const fixturePath = new URL("./fixtures/all-usecases.txt", import.meta.url);

afterEach(() => cleanupVault(vaultPath));

describe("all-usecases fixture", () => {
  test("anonymizes representative PII and secret cases from fixture", async () => {
    const tool = makeTool({ vaultPath });
    const input = readFileSync(fixturePath, "utf8");
    const anon = await tool.anonymize(input);
    const kinds = new Set(anon.replacements.map((replacement) => replacement.kind));

    const expectedKinds: EntityKind[] = ["person", "company", "email", "phone", "domain", "url", "handle", "id", "secret"];
    for (const kind of expectedKinds) {
      expect(kinds.has(kind)).toBe(true);
    }

    for (const raw of [
      "Alice Martin",
      "Acme Labs",
      "alice.martin@acmelabs.com",
      "+1 (415) 555-0100",
      "private-tenant.internaltools.dev",
      "https://portal.acmelabs.com/customers/alice-martin?ticket=12345",
      "@alice_private",
      "TAX id: FR-ABCD-123456789",
      "sk-abcdefghijklmnopqrstuvwxyz123456",
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
      "AKIA1234567890ABCDEF",
      "xoxb-123456789012-123456789012-abcdefghijklmnop",
    ]) {
      expect(anon.text).not.toContain(raw);
    }

    expect(anon.text).toContain("PIITOOL_SECRET_");

    const restored = await tool.deanonymize(anon.text);
    expect(restored.text).toContain("Alice Martin");
    expect(restored.text).toContain("alice.martin@acmelabs.com");
    expect(restored.text).toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(restored.text).toContain("PIITOOL_SECRET_123456789012");
    tool.close();
  });
});
