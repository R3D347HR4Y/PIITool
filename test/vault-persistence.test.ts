import { afterEach, describe, expect, test } from "bun:test";
import { cleanupVault, makeTool } from "./helpers.ts";

const persistPath = "./test-persist.sqlite";

afterEach(() => cleanupVault(persistPath));

describe("vault persistence across process instances", () => {
  test("reopens same SQLite file and keeps email mirror", async () => {
    const input = "Invoice id: sue@widgets.internal.io";
    let storedFake: string;

    {
      const t = makeTool({ vaultPath: persistPath });
      const anon = await t.anonymize(input);
      storedFake = anon.replacements.find((r) => r.kind === "email")!.fake;
      expect(anon.text).toContain(storedFake);
      t.close();
    }

    {
      const t = makeTool({ vaultPath: persistPath });
      const anon = await t.anonymize(input);
      const again = anon.replacements.find((r) => r.kind === "email")!.fake;
      expect(again).toBe(storedFake);
      const restored = await t.deanonymize(anon.text);
      expect(restored.text).toContain("sue@widgets.internal.io");
      t.close();
    }
  });
});
