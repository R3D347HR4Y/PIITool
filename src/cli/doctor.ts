import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../core/config.ts";
import { RegexDetector } from "../detectors/regex.ts";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";

interface Check {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

async function checkOllamaAlive(url: string): Promise<Check> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { name: "Ollama alive", status: "fail", detail: `${url} returned ${res.status}` };
    return { name: "Ollama alive", status: "pass", detail: `${url} responding` };
  } catch {
    return { name: "Ollama alive", status: "fail", detail: `${url} not reachable` };
  }
}

async function checkOllamaModel(url: string, model: string, label: string): Promise<Check> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const found = (data.models ?? []).some((m) => m.name.startsWith(model.split(":")[0]!));
    return found
      ? { name: `${label} model`, status: "pass", detail: `${model} loaded` }
      : { name: `${label} model`, status: "warn", detail: `${model} not found — run: ollama pull ${model}` };
  } catch {
    return { name: `${label} model`, status: "fail", detail: "Ollama not reachable" };
  }
}

async function checkGateway(port: number): Promise<Check> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
    const data = (await res.json()) as { ok: boolean };
    return data.ok
      ? { name: "Gateway alive", status: "pass", detail: `http://localhost:${port} responding` }
      : { name: "Gateway alive", status: "fail", detail: "unhealthy response" };
  } catch {
    return { name: "Gateway alive", status: "warn", detail: `Not running — start with: bun run start` };
  }
}

function checkAuth(password?: string): Check {
  return password
    ? { name: "Auth enabled", status: "pass", detail: "Password set" }
    : { name: "Auth enabled", status: "warn", detail: "No PIITOOL_GATEWAY_PASSWORD — UI unprotected" };
}

function checkHarnessWiring(name: string, configPath: string, apiBaseKey: string): Check {
  if (!existsSync(configPath)) {
    return { name: `${name} wiring`, status: "warn", detail: `${configPath} not found` };
  }
  const content = readFileSync(configPath, "utf8");
  if (content.includes("localhost:4317") || content.includes("127.0.0.1:4317")) {
    return { name: `${name} wiring`, status: "pass", detail: "Points to PIITool gateway" };
  }
  return { name: `${name} wiring`, status: "warn", detail: `${apiBaseKey} not pointing to PIITool gateway` };
}

function checkMcpWrapping(): Check {
  const mcpPath = join(HOME, ".cursor", "mcp.json");
  if (!existsSync(mcpPath)) return { name: "MCP wrapping", status: "warn", detail: "~/.cursor/mcp.json not found" };

  try {
    const config = JSON.parse(readFileSync(mcpPath, "utf8"));
    const servers = config.mcpServers ?? {};
    let wrapped = 0;
    let total = 0;
    let urlBased = 0;
    for (const [, entry] of Object.entries(servers) as Array<[string, Record<string, unknown>]>) {
      total++;
      if (entry.url) { urlBased++; continue; }
      if ((entry.env as Record<string, string>)?.PIITOOL_MCP_COMMAND) wrapped++;
    }
    const unwrapped = total - wrapped - urlBased;
    if (unwrapped === 0) {
      return { name: "MCP wrapping", status: "pass", detail: `${wrapped}/${total} servers wrapped${urlBased ? ` (${urlBased} URL-based skipped)` : ""}` };
    }
    return { name: "MCP wrapping", status: "warn", detail: `${unwrapped} server(s) not wrapped — run: piitool mcp-wrap ~/.cursor/mcp.json` };
  } catch {
    return { name: "MCP wrapping", status: "fail", detail: "Failed to parse ~/.cursor/mcp.json" };
  }
}

async function checkPiiDetection(): Promise<Check> {
  const detector = new RegexDetector();
  const result = await detector.detect("Alice from Acme Corp uses alice@acme.com +1 555 123 4567 and sk-test1234567890abcdef");
  const kinds = new Set(result.spans.map((s) => s.kind));
  return kinds.size >= 3
    ? { name: "PII detection", status: "pass", detail: `Regex: detected ${kinds.size} span kinds in smoke test` }
    : { name: "PII detection", status: "warn", detail: `Only ${kinds.size} kind(s) detected` };
}

function checkVault(path: string): Check {
  if (!existsSync(resolve(path))) {
    return { name: "Vault", status: "warn", detail: `${path} not found — will be created on first run` };
  }
  return { name: "Vault", status: "pass", detail: `SQLite at ${path}` };
}

function checkSecurityPosture(vaultPath: string): Check {
  try {
    const { SecurityStore } = require("../security/store.ts");
    const store = new SecurityStore(vaultPath);
    const rules = store.listRules();
    const globalAllows = rules.filter(
      (r: { targetName: string; effect: string }) => r.targetName === "*" && r.effect.startsWith("allow"),
    );
    store.close();
    if (globalAllows.length > 0) {
      return { name: "Security posture", status: "warn", detail: `${globalAllows.length} global allow-all rule(s) detected` };
    }
    return { name: "Security posture", status: "pass", detail: `${rules.length} rules, no global allow-all` };
  } catch {
    return { name: "Security posture", status: "pass", detail: "Clean (no vault yet)" };
  }
}

export async function runDoctor(): Promise<void> {
  const config = loadConfig();
  console.log("\nPIITool Doctor");
  console.log("==============\n");

  const checks: Check[] = [];

  console.log("Ollama (PIITool internal)");
  checks.push(await checkOllamaAlive(config.ollama.baseUrl));
  checks.push(await checkOllamaModel(config.ollama.baseUrl, config.ollama.model ?? "qwen2.5:7b", "Detector"));
  checks.push(await checkOllamaModel(config.ollama.baseUrl, config.security.model, "Security"));

  console.log("\nPIITool gateway");
  checks.push(await checkGateway(config.gatewayPort));
  checks.push(checkAuth(config.gatewayPassword));

  console.log("\nAgent harness wiring");
  const hermesConfig = join(HOME, ".hermes", "config.yaml");
  if (existsSync(hermesConfig)) checks.push(checkHarnessWiring("Hermes", hermesConfig, "api_base"));
  const openclawConfig = join(HOME, ".openclaw", "openclaw.json");
  if (existsSync(openclawConfig)) checks.push(checkHarnessWiring("OpenClaw", openclawConfig, "provider.baseUrl"));

  console.log("\nMCP proxy coverage");
  checks.push(checkMcpWrapping());

  console.log("\nPII + secret detection");
  checks.push(await checkPiiDetection());

  console.log("\nSecurity posture");
  checks.push(checkSecurityPosture(config.vaultPath));

  console.log("\nVault");
  checks.push(checkVault(config.vaultPath));

  console.log("\n---");
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;

  for (const check of checks) {
    const icon = check.status === "pass" ? "✓" : check.status === "fail" ? "✗" : "⚠";
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed, ${warned} warning(s)\n`);
  process.exit(failed > 0 ? 1 : 0);
}
