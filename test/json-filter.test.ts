import { afterEach, describe, expect, test } from "bun:test";
import { anonymizeJson, deanonymizeJson } from "../src/gateway/jsonFilter.ts";
import { cleanupVault, defaultVaultPath, makeTool } from "./helpers.ts";

describe("JSON string mapping filter", () => {
  afterEach(() => cleanupVault());

  test("rewrites nested strings", async () => {
    const tool = makeTool();
    const payload = {
      meta: { note: "Alice Wonder spoke with bob@sekret.biz" },
      items: ["Plain text Jane Roe"],
    };
    const anon = await anonymizeJson(tool, payload);
    expect(JSON.stringify(anon)).not.toContain("Alice Wonder");
    expect(JSON.stringify(anon)).not.toContain("bob@sekret.biz");
    expect(JSON.stringify(anon)).not.toContain("Jane Roe");

    const back = await deanonymizeJson(tool, anon);
    expect(back).toEqual(payload);
    tool.close();
  });

  test("preserves numbers booleans null", async () => {
    const tool = makeTool();
    const payload = { n: 42, ok: true, x: null, arr: [1, 2] };
    expect(await anonymizeJson(tool, payload)).toEqual(payload);
    tool.close();
  });
});
