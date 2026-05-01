import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { loadConfig } from "../core/config.ts";

interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

const PROXY_SCRIPT = resolve(dirname(import.meta.dir), "mcp/proxy.ts");

export function wrapMcpConfig(inputPath: string, options: { dryRun?: boolean; outputPath?: string } = {}): {
  wrapped: number;
  skipped: string[];
  output: McpConfig;
} {
  const raw = readFileSync(inputPath, "utf8");
  const config: McpConfig = JSON.parse(raw);
  const piitoolConfig = loadConfig();
  const skipped: string[] = [];
  let wrapped = 0;

  const piitoolEnv: Record<string, string> = {
    PIITOOL_VAULT_PATH: resolve(piitoolConfig.vaultPath),
    PIITOOL_SECURITY_MODE: piitoolConfig.security.mode,
    PIITOOL_DETECTOR_MODE: piitoolConfig.detectorMode,
    OLLAMA_BASE_URL: piitoolConfig.ollama.baseUrl,
    PIITOOL_DETECTOR_MODEL: piitoolConfig.ollama.model ?? "qwen2.5:7b",
    PIITOOL_SECURITY_MODEL: piitoolConfig.security.model,
    PIITOOL_OLLAMA_KEEP_ALIVE: piitoolConfig.ollama.keepAlive ?? "10m",
  };

  const output: McpConfig = { mcpServers: {} };

  for (const [name, entry] of Object.entries(config.mcpServers)) {
    if (entry.url) {
      skipped.push(name);
      output.mcpServers[name] = entry;
      continue;
    }

    if (entry.command && entry.env?.PIITOOL_MCP_COMMAND) {
      output.mcpServers[name] = entry;
      continue;
    }

    if (!entry.command) {
      skipped.push(name);
      output.mcpServers[name] = entry;
      continue;
    }

    const originalCmd = [entry.command, ...(entry.args ?? [])].join(" ");
    output.mcpServers[name] = {
      command: "bun",
      args: ["run", PROXY_SCRIPT],
      env: {
        PIITOOL_MCP_COMMAND: originalCmd,
        ...(entry.env ?? {}),
        ...piitoolEnv,
      },
    };
    wrapped++;
  }

  if (!options.dryRun) {
    const outPath = options.outputPath ?? inputPath;
    if (outPath === inputPath && existsSync(inputPath)) {
      copyFileSync(inputPath, `${inputPath}.piitool-bak`);
    }
    writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  }

  return { wrapped, skipped, output };
}
