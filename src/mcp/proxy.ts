#!/usr/bin/env bun
import { PiiTool } from "../core/piitool.ts";
import { deanonymizeJson, anonymizeJson } from "../gateway/jsonFilter.ts";
import { encodeMcpFrame, readMcpFrames } from "./framing.ts";

const downstream = process.env.PIITOOL_MCP_COMMAND;
if (!downstream) {
  console.error("Set PIITOOL_MCP_COMMAND to upstream MCP server command.");
  process.exit(1);
}

const tool = new PiiTool();
const child = Bun.spawn(["/bin/sh", "-lc", downstream], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});

async function pumpClientToServer(): Promise<void> {
  for await (const message of readMcpFrames(Bun.stdin.stream())) {
    const filtered =
      message.method === "tools/call" || message.method === "resources/read"
        ? await deanonymizeJson(tool, message)
        : message;
    child.stdin.write(encodeMcpFrame(filtered));
  }
  child.stdin.end();
}

async function pumpServerToClient(): Promise<void> {
  const writer = Bun.stdout.writer();
  for await (const message of readMcpFrames(child.stdout)) {
    const filtered = await anonymizeJson(tool, message);
    writer.write(encodeMcpFrame(filtered));
    writer.flush();
  }
}

await Promise.race([pumpClientToServer(), pumpServerToClient(), child.exited]);
tool.close();
