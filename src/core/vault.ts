import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import type { EntityKind, PiiSpan, Replacement } from "./schema.ts";
import { decryptMaybe, encryptMaybe } from "./crypto.ts";
import { generateMirrorValue, generateMirrorPerson, extractCompanySuffix, type MirrorContext } from "./mirror.ts";
import { normalizeValue, redactPreview, stableHash, stableId } from "./normalize.ts";
import { NamePool } from "./namepool.ts";

export type ReviewStatus = "pending" | "approved_new" | "approved_merge" | "whitelisted" | "ignored";

export interface ReviewCandidate {
  entityId: string;
  kind: EntityKind;
  primaryValue: string;
  mirrorValue: string | null;
  score: number;
  reasons: string[];
}

export interface ReviewItem {
  id: string;
  kind: EntityKind;
  value: string;
  status: ReviewStatus;
  reason: string;
  span: PiiSpan | null;
  candidates: ReviewCandidate[];
  createdAt: string;
  resolvedAt: string | null;
}

export interface EntitySummary {
  id: string;
  kind: EntityKind;
  isReal: boolean;
  mirrorId: string | null;
  whitelisted: boolean;
  primaryValue: string | null;
  mirrorValue: string | null;
}

interface EntityRow {
  id: string;
  kind: EntityKind;
  is_real: number;
  mirror_id: string | null;
  whitelisted: number;
  locale: string | null;
  metadata_json: string;
}

interface AttributeRow {
  entity_id: string;
  key: string;
  value: string;
}

interface ReviewItemRow {
  id: string;
  kind: EntityKind;
  value: string;
  status: ReviewStatus;
  reason: string;
  span_json: string;
  candidate_json: string;
  created_at: string;
  resolved_at: string | null;
}

export class PiiVault {
  private db: Database;
  private secret?: string;
  readonly pool: NamePool;

  constructor(
    path: string,
    secret = process.env.PIITOOL_VAULT_KEY,
    ollamaBaseUrl = "http://localhost:11434",
    ollamaModel = "qwen2.5:7b",
    private reviewMode: "auto" | "queue" = "auto",
  ) {
    this.db = new Database(path);
    this.secret = secret;
    this.migrate();
    this.pool = new NamePool(this.db, ollamaBaseUrl, ollamaModel);
  }

  close(): void {
    this.db.close();
  }

  resolve(kind: EntityKind, value: string, formatHint?: string, ctx?: Partial<MirrorContext>): Replacement | null {
    const normalized = normalizeValue(value);
    const valueHash = stableHash(`${kind}:${normalized}`);
    const existing = this.db
      .query<EntityRow, [string]>(
        `select e.* from entities e
         join attributes a on a.entity_id = e.id
         where e.is_real = 1 and a.normalized_hash = ? limit 1`,
      )
      .get(valueHash);

    const candidates = this.findCandidates(kind, value);
    const hasFuzzyRisk = candidates.some((c) => c.score >= 0.55 && c.entityId !== existing?.id);
    const shouldReview =
      this.isReviewableKind(kind) &&
      ((!existing && (this.reviewMode === "queue" || hasFuzzyRisk)) ||
        (Boolean(existing) && candidates.some((c) => c.score >= 0.82 && c.entityId !== existing?.id)));

    const real = existing ?? this.createEntity(kind, true, value);
    if (real.whitelisted) return null;
    if (shouldReview) {
      this.createReviewItem(
        {
          start: 0,
          end: value.length,
          text: value,
          kind,
          confidence: 1,
          formatHint,
          source: "vault",
        },
        candidates.filter((c) => c.entityId !== real.id),
        existing ? "fuzzy_candidate" : "new_entity",
      );
    }

    const fullCtx = this.buildContext(ctx);

    if (real.mirror_id) {
      const fake = this.getPrimaryValue(real.mirror_id) ?? generateMirrorValue(kind, value, real.id, fullCtx);
      return { real: value, fake, kind, entityId: real.id, mirrorId: real.mirror_id };
    }

    const fake = generateMirrorValue(kind, value, real.id, fullCtx);
    const mirror = this.createEntity(kind, false, fake);
    this.db.query("update entities set mirror_id = ? where id = ?").run(mirror.id, real.id);
    this.upsertAttribute(mirror.id, kind, fake, formatHint, 1, "mirror");

    return { real: value, fake, kind, entityId: real.id, mirrorId: mirror.id };
  }

