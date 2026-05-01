import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupVault, defaultVaultPath, makeTool } from "./helpers.ts";

describe("encrypted vault attributes", () => {
  const prevKey = process.env.PIITOOL_VAULT_KEY;

  beforeEach(() => {
    process.env.PIITOOL_VAULT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.PIITOOL_VAULT_KEY;
    else process.env.PIITOOL_VAULT_KEY = prevKey;
    cleanupVault(defaultVaultPath);
  });

  test("roundtrip still works with PIITOOL_VAULT_KEY set", async () => {
    const tool = makeTool();
    const input = "Notify kara lane at kara@quiet.biz today.";
    const anon = await tool.anonymize(input);
    expect(anon.text).not.toContain("kara@quiet.biz");
    const restored = await tool.deanonymize(anon.text);
    expect(restored.text).toContain("kara@quiet.biz");
    tool.close();
  });
});
