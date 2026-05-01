import { rmSync } from "node:fs";
import type { PiiToolConfig } from "../src/core/config.ts";
import { PiiTool } from "../src/core/piitool.ts";
import { expect } from "bun:test";

export const defaultVaultPath = "./test.sqlite";

export function cleanupVault(path = defaultVaultPath): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

export function makeTool(
  overrides: Partial<PiiToolConfig> & { vaultPath?: string } = {},
): PiiTool {
  const vaultPath = overrides.vaultPath ?? defaultVaultPath;
  const { vaultPath: _vp, ...rest } = overrides;
  return new PiiTool({
    vaultPath,
    detectorMode: "regex",
    ollama: { baseUrl: "http://localhost:11434", model: "qwen2.5:7b" },
    upstream: { baseUrl: "http://localhost:9999" },
    gatewayPort: 4317,
    reviewMode: "auto",
    failClosed: true,
    ...rest,
  });
}

export async function assertSecretsReplacedAndRestored(
  tool: PiiTool,
  input: string,
  secrets: string[],
): Promise<void> {
  const anon = await tool.anonymize(input);
  for (const s of secrets) {
    expect(anon.text).not.toContain(s);
  }
  const restored = await tool.deanonymize(anon.text);
  for (const s of secrets) {
    expect(restored.text).toContain(s);
  }
}

/** Strict equality roundtrip when anonymizer replaces every sensitive span detector finds and deanonymizer finds fakes. */
export async function assertFullRoundtrip(tool: PiiTool, input: string): Promise<void> {
  const anon = await tool.anonymize(input);
  const restored = await tool.deanonymize(anon.text);
  expect(restored.text).toBe(input);
}
