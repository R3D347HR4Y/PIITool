import { afterEach, describe, expect, test } from "bun:test";
import { PiiTool } from "../src/core/piitool.ts";
import { createGatewayHandler } from "../src/gateway/server.ts";
import type { PiiToolConfig } from "../src/core/config.ts";
import { cleanupVault } from "./helpers.ts";

const path = "./test-security-gateway.sqlite";

afterEach(() => cleanupVault(path));

function cfg(): PiiToolConfig {
  return {
    vaultPath: path,
    detectorMode: "regex",
    ollama: { baseUrl: "http://127.0.0.1:1", model: "missing", keepAlive: "10m" },
    upstream: { baseUrl: "http://localhost:9999" },
    gatewayPort: 4317,
    reviewMode: "auto",
    failClosed: false,
    sessionTtlMs: 3_600_000,
    security: {
      mode: "policy",
      model: "missing",
      timeoutMs: 50,
      defaultDecision: "pending_approval",
      legislatorModel: "missing",
      legislatorMaxHistory: 50,
    },
  };
}

async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

describe("security gateway", () => {
  test("rules CRUD endpoints", async () => {
    const tool = new PiiTool(cfg());
    const handler = createGatewayHandler(tool, cfg());
    const create = await handler(
      new Request("http://localhost/v1/security/rules", {
        method: "POST",
        body: JSON.stringify({
          targetType: "mcp_tool",
          targetName: "filesystem.read_file",
          direction: "inout",
          effect: "allow_always_call",
          paramMatch: {},
          scope: { type: "none", filesystem: [], network: false },
          priority: 1,
        }),
      }),
    );
    expect(create.status).toBe(200);
    const rule = await readJson<{ id: string }>(create);

    const list = await readJson<Array<{ id: string }>>(await handler(new Request("http://localhost/v1/security/rules")));
    expect(list.some((item) => item.id === rule.id)).toBe(true);

    const deleted = await handler(new Request(`http://localhost/v1/security/rules/${rule.id}`, { method: "DELETE" }));
    expect(deleted.status).toBe(200);
    tool.close();
  });

  test("legislator endpoint creates published rule change", async () => {
    const tool = new PiiTool(cfg());
    const handler = createGatewayHandler(tool, cfg());

    const response = await handler(
      new Request("http://localhost/v1/security/legislator/message", {
        method: "POST",
        body: JSON.stringify({ message: 'allow "filesystem.read_file"' }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = await readJson<{ change: { published: boolean }; after: Array<{ targetName: string }> }>(response);
    expect(payload.change.published).toBe(true);
    expect(payload.after.some((rule) => rule.targetName === "filesystem.read_file")).toBe(true);

    const changes = await readJson<Array<{ id: string }>>(await handler(new Request("http://localhost/v1/security/rule-changes")));
    expect(changes.length).toBe(1);
    tool.close();
  });

  test("rule change revert endpoint restores previous ruleset", async () => {
    const tool = new PiiTool(cfg());
    const handler = createGatewayHandler(tool, cfg());
    const response = await handler(
      new Request("http://localhost/v1/security/legislator/message", {
        method: "POST",
        body: JSON.stringify({ message: 'allow "filesystem.read_file"' }),
      }),
    );
    const payload = await readJson<{ change: { id: string } }>(response);

    const revert = await handler(new Request(`http://localhost/v1/security/rule-changes/${payload.change.id}/revert`, { method: "POST" }));
    expect(revert.status).toBe(200);
    const rules = await readJson<Array<unknown>>(await handler(new Request("http://localhost/v1/security/rules")));
    expect(rules.length).toBe(0);
    tool.close();
  });
});
