import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { stableId } from "../core/normalize.ts";
import { redactSecretsForGateway } from "./secrets.ts";
import type {
  LegislatorDecision,
  ScopeRequest,
  SecurityAgentDecision,
  SecurityDecision,
  SecurityDecisionAudit,
  SecurityDirection,
  SecurityEffect,
  SecurityPending,
  SecurityRule,
  SecurityRuleChange,
  SecurityRulePatch,
  SecurityTargetType,
  ToolCallContext,
} from "./types.ts";

interface RuleRow {
  id: string;
  target_type: SecurityTargetType;
  target_name: string;
  direction: SecurityDirection;
  effect: SecurityEffect;
  param_match_json: string;
  scope_json: string;
  priority: number;
  created_at: string;
}

interface PendingRow {
  id: string;
  direction: "in" | "out";
  target_type: SecurityTargetType;
  target_name: string;
  input_json: string;
  output_json: string | null;
  agent_decision_json: string;
  status: "pending" | "approved" | "denied" | "timeout";
  created_at: string;
  resolved_at: string | null;
}

interface AuditRow {
  id: string;
  direction: "in" | "out";
  target_type: SecurityTargetType;
  target_name: string;
  decision: SecurityDecision;
  source: "policy" | "agent" | "human";
  risk_level: "low" | "medium" | "high" | "critical";
  reasons_json: string;
  created_at: string;
}

interface RuleChangeRow {
  id: string;
  actor: "legislator" | "human";
  user_message: string;
  before_json: string;
  after_json: string;
  diff_json: string;
  created_at: string;
  published: number;
}

export class SecurityStore {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  addRule(rule: Omit<SecurityRule, "id" | "createdAt"> & { id?: string }): SecurityRule {
    const id = rule.id ?? stableId("sec_rule", `${randomUUID()}:${rule.targetType}:${rule.targetName}`);
    this.db
      .query(
        `insert or replace into security_rules
         (id, target_type, target_name, direction, effect, param_match_json, scope_json, priority, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, coalesce((select created_at from security_rules where id = ?), datetime('now')))`,
      )
      .run(
        id,
        rule.targetType,
        rule.targetName,
        rule.direction,
        rule.effect,
        JSON.stringify(rule.paramMatch ?? {}),
        JSON.stringify(rule.scope ?? { type: "none", filesystem: [], network: false }),
        rule.priority ?? 0,
        id,
      );
    return this.getRule(id)!;
  }

  updateRule(id: string, patch: SecurityRulePatch): SecurityRule {
    const current = this.getRule(id);
    if (!current) throw new Error(`Missing security rule ${id}`);
    return this.addRule({
      id,
      targetType: patch.targetType ?? current.targetType,
      targetName: patch.targetName ?? current.targetName,
      direction: patch.direction ?? current.direction,
      effect: patch.effect ?? current.effect,
      paramMatch: patch.paramMatch ?? current.paramMatch,
      scope: patch.scope ?? current.scope,
      priority: patch.priority ?? current.priority,
    });
  }

  deleteRule(id: string): SecurityRule | null {
    const current = this.getRule(id);
    if (!current) return null;
    this.db.query("delete from security_rules where id = ?").run(id);
    return current;
  }

  listRules(): SecurityRule[] {
    return this.db
      .query<RuleRow, []>("select * from security_rules order by priority desc, created_at desc")
      .all()
      .map(ruleFromRow);
  }

  getRule(id: string): SecurityRule | null {
    const row = this.db.query<RuleRow, [string]>("select * from security_rules where id = ?").get(id);
    return row ? ruleFromRow(row) : null;
  }

