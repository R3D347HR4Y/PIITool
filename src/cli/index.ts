#!/usr/bin/env bun
import { PiiTool, spansToPreview } from "../core/piitool.ts";
import { loadConfig } from "../core/config.ts";
import { filterImageDescription } from "../media/image.ts";
import { filterAudioTranscript } from "../media/audio.ts";
import { OllamaSecurityAgent } from "../security/agent.ts";
import { SecurityEngine } from "../security/engine.ts";
import { LegislatorService } from "../security/legislator.ts";
import { SecurityStore } from "../security/store.ts";

async function readInput(args: string[]): Promise<string> {
  const fileIndex = args.indexOf("--file");
  if (fileIndex >= 0 && args[fileIndex + 1]) return Bun.file(args[fileIndex + 1]).text();
  if (args.length > 1) return args.slice(1).join(" ");
  return new Response(Bun.stdin.stream()).text();
}

function print(value: unknown): void {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const [command = "help", ...rest] = Bun.argv.slice(2);
  const config = loadConfig();
  const tool = new PiiTool(config);
  const securityStore = new SecurityStore(config.vaultPath);
  const securityEngine = new SecurityEngine(
    securityStore,
    new OllamaSecurityAgent({
      baseUrl: config.ollama.baseUrl,
      model: config.security.model,
      defaultDecision: config.security.defaultDecision,
    }),
    {
      mode: config.security.mode,
      timeoutMs: config.security.timeoutMs,
      defaultDecision: config.security.defaultDecision,
    },
  );
  const legislator = new LegislatorService(securityStore, undefined, config.security.legislatorMaxHistory);
  try {
    if (command === "detect") {
      const text = await readInput(rest);
      const detected = await tool.detect(text);
      print({ ...detected, preview: spansToPreview(detected.spans) });
      return;
    }
    if (command === "anon" || command === "anonymize") {
      const result = await tool.anonymize(await readInput(rest));
      print(result);
      return;
    }
    if (command === "deanonymize" || command === "deanon") {
      const result = await tool.deanonymize(await readInput(rest));
      print(result);
      return;
    }
    if (command === "image") {
      const path = rest[0];
      if (!path) throw new Error("image command needs a path");
      print(await filterImageDescription(path, tool, config));
      return;
    }
    if (command === "audio") {
      const path = rest[0];
      if (!path) throw new Error("audio command needs a path");
      print(await filterAudioTranscript(path, tool, config));
      return;
    }
    if (command === "review") {
      const [action, id, targetEntityId] = rest;
      if (action === "list") {
        print(tool.vault.listReviewItems((id || undefined) as never));
        return;
      }
      if (action === "approve-new" && id) {
        print(tool.vault.approveNew(id));
        return;
      }
      if (action === "whitelist" && id) {
        print(tool.vault.whitelistReviewItem(id));
        return;
      }
      if (action === "merge" && id && targetEntityId) {
        print(tool.vault.mergeReviewItem(id, targetEntityId));
        return;
      }
      throw new Error("review usage: list [status] | approve-new <id> | whitelist <id> | merge <id> <entityId>");
    }
    if (command === "entities") {
      const [action, ...args] = rest;
      if (action === "search") {
        const query = args.join(" ");
        print(tool.vault.listEntities(undefined, query || undefined));
        return;
      }
      if (action === "whitelist" && args[0]) {
        print(tool.vault.setEntityWhitelist(args[0], args[1] !== "false"));
        return;
      }
      if (action === "merge" && args[0] && args[1]) {
        print(tool.vault.mergeEntities(args[0], args[1]));
        return;
      }
      throw new Error("entities usage: search <query> | whitelist <id> [true|false] | merge <sourceId> <targetId>");
    }
    if (command === "security") {
      const [area, action, ...args] = rest;
      if (area === "pending") {
        if (action === "list") return print(securityStore.listPending((args[0] || undefined) as never));
        if (action === "approve" && args[0]) return print(securityEngine.approvePending(args[0]));
        if (action === "deny" && args[0]) return print(securityEngine.denyPending(args[0]));
      }
      if (area === "rules") {
        if (action === "list") return print(securityStore.listRules());
        if (action === "add") return print(securityStore.addRule(JSON.parse(args.join(" "))));
        if (action === "delete" && args[0]) return print(securityStore.deleteRule(args[0]));
      }
      if (area === "legislator") {
        return print(await legislator.handleMessage([action, ...args].filter(Boolean).join(" ")));
      }
      if (area === "rule-changes") {
        if (action === "list") return print(securityStore.listRuleChanges());
        if (action === "revert" && args[0]) return print(securityStore.revertRuleChange(args[0]));
      }
      throw new Error("security usage: pending list|approve|deny, rules list|add|delete, legislator <instruction>, rule-changes list|revert");
    }
    print(`Usage:
  piitool detect [--file path]|[text]
  piitool anon [--file path]|[text]
  piitool deanonymize [--file path]|[text]
  piitool image path/to/image.png
  piitool audio path/to/audio.wav
  piitool review list [status]
  piitool review approve-new <id>
  piitool review whitelist <id>
  piitool review merge <id> <entityId>
  piitool entities search <query>
  piitool entities whitelist <id> [true|false]
  piitool entities merge <sourceId> <targetId>
  piitool security pending list [status]
  piitool security pending approve <id>
  piitool security pending deny <id>
  piitool security rules list
  piitool security rules add '<json>'
  piitool security rules delete <id>
  piitool security legislator "<instruction>"
  piitool security rule-changes list
  piitool security rule-changes revert <id>

Env:
  PIITOOL_VAULT_PATH=./piitool.sqlite
  PIITOOL_DETECTOR_MODE=regex|local_llm|hybrid
  OLLAMA_BASE_URL=http://localhost:11434
  PIITOOL_DETECTOR_MODEL=qwen2.5:7b`);
  } finally {
    tool.close();
    securityStore.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
