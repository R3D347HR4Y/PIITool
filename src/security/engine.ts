import type { SecurityAgent } from "./agent.ts";
import { evaluatePolicy } from "./policy.ts";
import type { ScopeRunner } from "./scope.ts";
import { DirectScopeRunner } from "./scope.ts";
import { SecurityStore } from "./store.ts";
import type {
  ParamMatch,
  SecurityDecision,
  SecurityEffect,
  SecurityEvaluation,
  SecurityPending,
  SecurityRule,
  ToolCallContext,
} from "./types.ts";

interface Waiter {
  resolve: (value: "approved" | "denied" | "timeout") => void;
  timeout: Timer;
}

export class SecurityEngine {
  private waiters = new Map<string, Waiter>();

  constructor(
    readonly store: SecurityStore,
    private agent: SecurityAgent,
    private options: {
      mode: "off" | "policy" | "agent" | "agent_with_human";
      timeoutMs: number;
      defaultDecision: "allow" | "deny" | "pending_approval";
    },
    private scopeRunner: ScopeRunner = new DirectScopeRunner(),
  ) {}

  async evaluateIn(ctx: Omit<ToolCallContext, "direction">): Promise<SecurityEvaluation> {
    return this.evaluate({ ...ctx, direction: "in" });
  }

  async evaluateOut(ctx: Omit<ToolCallContext, "direction">): Promise<SecurityEvaluation> {
    return this.evaluate({ ...ctx, direction: "out" });
  }

  async runSecuredToolCall<T>(
    ctx: Omit<ToolCallContext, "direction" | "output">,
    execute: () => Promise<T>,
  ): Promise<T> {
    const inResult = await this.evaluateIn(ctx);
    if (inResult.decision === "deny") throw new Error(`Security denied input: ${inResult.reasons.join("; ")}`);
    if (inResult.decision === "pending_approval") {
      const approved = await this.waitForApproval(inResult.pendingId!);
      if (approved !== "approved") throw new Error(`Security input ${approved}`);
    }

    const out = await this.scopeRunner.run(inResult.requiredScope ?? { type: "none", filesystem: [], network: false }, execute);
    const outResult = await this.evaluateOut({ ...ctx, output: out });
    if (outResult.decision === "deny") throw new Error(`Security denied output: ${outResult.reasons.join("; ")}`);
    if (outResult.decision === "pending_approval") {
      const approved = await this.waitForApproval(outResult.pendingId!);
      if (approved !== "approved") throw new Error(`Security output ${approved}`);
    }
    return out;
  }

  approvePending(id: string, effect?: SecurityEffect): SecurityPending {
    const pending = this.store.resolvePending(id, "approved");
    if (effect) this.createRuleFromPending(pending, effect);
    const waiter = this.waiters.get(id);
    if (waiter) {
      clearTimeout(waiter.timeout);
      waiter.resolve("approved");
      this.waiters.delete(id);
    }
    return pending;
  }

  denyPending(id: string, effect?: SecurityEffect): SecurityPending {
    const pending = this.store.resolvePending(id, "denied");
    if (effect) this.createRuleFromPending(pending, effect);
    const waiter = this.waiters.get(id);
    if (waiter) {
      clearTimeout(waiter.timeout);
      waiter.resolve("denied");
      this.waiters.delete(id);
    }
    return pending;
  }

  waitForApproval(id: string): Promise<"approved" | "denied" | "timeout"> {
    const pending = this.store.getPending(id);
    if (!pending) return Promise.resolve("denied");
    if (pending.status !== "pending") return Promise.resolve(pending.status === "approved" ? "approved" : "denied");

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.store.resolvePending(id, "timeout");
        this.waiters.delete(id);
        resolve("timeout");
      }, this.options.timeoutMs);
      this.waiters.set(id, { resolve, timeout });
    });
  }

  private async evaluate(ctx: ToolCallContext): Promise<SecurityEvaluation> {
    if (this.options.mode === "off") return this.audit(ctx, "allow", "policy", "low", ["security_off"]);

    const rules = this.store.listRules();
    const policy = evaluatePolicy(rules, ctx);
    if (policy.matched && policy.decision) {
      return this.audit(ctx, policy.decision, "policy", policy.decision === "allow" ? "low" : "high", policy.reasons, policy.rule);
    }

    if (this.options.mode === "policy") {
      return this.audit(ctx, this.options.defaultDecision, "policy", "medium", ["policy_default"]);
    }

    const agentDecision = await this.agent.decide(ctx, rules);
    if (agentDecision.decision === "pending_approval" || this.options.mode === "agent_with_human") {
      const pending = this.store.createPending(ctx, agentDecision);
      this.store.recordDecision({
        direction: ctx.direction,
        targetType: ctx.targetType,
        targetName: ctx.targetName,
        decision: "pending_approval",
        source: "agent",
        riskLevel: agentDecision.riskLevel,
        reasons: agentDecision.reasons,
      });
      return {
        decision: "pending_approval",
        source: "agent",
        riskLevel: agentDecision.riskLevel,
        reasons: agentDecision.reasons,
        pendingId: pending.id,
        requiredScope: agentDecision.requiredScope,
      };
    }

    return this.audit(ctx, agentDecision.decision, "agent", agentDecision.riskLevel, agentDecision.reasons);
  }

  private audit(
    ctx: ToolCallContext,
    decision: SecurityDecision,
    source: "policy" | "agent" | "human",
    riskLevel: SecurityEvaluation["riskLevel"],
    reasons: string[],
    rule?: SecurityRule,
  ): SecurityEvaluation {
    this.store.recordDecision({
      direction: ctx.direction,
      targetType: ctx.targetType,
      targetName: ctx.targetName,
      decision,
      source,
      riskLevel,
      reasons,
    });
    return {
      decision,
      source,
      riskLevel,
      reasons,
      ruleId: rule?.id,
      requiredScope: rule?.scope,
    };
  }

  private createRuleFromPending(pending: SecurityPending, effect: SecurityEffect): void {
    this.store.addRule({
      targetType: pending.targetType,
      targetName: effect.endsWith("_global") ? "*" : pending.targetName,
      direction: pending.direction,
      effect,
      paramMatch: effect.endsWith("_params") ? extractParamMatch(pending.input) : {},
      scope: pending.agentDecision.requiredScope ?? { type: "none", filesystem: [], network: false },
      priority: effect.startsWith("deny") ? 100 : 10,
    });
  }
}

function extractParamMatch(input: unknown): ParamMatch {
  if (!input || typeof input !== "object") return {};
  const obj = input as Record<string, unknown>;
  const match: ParamMatch = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      match[key] = { equals: value };
    }
  }
  return match;
}
