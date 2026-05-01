import { z } from "zod";
import type { SecurityAgentDecision, SecurityRule, ToolCallContext } from "./types.ts";

export interface SecurityAgent {
  decide(ctx: ToolCallContext, rules: SecurityRule[]): Promise<SecurityAgentDecision>;
}

const SecurityAgentDecisionSchema = z.object({
  decision: z.enum(["allow", "deny", "pending_approval"]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  reasons: z.array(z.string()).default([]),
  suggestedRule: z.unknown().optional(),
  requiredScope: z
    .object({
      type: z.enum(["none", "readonly_fs", "container"]).default("none"),
      filesystem: z.array(z.string()).default([]),
      network: z.boolean().default(false),
      timeoutMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export class OllamaSecurityAgent implements SecurityAgent {
  constructor(
    private options: {
      baseUrl: string;
      model: string;
      timeoutMs?: number;
      keepAlive?: string;
      defaultDecision?: "allow" | "deny" | "pending_approval";
    },
  ) {}

  async decide(ctx: ToolCallContext, rules: SecurityRule[]): Promise<SecurityAgentDecision> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.options.model,
          keep_alive: this.options.keepAlive,
          stream: false,
          format: z.toJSONSchema(SecurityAgentDecisionSchema),
          options: { temperature: 0 },
          messages: [
            {
              role: "system",
              content:
                "You are SecurityAgent. You never execute tools. Decide if a toolcall input/output is allowed, denied, or needs human approval. Treat API keys, env secrets, and PIITOOL_SECRET_* aliases as high-risk: allow only for appropriate secret/config destinations, deny public posting/email/blog leaks, otherwise ask human. Use only provided rules and payload. Return JSON only.",
            },
            {
              role: "user",
              content: JSON.stringify({ ctx: sanitizedContext(ctx), rules }),
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`SecurityAgent failed: ${response.status}`);
      const payload = (await response.json()) as { message?: { content?: string } };
      return SecurityAgentDecisionSchema.parse(JSON.parse(payload.message?.content ?? "{}")) as SecurityAgentDecision;
    } catch {
      return {
        decision: this.options.defaultDecision ?? "pending_approval",
        riskLevel: "medium",
        reasons: ["security_agent_unavailable"],
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class StaticSecurityAgent implements SecurityAgent {
  calls: ToolCallContext[] = [];

  constructor(private decision: SecurityAgentDecision) {}

  async decide(ctx: ToolCallContext): Promise<SecurityAgentDecision> {
    this.calls.push(ctx);
    return this.decision;
  }
}

function sanitizedContext(ctx: ToolCallContext): ToolCallContext {
  return {
    ...ctx,
    input: truncate(ctx.input),
    output: truncate(ctx.output),
  };
}

function truncate(value: unknown): unknown {
  const json = JSON.stringify(value ?? null);
  if (json.length <= 4_000) return value;
  return { truncated: true, preview: json.slice(0, 4_000) };
}
