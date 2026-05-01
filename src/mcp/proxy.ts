#!/usr/bin/env bun
import { PiiTool } from "../core/piitool.ts";
import { loadConfig } from "../core/config.ts";
import { deanonymizeJson, anonymizeJson } from "../gateway/jsonFilter.ts";
import { encodeMcpFrame, readMcpFrames } from "./framing.ts";
import { OllamaSecurityAgent } from "../security/agent.ts";
import { SecurityEngine } from "../security/engine.ts";
import { SecurityStore } from "../security/store.ts";

const downstream = process.env.PIITOOL_MCP_COMMAND;
if (!downstream) {
  console.error("Set PIITOOL_MCP_COMMAND to upstream MCP server command.");
  process.exit(1);
}

const config = loadConfig();
const tool = new PiiTool(config);
const security = new SecurityEngine(
  new SecurityStore(config.vaultPath),
  new OllamaSecurityAgent({
    baseUrl: config.ollama.baseUrl,
    model: config.security.model,
    timeoutMs: 30_000,
    defaultDecision: config.security.defaultDecision,
  }),
  {
    mode: config.security.mode,
    timeoutMs: config.security.timeoutMs,
    defaultDecision: config.security.defaultDecision,
  },
);
const child = Bun.spawn(["/bin/sh", "-lc", downstream], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});
const callTargets = new Map<unknown, string>();

async function pumpClientToServer(): Promise<void> {
  const clientWriter = Bun.stdout.writer();
  for await (const message of readMcpFrames(Bun.stdin.stream())) {
    let filteredMessage = message as Record<string, unknown>;
    if (message.method === "tools/call" || message.method === "resources/read") {
      const targetName = targetNameForMcp(filteredMessage);
      const evaluation = await security.evaluateIn({
        targetType: message.method === "tools/call" ? "mcp_tool" : "mcp_resource",
        targetName,
        input: filteredMessage.params ?? filteredMessage,
      });
      if (evaluation.decision === "deny") {
        clientWriter.write(encodeMcpFrame(mcpError(filteredMessage.id, `Security denied input: ${evaluation.reasons.join("; ")}`)));
        clientWriter.flush();
        continue;
      }
      if (evaluation.decision === "pending_approval") {
        const approval = await security.waitForApproval(evaluation.pendingId!);
        if (approval !== "approved") {
          clientWriter.write(encodeMcpFrame(mcpError(filteredMessage.id, `Security input ${approval}`)));
          clientWriter.flush();
          continue;
        }
      }
      callTargets.set(filteredMessage.id, targetName);
      filteredMessage = (await deanonymizeJson(tool, filteredMessage)) as Record<string, unknown>;
    }
    child.stdin.write(encodeMcpFrame(filteredMessage));
  }
  child.stdin.end();
}

async function pumpServerToClient(): Promise<void> {
  const writer = Bun.stdout.writer();
  for await (const message of readMcpFrames(child.stdout)) {
    const filtered = await anonymizeJson(tool, message);
    const targetName = callTargets.get(message.id) ?? "unknown";
    if (targetName !== "unknown") {
      const evaluation = await security.evaluateOut({
        targetType: "mcp_tool",
        targetName,
        input: {},
        output: filtered,
      });
      if (evaluation.decision === "deny") {
        writer.write(encodeMcpFrame(mcpError(message.id, `Security denied output: ${evaluation.reasons.join("; ")}`)));
        writer.flush();
        continue;
      }
      if (evaluation.decision === "pending_approval") {
        const approval = await security.waitForApproval(evaluation.pendingId!);
        if (approval !== "approved") {
          writer.write(encodeMcpFrame(mcpError(message.id, `Security output ${approval}`)));
          writer.flush();
          continue;
        }
      }
    }
    writer.write(encodeMcpFrame(filtered));
    writer.flush();
  }
}

await Promise.race([pumpClientToServer(), pumpServerToClient(), child.exited]);
tool.close();

function targetNameForMcp(message: Record<string, unknown>): string {
  const params = message.params as { name?: string; uri?: string } | undefined;
  return params?.name ?? params?.uri ?? String(message.method ?? "unknown");
}

function mcpError(id: unknown, message: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: -32000,
      message,
    },
  };
}
