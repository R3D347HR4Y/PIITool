import type { ParamMatch, SecurityDecision, SecurityDirection, SecurityRule, ToolCallContext } from "./types.ts";

export interface PolicyResult {
  matched: boolean;
  decision?: SecurityDecision;
  rule?: SecurityRule;
  reasons: string[];
}

export function evaluatePolicy(rules: SecurityRule[], ctx: ToolCallContext): PolicyResult {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (!ruleApplies(rule, ctx)) continue;
    const decision = effectToDecision(rule.effect);
    return {
      matched: true,
      decision,
      rule,
      reasons: [`matched_rule:${rule.id}`, `effect:${rule.effect}`],
    };
  }
  return { matched: false, reasons: ["no_matching_rule"] };
}

export function ruleApplies(rule: SecurityRule, ctx: ToolCallContext): boolean {
  if (rule.targetType !== ctx.targetType) return false;
  if (rule.targetName !== "*" && rule.targetName !== ctx.targetName) return false;
  if (!directionMatches(rule.direction, ctx.direction)) return false;
  return paramsMatch(rule.paramMatch, ctx.input);
}

function directionMatches(ruleDirection: SecurityDirection, ctxDirection: "in" | "out"): boolean {
  return ruleDirection === "inout" || ruleDirection === ctxDirection;
}

function effectToDecision(effect: SecurityRule["effect"]): SecurityDecision {
  return effect.startsWith("allow") ? "allow" : "deny";
}

export function paramsMatch(match: ParamMatch, input: unknown): boolean {
  if (!match || Object.keys(match).length === 0) return true;
  if (!input || typeof input !== "object") return false;
  const obj = input as Record<string, unknown>;
  return Object.entries(match).every(([key, condition]) => valueMatches(obj[key], condition));
}

function valueMatches(value: unknown, condition: unknown): boolean {
  if (Array.isArray(condition)) return condition.includes(String(value));
  if (!condition || typeof condition !== "object") return value === condition;

  const c = condition as {
    equals?: unknown;
    oneOf?: unknown[];
    under?: string[];
    readonly?: boolean;
    maxBytes?: number;
  };

  if ("equals" in c && value !== c.equals) return false;
  if (c.oneOf && !c.oneOf.includes(value)) return false;
  if (c.under) {
    const path = String(value ?? "");
    if (!c.under.some((prefix) => path === prefix || path.startsWith(prefix.replace(/\/$/, "") + "/"))) return false;
  }
  if (typeof c.maxBytes === "number") {
    const size = new TextEncoder().encode(JSON.stringify(value ?? "")).length;
    if (size > c.maxBytes) return false;
  }
  // `readonly` is declarative metadata. If present alone, it should not reject input.
  return true;
}