  resolveCoherent(spans: PiiSpan[]): Map<number, Replacement> {
    const results = new Map<number, Replacement>();
    const clusters = clusterSpans(spans);

    for (const cluster of clusters) {
      const personSpan = cluster.find((s) => s.span.kind === "person");
      const companySpan = cluster.find((s) => s.span.kind === "company");
      const emailSpan = cluster.find((s) => s.span.kind === "email");

      let personFirst: string | undefined;
      let personLast: string | undefined;
      let companyMirror: string | undefined;
      let companySuffix: string | undefined;
      let locale = "en";

      if (companySpan) {
        const { suffix } = extractCompanySuffix(companySpan.span.text);
        companySuffix = suffix || undefined;
        const companyReplacement = this.resolve(companySpan.span.kind, companySpan.span.text, companySpan.span.formatHint, {
          companySuffix,
          locale,
        });
        if (companyReplacement) {
          results.set(companySpan.idx, companyReplacement);
          companyMirror = companyReplacement.fake;
        }
      }

      if (personSpan) {
        const personCtx: Partial<MirrorContext> = { locale, linkedCompanyMirror: companyMirror };
        const personReplacement = this.resolve(personSpan.span.kind, personSpan.span.text, personSpan.span.formatHint, personCtx);
        if (personReplacement) {
          results.set(personSpan.idx, personReplacement);
          const parts = personReplacement.fake.split(/\s+/);
          personFirst = parts[0];
          personLast = parts.slice(1).join(" ");
        }
      }

      const derivedCtx: Partial<MirrorContext> = {
        locale,
        linkedPersonFirst: personFirst,
        linkedPersonLast: personLast,
        linkedCompanyMirror: companyMirror,
        companySuffix,
      };

      for (const entry of cluster) {
        if (results.has(entry.idx)) continue;
        const replacement = this.resolve(entry.span.kind, entry.span.text, entry.span.formatHint, derivedCtx);
        if (replacement) results.set(entry.idx, replacement);
      }
    }

    return results;
  }

  reverseLookup(fake: string): Replacement | null {
    const normalized = normalizeValue(fake);
    const valueHash = stableHash(`mirror:${normalized}`);
    const mirrorAttr = this.db
      .query<AttributeRow, [string]>(
        `select entity_id, key, value from attributes where normalized_hash = ? limit 1`,
      )
      .get(valueHash);
    if (!mirrorAttr) return null;

    const mirror = this.getEntity(mirrorAttr.entity_id);
    const real = this.db.query<EntityRow, [string]>("select * from entities where mirror_id = ? limit 1").get(mirror.id);
    if (!real) return null;
    const realValue = this.getPrimaryValue(real.id);
    if (!realValue) return null;

    return { real: realValue, fake, kind: real.kind, entityId: real.id, mirrorId: mirror.id };
  }

