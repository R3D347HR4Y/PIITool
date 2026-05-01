import { PiiTool } from "../core/piitool.ts";
import { loadConfig } from "../core/config.ts";
import { anonymizeJson, deanonymizeJson } from "./jsonFilter.ts";
import { OllamaSecurityAgent } from "../security/agent.ts";
import { SecurityEngine } from "../security/engine.ts";
import { LegislatorService } from "../security/legislator.ts";
import { SecurityStore } from "../security/store.ts";

const config = loadConfig();

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function proxyChat(instance: PiiTool, cfg: typeof config, body: Record<string, unknown>): Promise<Response> {
  const wantedStream = body.stream === true;
  const anonymized = (await anonymizeJson(instance, { ...body, stream: false })) as Record<string, unknown>;
  const upstreamModel = cfg.upstream.model;
  if (upstreamModel) anonymized.model = upstreamModel;

  const upstream = await fetch(`${cfg.upstream.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cfg.upstream.apiKey ? { authorization: `Bearer ${cfg.upstream.apiKey}` } : {}),
    },
    body: JSON.stringify(anonymized),
  });

  const payload = await upstream.json();
  const deanonymized = await deanonymizeJson(instance, payload);
  if (!wantedStream) return json(deanonymized, upstream.status);

  return new Response(`data: ${JSON.stringify(deanonymized)}\n\ndata: [DONE]\n\n`, {
    status: upstream.status,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

export function createGatewayHandler(instance: PiiTool, cfg = config): (request: Request) => Promise<Response> {
  const securityStore = new SecurityStore(cfg.vaultPath);
  const securityEngine = new SecurityEngine(
    securityStore,
    new OllamaSecurityAgent({
      baseUrl: cfg.ollama.baseUrl,
      model: cfg.security.model,
      timeoutMs: 30_000,
      keepAlive: cfg.ollama.keepAlive,
      defaultDecision: cfg.security.defaultDecision,
    }),
    {
      mode: cfg.security.mode,
      timeoutMs: cfg.security.timeoutMs,
      defaultDecision: cfg.security.defaultDecision,
    },
  );
  const legislator = new LegislatorService(securityStore, undefined, cfg.security.legislatorMaxHistory);

  return async (request) => {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/filter/anonymize") {
        const { text } = (await request.json()) as { text?: string };
        if (typeof text !== "string") return json({ error: "text must be string" }, 400);
        return json(await instance.anonymize(text));
      }
      if (request.method === "POST" && url.pathname === "/v1/filter/deanonymize") {
        const { text } = (await request.json()) as { text?: string };
        if (typeof text !== "string") return json({ error: "text must be string" }, 400);
        return json(await instance.deanonymize(text));
      }
      if (request.method === "GET" && url.pathname === "/v1/review/items") {
        const status = url.searchParams.get("status") ?? undefined;
        return json(instance.vault.listReviewItems(status as never));
      }
      const reviewMatch = url.pathname.match(/^\/v1\/review\/items\/([^/]+)(?:\/([^/]+))?$/);
      if (reviewMatch) {
        const [, id, action] = reviewMatch;
        if (request.method === "GET" && !action) return json(instance.vault.getReviewItem(id!) ?? { error: "not found" }, instance.vault.getReviewItem(id!) ? 200 : 404);
        if (request.method === "POST" && action === "approve-new") return json(instance.vault.approveNew(id!));
        if (request.method === "POST" && action === "whitelist") return json(instance.vault.whitelistReviewItem(id!));
        if (request.method === "POST" && action === "merge") {
          const { targetEntityId } = (await request.json()) as { targetEntityId?: string };
          if (!targetEntityId) return json({ error: "targetEntityId required" }, 400);
          return json(instance.vault.mergeReviewItem(id!, targetEntityId));
        }
      }
      if (request.method === "GET" && url.pathname === "/v1/entities") {
        const kind = url.searchParams.get("kind") ?? undefined;
        const q = url.searchParams.get("q") ?? undefined;
        return json(instance.vault.listEntities(kind as never, q));
      }
      const entityMatch = url.pathname.match(/^\/v1\/entities\/([^/]+)(?:\/([^/]+))?$/);
      if (entityMatch && request.method === "POST") {
        const [, id, action] = entityMatch;
        if (action === "whitelist") {
          const body = (await request.json()) as { whitelisted?: boolean };
          return json(instance.vault.setEntityWhitelist(id!, body.whitelisted !== false));
        }
        if (action === "merge") {
          const { targetEntityId } = (await request.json()) as { targetEntityId?: string };
          if (!targetEntityId) return json({ error: "targetEntityId required" }, 400);
          return json(instance.vault.mergeEntities(id!, targetEntityId));
        }
      }
      if (request.method === "GET" && url.pathname === "/v1/security/pending") {
        const status = url.searchParams.get("status") ?? undefined;
        return json(securityStore.listPending(status as never));
      }
      const securityPendingMatch = url.pathname.match(/^\/v1\/security\/pending\/([^/]+)(?:\/([^/]+))?$/);
      if (securityPendingMatch) {
        const [, id, action] = securityPendingMatch;
        if (request.method === "GET" && !action) return json(securityStore.getPending(id!) ?? { error: "not found" }, securityStore.getPending(id!) ? 200 : 404);
        if (request.method === "POST" && action === "approve") return json(securityEngine.approvePending(id!));
        if (request.method === "POST" && action === "deny") return json(securityEngine.denyPending(id!));
        if (request.method === "POST" && action === "approve-always-call") return json(securityEngine.approvePending(id!, "allow_always_call"));
        if (request.method === "POST" && action === "deny-always-call") return json(securityEngine.denyPending(id!, "deny_always_call"));
        if (request.method === "POST" && action === "approve-always-params") return json(securityEngine.approvePending(id!, "allow_always_call_params"));
        if (request.method === "POST" && action === "approve-always-global") return json(securityEngine.approvePending(id!, "allow_always_global"));
      }
      if (request.method === "GET" && url.pathname === "/v1/security/rules") {
        return json(securityStore.listRules());
      }
      if (request.method === "POST" && url.pathname === "/v1/security/rules") {
        return json(securityStore.addRule((await request.json()) as never));
      }
      const securityRuleMatch = url.pathname.match(/^\/v1\/security\/rules\/([^/]+)$/);
      if (securityRuleMatch && request.method === "DELETE") {
        const deleted = securityStore.deleteRule(securityRuleMatch[1]!);
        return json(deleted ?? { error: "not found" }, deleted ? 200 : 404);
      }
      if (request.method === "POST" && url.pathname === "/v1/security/legislator/message") {
        const { message } = (await request.json()) as { message?: string };
        if (!message) return json({ error: "message required" }, 400);
        return json(await legislator.handleMessage(message));
      }
      if (request.method === "GET" && url.pathname === "/v1/security/rule-changes") {
        return json(securityStore.listRuleChanges());
      }
      const ruleChangeMatch = url.pathname.match(/^\/v1\/security\/rule-changes\/([^/]+)(?:\/([^/]+))?$/);
      if (ruleChangeMatch) {
        const [, id, action] = ruleChangeMatch;
        if (request.method === "GET" && !action) return json(securityStore.getRuleChange(id!) ?? { error: "not found" }, securityStore.getRuleChange(id!) ? 200 : 404);
        if (request.method === "POST" && action === "revert") return json(securityStore.revertRuleChange(id!));
      }
      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        return proxyChat(instance, cfg, (await request.json()) as Record<string, unknown>);
      }
      return json({ error: "not found" }, 404);
    } catch (error) {
      if (cfg.failClosed) return json({ error: "PIITool failed closed" }, 500);
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  };
}

if (import.meta.main) {
  const tool = new PiiTool(config);
  const server = Bun.serve({
    port: config.gatewayPort,
    async fetch(request) {
      return createGatewayHandler(tool, config)(request);
    },
  });

  console.log(`PIITool gateway listening on http://localhost:${server.port}`);
}
