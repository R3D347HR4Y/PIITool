import { z } from "zod";

export const SecurityDirectionSchema = z.enum(["in", "out", "inout"]);
export type SecurityDirection = z.infer<typeof SecurityDirectionSchema>;

export const SecurityTargetTypeSchema = z.enum(["mcp_tool", "mcp_resource", "skill", "toolcall"]);
export type SecurityTargetType = z.infer<typeof SecurityTargetTypeSchema>;

export const SecurityEffectSchema = z.enum([
  "allow_once",
  "deny_once",
  "allow_always_call",
  "deny_always_call",
  "allow_always_call_params",
  "deny_always_call_params",
  "allow_always_global",
  "deny_always_global",
]);
export type SecurityEffect = z.infer<typeof SecurityEffectSchema>;

export const SecurityDecisionSchema = z.enum(["allow", "deny", "pending_approval"]);
export type SecurityDecision = z.infer<typeof SecurityDecisionSchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ScopeRequestSchema = z.object({
  type: z.enum(["none", "readonly_fs", "container"]).default("none"),
  filesystem: z.array(z.string()).default([]),
  network: z.boolean().default(false),
  timeoutMs: z.number().int().positive().optional(),
});
export type ScopeRequest = z.infer<typeof ScopeRequestSchema>;

export const ParamConditionSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.object({
    equals: z.unknown().optional(),
    oneOf: z.array(z.unknown()).optional(),
    under: z.array(z.string()).optional(),
    readonly: z.boolean().optional(),
    maxBytes: z.number().int().positive().optional(),
  }),
]);
export const ParamMatchSchema = z.record(z.string(), ParamConditionSchema).default({});
export type ParamMatch = z.infer<typeof ParamMatchSchema>;

export interface SecurityRule {
  id: string;
  targetType: SecurityTargetType;
  targetName: string;
  direction: SecurityDirection;
  effect: SecurityEffect;
  paramMatch: ParamMatch;
  scope: ScopeRequest;
  priority: number;
  createdAt: string;
}

export interface ToolCallContext {
  targetType: SecurityTargetType;
  targetName: string;
  direction: "in" | "out";
  input: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
}

export interface SecurityAgentDecision {
  decision: SecurityDecision;
  riskLevel: RiskLevel;
  reasons: string[];
  suggestedRule?: Partial<SecurityRule>;
  requiredScope?: ScopeRequest;
}

export interface SecurityEvaluation {
  decision: SecurityDecision;
  source: "policy" | "agent" | "human";
  riskLevel: RiskLevel;
  reasons: string[];
  pendingId?: string;
  ruleId?: string;
  requiredScope?: ScopeRequest;
}

export interface SecurityPending {
  id: string;
  direction: "in" | "out";
  targetType: SecurityTargetType;
  targetName: string;
  input: unknown;
  output?: unknown;
  agentDecision: SecurityAgentDecision;
  status: "pending" | "approved" | "denied" | "timeout";
  createdAt: string;
  resolvedAt: string | null;
  title: string;
  summary: string;
  actions: string[];
}

export interface SecurityDecisionAudit {
  id: string;
  direction: "in" | "out";
  targetType: SecurityTargetType;
  targetName: string;
  decision: SecurityDecision;
  source: "policy" | "agent" | "human";
  riskLevel: RiskLevel;
  reasons: string[];
  createdAt: string;
}

export const LegislatorActionSchema = z.enum(["create_rule", "update_rule", "delete_rule", "no_change", "needs_clarification"]);
export type LegislatorAction = z.infer<typeof LegislatorActionSchema>;

export interface SecurityRulePatch {
  id?: string;
  targetType?: SecurityTargetType;
  targetName?: string;
  direction?: SecurityDirection;
  effect?: SecurityEffect;
  paramMatch?: ParamMatch;
  scope?: ScopeRequest;
  priority?: number;
}

export interface LegislatorDecision {
  action: LegislatorAction;
  explanation: string;
  rulePatch?: SecurityRulePatch;
  affectedRuleIds?: string[];
  diffSummary: string[];
}

export interface SecurityRuleChange {
  id: string;
  actor: "legislator" | "human";
  userMessage: string;
  before: SecurityRule[];
  after: SecurityRule[];
  diff: string[];
  createdAt: string;
  published: boolean;
}
