import { afterEach, describe, expect, test } from "bun:test";
import { createGatewayHandler } from "../src/gateway/server.ts";
import { cleanupVault, makeTool } from "./helpers.ts";

const reviewVaultPath = "./test-review.sqlite";

afterEach(() => cleanupVault(reviewVaultPath));

function makeQueueTool() {
  return makeTool({ vaultPath: reviewVaultPath, reviewMode: "queue" });
}

async function json(response: Response) {
  return response.json() as Promise<unknown>;
}

describe("review queue mode", () => {
  test("unknown person and company create pending review items", async () => {
    const tool = makeQueueTool();
    await tool.anonymize("John Doe works at Blackwater Labs.");

    const pending = tool.vault.listReviewItems("pending");
    expect(pending.some((item) => item.kind === "person" && item.value === "John Doe")).toBe(true);
    expect(pending.some((item) => item.kind === "company" && item.value === "Blackwater Labs")).toBe(true);
    tool.close();
  });

  test("same exact entity does not create duplicate pending review items", async () => {
    const tool = makeQueueTool();
    await tool.anonymize("John Doe works remotely.");
    await tool.anonymize("John Doe works remotely.");

    const johnItems = tool.vault.listReviewItems("pending").filter((item) => item.value === "John Doe");
    expect(johnItems.length).toBe(1);
    tool.close();
  });

  test("fuzzy similar name proposes merge candidate", async () => {
    const tool = makeQueueTool();
    await tool.anonymize("Robin Williams arrived.");
    await tool.anonymize("Robin William arrived.");

    const item = tool.vault.listReviewItems("pending").find((review) => review.value === "Robin William");
    expect(item).toBeDefined();
    expect(item!.candidates.some((candidate) => candidate.primaryValue === "Robin Williams")).toBe(true);
    tool.close();
  });

  test("whitelist review item makes future anonymize pass through", async () => {
    const tool = makeQueueTool();
    await tool.anonymize("Jane Roe signed.");
    const item = tool.vault.listReviewItems("pending").find((review) => review.value === "Jane Roe");
    expect(item).toBeDefined();

    tool.vault.whitelistReviewItem(item!.id);
    const anon = await tool.anonymize("Jane Roe signed.");
    expect(anon.text).toContain("Jane Roe");
    expect(anon.replacements.some((replacement) => replacement.real === "Jane Roe")).toBe(false);
    tool.close();
  });

  test("merge review item reuses target mirror", async () => {
    const tool = makeQueueTool();
    const target = await tool.anonymize("Robin Williams arrived.");
    const targetRep = target.replacements.find((replacement) => replacement.real === "Robin Williams");
    expect(targetRep).toBeDefined();

    await tool.anonymize("Robin William arrived.");
    const item = tool.vault.listReviewItems("pending").find((review) => review.value === "Robin William");
    expect(item).toBeDefined();
    tool.vault.mergeReviewItem(item!.id, targetRep!.entityId);

    const merged = await tool.anonymize("Robin William arrived.");
    const mergedRep = merged.replacements.find((replacement) => replacement.real === "Robin William");
    expect(mergedRep?.fake).toBe(targetRep!.fake);
    tool.close();
  });
});

describe("review gateway endpoints", () => {
  test("lists review items and whitelists by review item", async () => {
    const tool = makeQueueTool();
    await tool.anonymize("Alex Carter joined.");
    const handler = createGatewayHandler(tool, tool.config);

    const listResponse = await handler(new Request("http://localhost/v1/review/items?status=pending"));
    expect(listResponse.status).toBe(200);
    const list = (await json(listResponse)) as Array<{ id: string; value: string }>;
    const item = list.find((entry) => entry.value === "Alex Carter");
    expect(item).toBeDefined();

    const whitelistResponse = await handler(new Request(`http://localhost/v1/review/items/${item!.id}/whitelist`, { method: "POST" }));
    expect(whitelistResponse.status).toBe(200);
    const payload = (await json(whitelistResponse)) as { status: string };
    expect(payload.status).toBe("whitelisted");

    const anon = await tool.anonymize("Alex Carter joined.");
    expect(anon.text).toContain("Alex Carter");
    tool.close();
  });

  test("entity whitelist endpoint updates entity policy", async () => {
    const tool = makeQueueTool();
    const first = await tool.anonymize("Taylor Smith joined.");
    const entityId = first.replacements.find((replacement) => replacement.real === "Taylor Smith")!.entityId;
    const handler = createGatewayHandler(tool, tool.config);

    const response = await handler(
      new Request(`http://localhost/v1/entities/${entityId}/whitelist`, {
        method: "POST",
        body: JSON.stringify({ whitelisted: true }),
      }),
    );
    expect(response.status).toBe(200);

    const anon = await tool.anonymize("Taylor Smith joined.");
    expect(anon.text).toContain("Taylor Smith");
    tool.close();
  });

  test("entity search returns real entity summaries", async () => {
    const tool = makeQueueTool();
    await tool.anonymize("Northwind Labs shipped.");
    const handler = createGatewayHandler(tool, tool.config);

    const response = await handler(new Request("http://localhost/v1/entities?kind=company&q=Northwind"));
    const entities = (await json(response)) as Array<{ primaryValue: string }>;
    expect(entities.some((entity) => entity.primaryValue === "Northwind Labs")).toBe(true);
    tool.close();
  });

  test("approve-new endpoint resolves pending review item", async () => {
    const tool = makeQueueTool();
    await tool.anonymize("Casey Moore joined.");
    const item = tool.vault.listReviewItems("pending").find((review) => review.value === "Casey Moore");
    expect(item).toBeDefined();
    const handler = createGatewayHandler(tool, tool.config);

    const response = await handler(new Request(`http://localhost/v1/review/items/${item!.id}/approve-new`, { method: "POST" }));
    expect(response.status).toBe(200);
    const payload = (await json(response)) as { status: string };
    expect(payload.status).toBe("approved_new");
    tool.close();
  });

  test("review merge endpoint links source to target mirror", async () => {
    const tool = makeQueueTool();
    const target = await tool.anonymize("Morgan Reed arrived.");
    const targetRep = target.replacements.find((replacement) => replacement.real === "Morgan Reed");
    expect(targetRep).toBeDefined();
    await tool.anonymize("Morgan Reeds arrived.");
    const item = tool.vault.listReviewItems("pending").find((review) => review.value === "Morgan Reeds");
    expect(item).toBeDefined();
    const handler = createGatewayHandler(tool, tool.config);

    const response = await handler(
      new Request(`http://localhost/v1/review/items/${item!.id}/merge`, {
        method: "POST",
        body: JSON.stringify({ targetEntityId: targetRep!.entityId }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await json(response)) as { status: string };
    expect(payload.status).toBe("approved_merge");

    const merged = await tool.anonymize("Morgan Reeds arrived.");
    const mergedRep = merged.replacements.find((replacement) => replacement.real === "Morgan Reeds");
    expect(mergedRep?.fake).toBe(targetRep!.fake);
    tool.close();
  });
});
