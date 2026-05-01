import type { LegislatorDecision, SecurityRule, SecurityRulePatch } from "./types.ts";
import { SecurityStore } from "./store.ts";

const MAX_LEGISLATOR_RULES_PER_SESSION = 20;

function validateRuleSafety(rule: Partial<SecurityRule>): string | null {
  if (rule.targetName === "*" && rule.effect?.startsWith("allow")) {
    return "Rejected: global allow-all rules (targetName='*' + allow) are forbidden";
  }
  if (rule.effect === "allow_always_global") {
    return "Rejected: allow_always_global requires manual creation via API, not legislator";
  }
  return null;
}

export interface LegislatorAgent {
  decide(message: string, rules: SecurityRule[], history: unknown[]): Promise<LegislatorDecision>;
}

export class HeuristicLegislatorAgent implements LegislatorAgent {
  async decide(message: string, rules: SecurityRule[]): Promise<LegislatorDecision> {
    const lower = message.toLowerCase();
    const target = extractTarget(message);

    if (lower.includes("delete") || lower.includes("supprime")) {
      const rule = target ? rules.find((r) => r.targetName === target || r.id === target) : undefined;
      return rule
        ? { action: "delete_rule", explanation: `Delete rule ${rule.id}`, affectedRuleIds: [rule.id], diffSummary: [`delete ${rule.id}`] }
        : { action: "needs_clarification", explanation: "No matching rule to delete", diffSummary: [] };
    }

    if (lower.includes("allow") || lower.includes("autorise") || lower.includes("approuve")) {
      return {
        action: "create_rule",
        explanation: `Allow ${target ?? "*"}`,
        rulePatch: {
          targetType: "mcp_tool",
          targetName: target ?? "*",
          direction: lower.includes("out") ? "out" : lower.includes("inout") ? "inout" : "in",
          effect: lower.includes("global") ? "allow_always_global" : "allow_always_call",
          paramMatch: {},
          scope: { type: "none", filesystem: [], network: false },
          priority: 10,
        },
        diffSummary: [`create allow rule for ${target ?? "*"}`],
      };
    }

    if (lower.includes("deny") || lower.includes("refuse") || lower.includes("bloque")) {
      return {
        action: "create_rule",
        explanation: `Deny ${target ?? "*"}`,
        rulePatch: {
          targetType: "mcp_tool",
          targetName: target ?? "*",
          direction: lower.includes("out") ? "out" : lower.includes("inout") ? "inout" : "in",
          effect: lower.includes("global") ? "deny_always_global" : "deny_always_call",
          paramMatch: {},
          scope: { type: "none", filesystem: [], network: false },
          priority: 100,
        },
        diffSummary: [`create deny rule for ${target ?? "*"}`],
      };
    }

    return { action: "needs_clarification", explanation: "No rule intent found", diffSummary: [] };
  }
}

export class LegislatorService {
  constructor(
    private store: SecurityStore,
    private agent: LegislatorAgent = new HeuristicLegislatorAgent(),
    private maxHistory = 50,
  ) {}

  async handleMessage(message: string) {
    const before = this.store.listRules();

    if (before.length >= MAX_LEGISLATOR_RULES_PER_SESSION) {
      return { message: "Rule limit reached. Delete unused rules before adding new ones.", changes: [] };
    }

    const history = this.store.listDecisions(this.maxHistory);
    const decision = await this.agent.decide(message, before, history);

    if (decision.action === "create_rule" && decision.rulePatch) {
      const candidate = ruleFromPatch(decision.rulePatch);
      const violation = validateRuleSafety(candidate);
      if (violation) {
        return { message: violation, changes: [] };
      }
      this.store.addRule(candidate);
    } else if (decision.action === "update_rule" && decision.rulePatch?.id) {
      const violation = validateRuleSafety(decision.rulePatch);
      if (violation) {
        return { message: violation, changes: [] };
      }
      this.store.updateRule(decision.rulePatch.id, decision.rulePatch);
    } else if (decision.action === "delete_rule" && decision.affectedRuleIds?.[0]) {
      this.store.deleteRule(decision.affectedRuleIds[0]);
    }

    const after = this.store.listRules();
    const diff = diffRules(before, after, decision.diffSummary);
    const change = this.store.markRuleChangePublished(
      this.store.recordRuleChange("legislator", message, before, after, diff).id,
    );

    return { decision, before, after, diffSummary: diff, change };
  }
}

function ruleFromPatch(patch: SecurityRulePatch): Omit<SecurityRule, "id" | "createdAt"> {
  return {
    targetType: patch.targetType ?? "mcp_tool",
    targetName: patch.targetName ?? "*",
    direction: patch.direction ?? "in",
    effect: patch.effect ?? "allow_always_call",
    paramMatch: patch.paramMatch ?? {},
    scope: patch.scope ?? { type: "none", filesystem: [], network: false },
    priority: patch.priority ?? 0,
  };
}

function diffRules(before: SecurityRule[], after: SecurityRule[], fallback: string[]): string[] {
  const beforeIds = new Set(before.map((r) => r.id));
  const afterIds = new Set(after.map((r) => r.id));
  const diff = [
    ...after.filter((r) => !beforeIds.has(r.id)).map((r) => `created ${r.id}`),
    ...before.filter((r) => !afterIds.has(r.id)).map((r) => `deleted ${r.id}`),
    ...after.filter((r) => beforeIds.has(r.id) && JSON.stringify(before.find((b) => b.id === r.id)) !== JSON.stringify(r)).map((r) => `updated ${r.id}`),
  ];
  return diff.length > 0 ? diff : fallback;
}

function extractTarget(message: string): string | undefined {
  const quoted = message.match(/["'`]([^"'`]+)["'`]/)?.[1];
  if (quoted) return quoted;
  return message.match(/\b([a-z0-9_.-]+\/[a-z0-9_.-]+|[a-z0-9_.-]+\.[a-z0-9_.-]+)\b/i)?.[1];
}