  createPending(ctx: ToolCallContext, agentDecision: SecurityAgentDecision): SecurityPending {
    const id = stableId("sec_pending", `${randomUUID()}:${ctx.targetName}:${ctx.direction}`);
    this.db
      .query(
        `insert into security_pending
         (id, direction, target_type, target_name, input_json, output_json, agent_decision_json, status, created_at)
         values (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
      )
      .run(
        id,
        ctx.direction,
        ctx.targetType,
        ctx.targetName,
        JSON.stringify(redactSecretsForGateway(ctx.input ?? null)),
        ctx.output === undefined ? null : JSON.stringify(redactSecretsForGateway(ctx.output)),
        JSON.stringify(agentDecision),
      );
    return this.getPending(id)!;
  }

  listPending(status?: SecurityPending["status"]): SecurityPending[] {
    const rows = status
      ? this.db
          .query<PendingRow, [string]>("select * from security_pending where status = ? order by created_at desc")
          .all(status)
      : this.db.query<PendingRow, []>("select * from security_pending order by created_at desc").all();
    return rows.map(pendingFromRow);
  }

  getPending(id: string): SecurityPending | null {
    const row = this.db.query<PendingRow, [string]>("select * from security_pending where id = ?").get(id);
    return row ? pendingFromRow(row) : null;
  }

  resolvePending(id: string, status: "approved" | "denied" | "timeout"): SecurityPending {
    this.db.query("update security_pending set status = ?, resolved_at = datetime('now') where id = ?").run(status, id);
    const pending = this.getPending(id);
    if (!pending) throw new Error(`Missing security pending ${id}`);
    return pending;
  }

  recordDecision(audit: Omit<SecurityDecisionAudit, "id" | "createdAt">): SecurityDecisionAudit {
    const id = stableId("sec_decision", `${randomUUID()}:${audit.targetName}:${audit.decision}`);
    this.db
      .query(
        `insert into security_decisions
         (id, direction, target_type, target_name, decision, source, risk_level, reasons_json, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        id,
        audit.direction,
        audit.targetType,
        audit.targetName,
        audit.decision,
        audit.source,
        audit.riskLevel,
        JSON.stringify(audit.reasons),
      );
    return this.listDecisions(1)[0]!;
  }

  listDecisions(limit = 50): SecurityDecisionAudit[] {
    return this.db
      .query<AuditRow, [number]>("select * from security_decisions order by created_at desc limit ?")
      .all(limit)
      .map(auditFromRow);
  }

  recordRuleChange(actor: "legislator" | "human", userMessage: string, before: SecurityRule[], after: SecurityRule[], diff: string[]): SecurityRuleChange {
    const id = stableId("rule_change", `${randomUUID()}:${userMessage}`);
    this.db
      .query(
        `insert into security_rule_changes
         (id, actor, user_message, before_json, after_json, diff_json, created_at, published)
         values (?, ?, ?, ?, ?, ?, datetime('now'), 0)`,
      )
      .run(id, actor, userMessage, JSON.stringify(before), JSON.stringify(after), JSON.stringify(diff));
    return this.getRuleChange(id)!;
  }

  listRuleChanges(): SecurityRuleChange[] {
    return this.db
      .query<RuleChangeRow, []>("select * from security_rule_changes order by created_at desc")
      .all()
      .map(ruleChangeFromRow);
  }

  getRuleChange(id: string): SecurityRuleChange | null {
    const row = this.db.query<RuleChangeRow, [string]>("select * from security_rule_changes where id = ?").get(id);
    return row ? ruleChangeFromRow(row) : null;
  }

  markRuleChangePublished(id: string): SecurityRuleChange {
    this.db.query("update security_rule_changes set published = 1 where id = ?").run(id);
    const change = this.getRuleChange(id);
    if (!change) throw new Error(`Missing rule change ${id}`);
    return change;
  }

  revertRuleChange(id: string): SecurityRuleChange {
    const change = this.getRuleChange(id);
    if (!change) throw new Error(`Missing rule change ${id}`);
    this.replaceRules(change.before);
    return this.recordRuleChange("human", `revert:${id}`, change.after, change.before, [`reverted ${id}`]);
  }

  replaceRules(rules: SecurityRule[]): void {
    this.db.exec("delete from security_rules");
    for (const rule of rules) {
      this.addRule(rule);
    }
  }

  private migrate(): void {
    this.db.exec("pragma journal_mode = wal");
    for (const statement of [
      `create table if not exists security_rules (
        id text primary key,
        target_type text not null,
        target_name text not null,
        direction text not null,
        effect text not null,
        param_match_json text not null,
        scope_json text not null,
        priority integer not null default 0,
        created_at text not null
      )`,
      `create index if not exists idx_security_rules_target on security_rules(target_type, target_name, direction)`,
      `create table if not exists security_pending (
        id text primary key,
        direction text not null,
        target_type text not null,
        target_name text not null,
        input_json text not null,
        output_json text,
        agent_decision_json text not null,
        status text not null,
        created_at text not null,
        resolved_at text
      )`,
      `create index if not exists idx_security_pending_status on security_pending(status)`,
      `create table if not exists security_decisions (
        id text primary key,
        direction text not null,
        target_type text not null,
        target_name text not null,
        decision text not null,
        source text not null,
        risk_level text not null,
        reasons_json text not null,
        created_at text not null
      )`,
      `create table if not exists security_rule_changes (
        id text primary key,
        actor text not null,
        user_message text not null,
        before_json text not null,
        after_json text not null,
        diff_json text not null,
        created_at text not null,
        published integer not null default 0
      )`,
    ]) {
      this.db.exec(statement);
    }
  }
}

function ruleFromRow(row: RuleRow): SecurityRule {
  return {
    id: row.id,
    targetType: row.target_type,
    targetName: row.target_name,
    direction: row.direction,
    effect: row.effect,
    paramMatch: JSON.parse(row.param_match_json),
    scope: JSON.parse(row.scope_json) as ScopeRequest,
    priority: row.priority,
    createdAt: row.created_at,
  };
}

function pendingFromRow(row: PendingRow): SecurityPending {
  const decision = JSON.parse(row.agent_decision_json) as SecurityAgentDecision;
  return {
    id: row.id,
    direction: row.direction,
    targetType: row.target_type,
    targetName: row.target_name,
    input: JSON.parse(row.input_json),
    output: row.output_json ? JSON.parse(row.output_json) : undefined,
    agentDecision: decision,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    title: `${row.target_name} requires ${row.direction} approval`,
    summary: decision.reasons.join("; "),
    actions: ["approve", "deny", "approve_always_call", "deny_always_call", "approve_always_params", "approve_always_global"],
  };
}

function auditFromRow(row: AuditRow): SecurityDecisionAudit {
  return {
    id: row.id,
    direction: row.direction,
    targetType: row.target_type,
    targetName: row.target_name,
    decision: row.decision,
    source: row.source,
    riskLevel: row.risk_level,
    reasons: JSON.parse(row.reasons_json),
    createdAt: row.created_at,
  };
}

function ruleChangeFromRow(row: RuleChangeRow): SecurityRuleChange {
  return {
    id: row.id,
    actor: row.actor,
    userMessage: row.user_message,
    before: JSON.parse(row.before_json),
    after: JSON.parse(row.after_json),
    diff: JSON.parse(row.diff_json),
    createdAt: row.created_at,
    published: Boolean(row.published),
  };
}