  recordEvent(direction: string, input: string, output: string, replacements: Replacement[]): string {
    const id = stableId("evt", `${randomUUID()}:${direction}:${Date.now()}:${input}:${output}`);
    this.db
      .query(
        `insert into events (id, direction, input_preview, output_preview, replacement_count, metadata_json, created_at)
         values (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        id,
        direction,
        redactPreview(input),
        redactPreview(output),
        replacements.length,
        JSON.stringify({ kinds: [...new Set(replacements.map((r) => r.kind))] }),
      );
    return id;
  }

  listReviewItems(status?: ReviewStatus): ReviewItem[] {
    const rows = status
      ? this.db
          .query<ReviewItemRow, [string]>("select * from review_items where status = ? order by created_at desc")
          .all(status)
      : this.db.query<ReviewItemRow, []>("select * from review_items order by created_at desc").all();
    return rows.map((row) => this.reviewItemFromRow(row));
  }

  getReviewItem(id: string): ReviewItem | null {
    const row = this.db.query<ReviewItemRow, [string]>("select * from review_items where id = ?").get(id);
    return row ? this.reviewItemFromRow(row) : null;
  }

  createReviewItem(span: PiiSpan, candidates: ReviewCandidate[], reason: string): ReviewItem {
    const hash = stableHash(`${span.kind}:${normalizeValue(span.text)}`);
    const existing = this.db
      .query<ReviewItemRow, [string, string]>("select * from review_items where normalized_hash = ? and status = ? limit 1")
      .get(hash, "pending");
    if (existing) return this.reviewItemFromRow(existing);

    const id = stableId("review", `${randomUUID()}:${span.kind}:${span.text}`);
    this.db
      .query(
        `insert into review_items
         (id, kind, value, normalized_hash, status, reason, span_json, candidate_json, created_at)
         values (?, ?, ?, ?, 'pending', ?, ?, ?, datetime('now'))`,
      )
      .run(id, span.kind, span.text, hash, reason, JSON.stringify(span), JSON.stringify(candidates));
    const created = this.getReviewItem(id);
    if (!created) throw new Error(`Missing created review item ${id}`);
    return created;
  }

  approveNew(reviewId: string): ReviewItem {
    const item = this.requireReviewItem(reviewId);
    const entity = this.ensureEntity(item.kind, item.value);
    if (!entity.mirror_id) {
      this.resolve(item.kind, item.value);
    }
    return this.updateReviewStatus(reviewId, "approved_new");
  }

  whitelistReviewItem(reviewId: string): ReviewItem {
    const item = this.requireReviewItem(reviewId);
    const entity = this.ensureEntity(item.kind, item.value);
    this.setEntityWhitelist(entity.id, true);
    return this.updateReviewStatus(reviewId, "whitelisted");
  }

  mergeReviewItem(reviewId: string, targetEntityId: string): ReviewItem {
    const item = this.requireReviewItem(reviewId);
    const source = this.ensureEntity(item.kind, item.value);
    this.mergeEntities(source.id, targetEntityId);
    return this.updateReviewStatus(reviewId, "approved_merge");
  }

  setEntityWhitelist(entityId: string, whitelisted: boolean): EntitySummary {
    this.db.query("update entities set whitelisted = ? where id = ?").run(whitelisted ? 1 : 0, entityId);
    return this.getEntitySummary(entityId);
  }

  listEntities(kind?: EntityKind, query?: string): EntitySummary[] {
    const rows = kind
      ? this.db
          .query<EntityRow, [string]>("select * from entities where kind = ? and is_real = 1 order by created_at desc")
          .all(kind)
      : this.db.query<EntityRow, []>("select * from entities where is_real = 1 order by created_at desc").all();
    const normalizedQuery = query ? normalizeValue(query) : "";
    return rows
      .map((row) => this.entitySummaryFromRow(row))
      .filter((entity) => !normalizedQuery || normalizeValue(entity.primaryValue ?? "").includes(normalizedQuery) || entity.id.includes(normalizedQuery));
  }

  mergeEntities(sourceEntityId: string, targetEntityId: string): EntitySummary {
    const source = this.getEntity(sourceEntityId);
    const target = this.getEntity(targetEntityId);
    if (!target.mirror_id) throw new Error(`Target entity ${targetEntityId} has no mirror`);
    if (source.kind !== target.kind) throw new Error(`Cannot merge ${source.kind} into ${target.kind}`);
    this.db.query("update entities set mirror_id = ?, whitelisted = 0 where id = ?").run(target.mirror_id, source.id);
    this.db
      .query("insert into merge_links (from_entity_id, to_entity_id, metadata_json, created_at) values (?, ?, ?, datetime('now'))")
      .run(source.id, target.id, "{}");
    return this.getEntitySummary(source.id);
  }

  findCandidates(kind: EntityKind, value: string): ReviewCandidate[] {
    const normalized = normalizeValue(value);
    const rows = this.db
      .query<EntityRow, [string]>("select * from entities where kind = ? and is_real = 1 order by created_at desc")
      .all(kind);
    return rows
      .map((row) => this.scoreCandidate(row, normalized, value))
      .filter((candidate): candidate is ReviewCandidate => candidate !== null && candidate.score >= 0.55)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  private isReviewableKind(kind: EntityKind): boolean {
    return kind === "person" || kind === "company";
  }

  private requireReviewItem(id: string): ReviewItem {
    const item = this.getReviewItem(id);
    if (!item) throw new Error(`Missing review item ${id}`);
    return item;
  }

  private updateReviewStatus(id: string, status: ReviewStatus): ReviewItem {
    this.db.query("update review_items set status = ?, resolved_at = datetime('now') where id = ?").run(status, id);
    return this.requireReviewItem(id);
  }

  private reviewItemFromRow(row: ReviewItemRow): ReviewItem {
    return {
      id: row.id,
      kind: row.kind,
      value: row.value,
      status: row.status,
      reason: row.reason,
      span: JSON.parse(row.span_json) as PiiSpan,
      candidates: JSON.parse(row.candidate_json) as ReviewCandidate[],
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }

  private ensureEntity(kind: EntityKind, value: string): EntityRow {
    const normalized = normalizeValue(value);
    const hash = stableHash(`${kind}:${normalized}`);
    const existing = this.db
      .query<EntityRow, [string]>(
        `select e.* from entities e
         join attributes a on a.entity_id = e.id
         where e.is_real = 1 and a.normalized_hash = ? limit 1`,
      )
      .get(hash);
    return existing ?? this.createEntity(kind, true, value);
  }

  private getEntitySummary(entityId: string): EntitySummary {
    return this.entitySummaryFromRow(this.getEntity(entityId));
  }

  private entitySummaryFromRow(row: EntityRow): EntitySummary {
    return {
      id: row.id,
      kind: row.kind,
      isReal: Boolean(row.is_real),
      mirrorId: row.mirror_id,
      whitelisted: Boolean(row.whitelisted),
      primaryValue: this.getPrimaryValue(row.id),
      mirrorValue: row.mirror_id ? this.getPrimaryValue(row.mirror_id) : null,
    };
  }

  private scoreCandidate(row: EntityRow, normalized: string, rawValue: string): ReviewCandidate | null {
    const primaryValue = this.getPrimaryValue(row.id);
    if (!primaryValue) return null;
    const normalizedPrimary = normalizeValue(primaryValue);
    const reasons: string[] = [];
    let score = 0;

    if (normalized === normalizedPrimary) {
      score = 1;
      reasons.push("exact");
    }

    if (normalized.includes(normalizedPrimary) || normalizedPrimary.includes(normalized)) {
      score = Math.max(score, 0.86);
      reasons.push("substring");
    }

    const tokenScore = tokenOverlap(normalized, normalizedPrimary);
    if (tokenScore > 0) {
      score = Math.max(score, tokenScore);
      reasons.push(`token_overlap:${tokenScore.toFixed(2)}`);
    }

    const rawDomain = rawValue.includes("@") ? rawValue.split("@")[1] : rawValue.includes(".") ? rawValue : "";
    const primaryDomain = primaryValue.includes("@") ? primaryValue.split("@")[1] : primaryValue.includes(".") ? primaryValue : "";
    if (rawDomain && primaryDomain && normalizeValue(rawDomain) === normalizeValue(primaryDomain)) {
      score = Math.max(score, 0.9);
      reasons.push("same_domain");
    }

    if (row.kind === "company") {
      const a = extractCompanySuffix(rawValue).suffix.toLowerCase();
      const b = extractCompanySuffix(primaryValue).suffix.toLowerCase();
      if (a && b && a === b) {
        score = Math.max(score, 0.58);
        reasons.push("same_company_suffix");
      }
    }

    if (score < 0.55) return null;
    return {
      entityId: row.id,
      kind: row.kind,
      primaryValue,
      mirrorValue: row.mirror_id ? this.getPrimaryValue(row.mirror_id) : null,
      score,
      reasons,
    };
  }

  private buildContext(partial?: Partial<MirrorContext>): MirrorContext {
    return {
      pool: this.pool,
      locale: partial?.locale ?? "en",
      gender: partial?.gender ?? "neutral",
      companySuffix: partial?.companySuffix,
      linkedCompanyMirror: partial?.linkedCompanyMirror,
      linkedPersonFirst: partial?.linkedPersonFirst,
      linkedPersonLast: partial?.linkedPersonLast,
    };
  }

  private migrate(): void {
    this.db.exec("pragma journal_mode = wal");
    for (const statement of [
      `
      create table if not exists entities (
        id text primary key,
        kind text not null,
        is_real integer not null,
        mirror_id text,
        whitelisted integer not null default 0,
        locale text,
        created_at text not null default (datetime('now')),
        metadata_json text not null default '{}'
      )`,
      `
      create table if not exists attributes (
        entity_id text not null,
        key text not null,
        value text not null,
        normalized_hash text not null,
        format_hint text,
        confidence real not null default 1,
        source text not null,
        created_at text not null default (datetime('now')),
        primary key (entity_id, key, normalized_hash)
      )`,
      `create index if not exists idx_attributes_hash on attributes(normalized_hash)`,
      `
      create table if not exists aliases (
        entity_id text not null,
        alias text not null,
        normalized_hash text not null,
        primary key (entity_id, normalized_hash)
      )`,
      `
      create table if not exists events (
        id text primary key,
        direction text not null,
        input_preview text not null,
        output_preview text not null,
        replacement_count integer not null,
        metadata_json text not null,
        created_at text not null
      )`,
      `
      create table if not exists review_items (
        id text primary key,
        kind text not null,
        value text not null,
        normalized_hash text not null,
        status text not null,
        reason text not null,
        span_json text not null,
        candidate_json text not null,
        created_at text not null,
        resolved_at text
      )`,
      `create index if not exists idx_review_items_status on review_items(status)`,
      `create index if not exists idx_review_items_hash on review_items(normalized_hash)`,
      `create index if not exists idx_aliases_hash on aliases(normalized_hash)`,
      `
      create table if not exists merge_links (
        from_entity_id text not null,
        to_entity_id text not null,
        metadata_json text not null default '{}',
        created_at text not null,
        primary key (from_entity_id, to_entity_id)
      )`,
    ]) {
      this.db.exec(statement);
    }
  }

  private createEntity(kind: EntityKind, isReal: boolean, value: string): EntityRow {
    const id = stableId(isReal ? "real" : "mirror", `${kind}:${normalizeValue(value)}`);
    this.db
      .query(
        `insert or ignore into entities (id, kind, is_real, metadata_json)
         values (?, ?, ?, ?)`,
      )
      .run(id, kind, isReal ? 1 : 0, "{}");
    this.upsertAttribute(id, isReal ? kind : "mirror", value, undefined, 1, isReal ? "detector" : "mirror");
    return this.getEntity(id);
  }

  private getEntity(id: string): EntityRow {
    const row = this.db.query<EntityRow, [string]>("select * from entities where id = ?").get(id);
    if (!row) throw new Error(`Missing entity ${id}`);
    return row;
  }

  private getPrimaryValue(entityId: string): string | null {
    const row = this.db
      .query<AttributeRow, [string]>("select entity_id, key, value from attributes where entity_id = ? order by created_at limit 1")
      .get(entityId);
    return row ? decryptMaybe(row.value, this.secret) : null;
  }

  private upsertAttribute(
    entityId: string,
    key: string,
    value: string,
    formatHint: string | undefined,
    confidence: number,
    source: string,
  ): void {
    const normalized = normalizeValue(value);
    const hashPrefix = source === "mirror" || entityId.startsWith("mirror_") ? "mirror" : key;
    this.db
      .query(
        `insert or ignore into attributes
         (entity_id, key, value, normalized_hash, format_hint, confidence, source)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(entityId, key, encryptMaybe(value, this.secret), stableHash(`${hashPrefix}:${normalized}`), formatHint ?? null, confidence, source);
    this.db
      .query("insert or ignore into aliases (entity_id, alias, normalized_hash) values (?, ?, ?)")
      .run(entityId, encryptMaybe(value, this.secret), stableHash(normalized));
  }
}

interface ClusterEntry {
  idx: number;
  span: PiiSpan;
}

function clusterSpans(spans: PiiSpan[]): ClusterEntry[][] {
  const entries = spans.map((span, idx) => ({ idx, span }));
  const clusters: ClusterEntry[][] = [];
  const assigned = new Set<number>();

  for (const entry of entries) {
    if (assigned.has(entry.idx)) continue;

    const cluster = [entry];
    assigned.add(entry.idx);

    if (entry.span.kind === "email") {
      const emailDomain = entry.span.text.split("@")[1]?.split(".")[0]?.toLowerCase();
      for (const other of entries) {
        if (assigned.has(other.idx)) continue;
        if (other.span.kind === "person" || other.span.kind === "company" || other.span.kind === "domain") {
          const otherNorm = other.span.text.toLowerCase().replace(/\s+/g, "");
          if (emailDomain && (otherNorm.includes(emailDomain) || emailDomain.includes(otherNorm.slice(0, 4)))) {
            cluster.push(other);
            assigned.add(other.idx);
          }
        }
      }
    }

    if (entry.span.kind === "person" || entry.span.kind === "company") {
      const norm = entry.span.text.toLowerCase().replace(/\s+/g, "");
      for (const other of entries) {
        if (assigned.has(other.idx)) continue;
        const otherNorm = other.span.text.toLowerCase();
        if (
          (other.span.kind === "email" && otherNorm.includes(norm.slice(0, 4))) ||
          (other.span.kind === "domain" && otherNorm.includes(norm.slice(0, 4))) ||
          (other.span.kind === "url" && otherNorm.includes(norm.slice(0, 4))) ||
          (other.span.kind === "handle" && otherNorm.includes(norm.slice(0, 4)))
        ) {
          cluster.push(other);
          assigned.add(other.idx);
        }
      }
    }

    clusters.push(cluster);
  }

  for (const entry of entries) {
    if (!assigned.has(entry.idx)) {
      clusters.push([entry]);
    }
  }

  return clusters;
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.split(/[^a-z0-9]+/i).filter((token) => token.length >= 3));
  const bTokens = new Set(b.split(/[^a-z0-9]+/i).filter((token) => token.length >= 3));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let hits = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) hits += 1;
  }
  return hits / Math.max(aTokens.size, bTokens.size);
}
