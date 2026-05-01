import { afterEach, describe, expect, test } from "bun:test";
import { PiiTool } from "../src/core/piitool.ts";
import { createGatewayHandler } from "../src/gateway/server.ts";
import type { PiiToolConfig } from "../src/core/config.ts";
import { cleanupVault } from "./helpers.ts";

const path = "./test-auth.sqlite";
afterEach(() => cleanupVault(path));

function cfg(password?: string): PiiToolConfig {
  return {
    vaultPath: path,
    detectorMode: "regex",
    ollama: { baseUrl: "http://127.0.0.1:1", model: "missing", keepAlive: "10m" },
    upstream: { baseUrl: "http://localhost:9999" },
    gatewayPort: 4317,
    reviewMode: "auto",
    failClosed: false,
    gatewayPassword: password,
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

describe("gateway auth", () => {
  test("no password: all routes accessible without auth", async () => {
    const tool = new PiiTool(cfg());
    const handler = createGatewayHandler(tool, cfg());
    const res = await handler(new Request("http://localhost/v1/security/rules"));
    expect(res.status).toBe(200);
    tool.close();
  });

  test("with password: v1 routes require auth", async () => {
    const tool = new PiiTool(cfg("secret123"));
    const handler = createGatewayHandler(tool, cfg("secret123"));
    const res = await handler(new Request("http://localhost/v1/security/rules"));
    expect(res.status).toBe(401);
    tool.close();
  });

  test("with password: Bearer token grants access", async () => {
    const tool = new PiiTool(cfg("secret123"));
    const handler = createGatewayHandler(tool, cfg("secret123"));
    const res = await handler(
      new Request("http://localhost/v1/security/rules", {
        headers: { authorization: "Bearer secret123" },
      }),
    );
    expect(res.status).toBe(200);
    tool.close();
  });

  test("login sets session cookie", async () => {
    const tool = new PiiTool(cfg("secret123"));
    const handler = createGatewayHandler(tool, cfg("secret123"));

    const loginRes = await handler(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "secret123" }),
      }),
    );
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie");
    expect(cookie).toContain("piitool_session=");

    const sessionToken = cookie!.match(/piitool_session=([^;]+)/)![1];
    const authedRes = await handler(
      new Request("http://localhost/v1/security/rules", {
        headers: { cookie: `piitool_session=${sessionToken}` },
      }),
    );
    expect(authedRes.status).toBe(200);
    tool.close();
  });

  test("wrong password returns 401", async () => {
    const tool = new PiiTool(cfg("secret123"));
    const handler = createGatewayHandler(tool, cfg("secret123"));
    const res = await handler(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "wrong" }),
      }),
    );
    expect(res.status).toBe(401);
    tool.close();
  });

  test("/auth/me reports auth status", async () => {
    const tool = new PiiTool(cfg("secret123"));
    const handler = createGatewayHandler(tool, cfg("secret123"));
    const res = await handler(new Request("http://localhost/auth/me"));
    const data = (await res.json()) as { authRequired: boolean; authenticated: boolean };
    expect(data.authRequired).toBe(true);
    expect(data.authenticated).toBe(false);
    tool.close();
  });

  test("health endpoint is always public", async () => {
    const tool = new PiiTool(cfg("secret123"));
    const handler = createGatewayHandler(tool, cfg("secret123"));
    const res = await handler(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    tool.close();
  });

  test("/v1/stats returns dashboard data", async () => {
    const tool = new PiiTool(cfg());
    const handler = createGatewayHandler(tool, cfg());
    const res = await handler(new Request("http://localhost/v1/stats"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { entityCount: number };
    expect(typeof data.entityCount).toBe("number");
    tool.close();
  });

  test("/v1/security/decisions returns audit data", async () => {
    const tool = new PiiTool(cfg());
    const handler = createGatewayHandler(tool, cfg());
    const res = await handler(new Request("http://localhost/v1/security/decisions"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    tool.close();
  });
});
