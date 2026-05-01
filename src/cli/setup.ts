import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { wrapMcpConfig } from "./mcp-wrap.ts";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";

interface HarnessInfo {
  name: string;
  detected: boolean;
  configPath?: string;
  apiBaseKey?: string;
  currentBase?: string;
}

function prompt(question: string): string {
  process.stdout.write(question);
  const buf = new Uint8Array(1024);
  const n = require("node:fs").readSync(0, buf);
  return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

function promptPassword(question: string): string {
  return prompt(question);
}

function detectHarnesses(): HarnessInfo[] {
  const harnesses: HarnessInfo[] = [];

  const hermesDir = join(HOME, ".hermes");
  const hermesConfig = join(hermesDir, "config.yaml");
  const hermesDetected = existsSync(hermesDir);
  let hermesBase: string | undefined;
  if (hermesDetected && existsSync(hermesConfig)) {
    const content = readFileSync(hermesConfig, "utf8");
    const match = content.match(/api_base[:\s]+["']?([^\s"']+)/);
    hermesBase = match?.[1];
  }
  harnesses.push({
    name: "Hermes Agent",
    detected: hermesDetected,
    configPath: hermesConfig,
    apiBaseKey: "api_base",
    currentBase: hermesBase,
  });

  const openclawDir = join(HOME, ".openclaw");
  const openclawConfig = join(openclawDir, "openclaw.json");
  const openclawDetected = existsSync(openclawDir);
  let openclawBase: string | undefined;
  if (openclawDetected && existsSync(openclawConfig)) {
    try {
      const content = JSON.parse(readFileSync(openclawConfig, "utf8"));
      openclawBase = content.provider?.baseUrl || content.api_base;
    } catch {}
  }
  harnesses.push({
    name: "OpenClaw",
    detected: openclawDetected,
    configPath: openclawConfig,
    apiBaseKey: "provider.baseUrl",
    currentBase: openclawBase,
  });

  const cursorMcp = join(HOME, ".cursor", "mcp.json");
  harnesses.push({
    name: "Cursor IDE",
    detected: existsSync(cursorMcp),
    configPath: cursorMcp,
  });

  return harnesses;
}

async function checkOllama(baseUrl: string): Promise<{ alive: boolean; models: string[] }> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { alive: false, models: [] };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return { alive: true, models: (data.models ?? []).map((m) => m.name) };
  } catch {
    return { alive: false, models: [] };
  }
}

export async function runSetup(): Promise<void> {
  console.log("\nPIITool Setup");
  console.log("=============\n");

  console.log("[1/7] Detecting agent harnesses...");
  const harnesses = detectHarnesses();
  for (const h of harnesses) {
    console.log(`  ${h.detected ? "✓" : "○"} ${h.name}${h.detected ? "" : " not found"}`);
  }

  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  console.log("\n[2/7] Checking Ollama...");
  const ollama = await checkOllama(ollamaUrl);
  if (ollama.alive) {
    console.log(`  ✓ Ollama running at ${ollamaUrl}`);
    console.log(`  Available models: ${ollama.models.join(", ") || "none"}`);
  } else {
    console.log(`  ✗ Ollama not reachable at ${ollamaUrl}`);
    console.log("  Install Ollama and run: ollama pull qwen2.5:7b");
  }

  console.log("\n[3/7] Selecting trusted model...");
  const defaultModel = "qwen2.5:7b";
  const hasDefault = ollama.models.some((m) => m.startsWith("qwen2.5"));
  const model = hasDefault ? defaultModel : (ollama.models[0] ?? defaultModel);
  console.log(`  → Security/detector model: ${model}`);

  console.log("\n[4/7] Gateway password...");
  const password = promptPassword("  Enter password for PIITool web UI: ");
  if (!password) {
    console.log("  ⚠ No password set — UI will be unprotected");
  }

  const gatewayUrl = "http://localhost:4317";
  const envLines: string[] = [
    `PIITOOL_VAULT_PATH=${resolve("./piitool.sqlite")}`,
    `PIITOOL_DETECTOR_MODE=hybrid`,
    `OLLAMA_BASE_URL=${ollamaUrl}`,
    `PIITOOL_DETECTOR_MODEL=${model}`,
    `PIITOOL_SECURITY_MODEL=${model}`,
    `PIITOOL_SECURITY_MODE=policy`,
    `PIITOOL_OLLAMA_KEEP_ALIVE=10m`,
    `PIITOOL_GATEWAY_PORT=4317`,
  ];
  if (password) envLines.push(`PIITOOL_GATEWAY_PASSWORD=${password}`);

  let step = 5;
  for (const h of harnesses) {
    if (!h.detected || !h.configPath || h.name === "Cursor IDE") continue;
    console.log(`\n[${step}/7] Configuring ${h.name}...`);
    if (h.currentBase) {
      console.log(`  Current API base: ${h.currentBase}`);
    }

    if (h.name === "Hermes Agent" && existsSync(h.configPath)) {
      copyFileSync(h.configPath, `${h.configPath}.piitool-bak`);
      let content = readFileSync(h.configPath, "utf8");
      if (h.currentBase) {
        envLines.push(`PIITOOL_UPSTREAM_BASE_URL=${h.currentBase}`);
        content = content.replace(h.currentBase, `${gatewayUrl}/v1`);
        writeFileSync(h.configPath, content);
        console.log(`  → Rewritten to: ${gatewayUrl}/v1`);
        console.log(`  Backup: ${h.configPath}.piitool-bak`);
      }
      console.log(`  ✓ ${h.name} configured`);
    }

    if (h.name === "OpenClaw" && existsSync(h.configPath)) {
      copyFileSync(h.configPath, `${h.configPath}.piitool-bak`);
      try {
        const content = JSON.parse(readFileSync(h.configPath, "utf8"));
        if (content.provider?.baseUrl) {
          envLines.push(`PIITOOL_UPSTREAM_BASE_URL=${content.provider.baseUrl}`);
          content.provider.baseUrl = `${gatewayUrl}/v1`;
        } else if (content.api_base) {
          envLines.push(`PIITOOL_UPSTREAM_BASE_URL=${content.api_base}`);
          content.api_base = `${gatewayUrl}/v1`;
        }
        writeFileSync(h.configPath, JSON.stringify(content, null, 2) + "\n");
        console.log(`  → Rewritten to: ${gatewayUrl}/v1`);
        console.log(`  Backup: ${h.configPath}.piitool-bak`);
      } catch {}
      console.log(`  ✓ ${h.name} configured`);
    }
    step++;
  }

  const cursorHarness = harnesses.find((h) => h.name === "Cursor IDE");
  if (cursorHarness?.detected && cursorHarness.configPath && existsSync(cursorHarness.configPath)) {
    console.log(`\n[${step}/7] Wrapping MCP servers...`);
    try {
      const result = wrapMcpConfig(cursorHarness.configPath);
      console.log(`  ✓ ${result.wrapped} servers wrapped`);
      if (result.skipped.length) {
        console.log(`  ⚠ Skipped (URL-based): ${result.skipped.join(", ")}`);
      }
      console.log(`  Backup: ${cursorHarness.configPath}.piitool-bak`);
    } catch (e) {
      console.log(`  ✗ Failed: ${e instanceof Error ? e.message : e}`);
    }
    step++;
  }

  console.log(`\n[${step}/7] Writing .env...`);
  const envPath = resolve(".env");
  writeFileSync(envPath, envLines.join("\n") + "\n");
  console.log(`  ✓ ${envPath} written`);

  console.log("\nSetup complete!");
  console.log("  bun run start     → start PIITool gateway");
  console.log("  piitool doctor    → verify everything works\n");
}
