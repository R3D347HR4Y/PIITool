import { existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "~";

interface RestoreTarget {
  label: string;
  path: string;
  backup: string;
}

const ALL_TARGETS: RestoreTarget[] = [
  { label: "Cursor MCP", path: join(HOME, ".cursor", "mcp.json"), backup: join(HOME, ".cursor", "mcp.json.piitool-bak") },
  { label: "Hermes Agent", path: join(HOME, ".hermes", "config.yaml"), backup: join(HOME, ".hermes", "config.yaml.piitool-bak") },
  { label: "OpenClaw", path: join(HOME, ".openclaw", "openclaw.json"), backup: join(HOME, ".openclaw", "openclaw.json.piitool-bak") },
];

export function runUnwrap(args: string[]): void {
  const harnessFilter = args.includes("--harness") ? args[args.indexOf("--harness") + 1] : null;
  const mcpOnly = args.includes("--mcp");

  let targets = ALL_TARGETS;
  if (mcpOnly) {
    targets = targets.filter((t) => t.label === "Cursor MCP");
  } else if (harnessFilter) {
    targets = targets.filter((t) => t.label.toLowerCase().includes(harnessFilter.toLowerCase()));
  }

  if (targets.length === 0) {
    console.log("No matching targets found.");
    return;
  }

  let restored = 0;
  for (const target of targets) {
    if (!existsSync(target.backup)) {
      console.log(`  ○ ${target.label}: no backup found at ${target.backup}`);
      continue;
    }
    copyFileSync(target.backup, target.path);
    console.log(`  ✓ ${target.label}: restored from ${target.backup}`);
    restored++;
  }

  console.log(`\n${restored} config(s) restored.`);
}
