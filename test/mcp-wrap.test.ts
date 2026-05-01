import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { wrapMcpConfig } from "../src/cli/mcp-wrap.ts";

const testInput = "./test-mcp-input.json";
const testOutput = "./test-mcp-output.json";

afterEach(() => {
  for (const f of [testInput, testOutput, `${testInput}.piitool-bak`]) {
    rmSync(f, { force: true });
  }
});

describe("mcp-wrap", () => {
  test("wraps stdio servers and skips URL servers", () => {
    writeFileSync(
      testInput,
      JSON.stringify({
        mcpServers: {
          trello: {
            command: "bunx",
            args: ["@delorenj/mcp-server-trello"],
            env: { TRELLO_API_KEY: "abc123", TRELLO_TOKEN: "def456" },
          },
          figma: {
            url: "http://127.0.0.1:3845/mcp",
          },
        },
      }),
    );

    const result = wrapMcpConfig(testInput, { dryRun: true });
    expect(result.wrapped).toBe(1);
    expect(result.skipped).toContain("figma");

    const trello = result.output.mcpServers.trello;
    expect(trello.command).toBe("bun");
    expect(trello.args![0]).toBe("run");
    expect(trello.env!.PIITOOL_MCP_COMMAND).toBe("bunx @delorenj/mcp-server-trello");
    expect(trello.env!.TRELLO_API_KEY).toBe("abc123");
    expect(trello.env!.PIITOOL_VAULT_PATH).toBeTruthy();
  });

  test("does not double-wrap already wrapped servers", () => {
    writeFileSync(
      testInput,
      JSON.stringify({
        mcpServers: {
          wrapped: {
            command: "bun",
            args: ["run", "/some/proxy.ts"],
            env: { PIITOOL_MCP_COMMAND: "bunx original" },
          },
        },
      }),
    );

    const result = wrapMcpConfig(testInput, { dryRun: true });
    expect(result.wrapped).toBe(0);
    expect(result.output.mcpServers.wrapped.env!.PIITOOL_MCP_COMMAND).toBe("bunx original");
  });

  test("writes backup when output equals input", () => {
    writeFileSync(
      testInput,
      JSON.stringify({
        mcpServers: {
          test: { command: "node", args: ["server.js"] },
        },
      }),
    );

    wrapMcpConfig(testInput, { outputPath: testOutput });
    const output = JSON.parse(readFileSync(testOutput, "utf8"));
    expect(output.mcpServers.test.env.PIITOOL_MCP_COMMAND).toBe("node server.js");
  });
});
