import type { EntityKind } from "./schema.ts";
import { stableHash } from "./normalize.ts";
import type { NamePool } from "./namepool.ts";

export interface MirrorContext {
  pool: NamePool;
  locale: string;
  gender: string;
  companySuffix?: string;
  linkedCompanyMirror?: string;
  linkedPersonFirst?: string;
  linkedPersonLast?: string;
}

function digits(seed: string, count: number): string {
  let out = "";
  let cursor = 0;
  while (out.length < count) {
    out += Number.parseInt(stableHash(`${seed}:${cursor}`).slice(0, 12), 16).toString();
    cursor += 1;
  }
  return out.slice(0, count);
}

export function extractNameParts(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

export function extractCompanySuffix(name: string): { prefix: string; suffix: string } {
  const suffixPattern = /\b(Inc|LLC|Ltd|Labs|Corp|Corporation|Records|Systems|Studio|Partners|Works|Group|Holdings|Media|Entertainment|Publishing|Music|Films|Pictures|Agency|Consulting|Services|Foundation|Institute|Association|Technologies|Solutions|Dynamics|Industries|Enterprises|Ventures|Capital|Digital|Creative|Global|International)\b\.?$/i;
  const match = name.match(suffixPattern);
  if (!match) return { prefix: name.trim(), suffix: "" };
  return {
    prefix: name.slice(0, match.index).trim(),
    suffix: match[0],
  };
}

export function generateMirrorPerson(
  realValue: string,
  entityId: string,
  ctx: MirrorContext,
): { full: string; first: string; last: string } {
  const { first: realFirst, last: realLast } = extractNameParts(realValue);
  const seed = `person:${entityId}:${realValue}`;

  const fakeLast = realLast
    ? ctx.pool.resolveFamilyName(realLast, seed, ctx.locale)
    : ctx.pool.pickLastName(seed, ctx.locale);

  const fakeFirst = ctx.pool.pickFirstName(`${seed}:first`, ctx.locale, ctx.gender);
  ctx.pool.markUsed("first", fakeFirst);

  return { full: `${fakeFirst} ${fakeLast}`, first: fakeFirst, last: fakeLast };
}

export function generateMirrorCompany(
  realValue: string,
  entityId: string,
  ctx: MirrorContext,
): string {
  const { prefix: _realPrefix, suffix: realSuffix } = extractCompanySuffix(realValue);
  const seed = `company:${entityId}:${realValue}`;
  const fakePrefix = ctx.pool.pickCompanyPrefix(seed);
  const suffix = ctx.companySuffix ?? realSuffix ?? "Corp";
  return `${fakePrefix} ${suffix}`;
}

export function generateMirrorEmail(
  realValue: string,
  entityId: string,
  ctx: MirrorContext,
): string {
  const seed = `email:${entityId}:${realValue}`;
  const atIdx = realValue.indexOf("@");
  const realLocal = atIdx >= 0 ? realValue.slice(0, atIdx) : realValue;

  const first = ctx.linkedPersonFirst ?? ctx.pool.pickFirstName(`${seed}:first`, ctx.locale, ctx.gender);
  const last = ctx.linkedPersonLast ?? ctx.pool.pickLastName(`${seed}:last`, ctx.locale);

  const companyBase = ctx.linkedCompanyMirror
    ? companyToDomainBase(ctx.linkedCompanyMirror)
    : ctx.pool.pickCompanyPrefix(seed).toLowerCase();

  const tld = ctx.pool.pickTld(seed);

  const localPattern = detectEmailLocalPattern(realLocal);
  let fakeLocal: string;
  switch (localPattern) {
    case "first.last":
      fakeLocal = `${first.toLowerCase()}.${last.toLowerCase()}`;
      break;
    case "f.last":
      fakeLocal = `${first[0]!.toLowerCase()}.${last.toLowerCase()}`;
      break;
    case "first_last":
      fakeLocal = `${first.toLowerCase()}_${last.toLowerCase()}`;
      break;
    case "firstlast":
      fakeLocal = `${first.toLowerCase()}${last.toLowerCase()}`;
      break;
    case "first":
      fakeLocal = first.toLowerCase();
      break;
    default:
      fakeLocal = `${first[0]!.toLowerCase()}.${last.toLowerCase()}`;
  }

  return `${fakeLocal}@${companyBase}${tld}`;
}

function companyToDomainBase(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
}

function detectEmailLocalPattern(local: string): string {
  if (/^[a-z]+\.[a-z]+$/i.test(local)) {
    return local.indexOf(".") === 1 ? "f.last" : "first.last";
  }
  if (/^[a-z]+_[a-z]+$/i.test(local)) return "first_last";
  if (/^[a-z]+$/i.test(local)) {
    return local.length <= 6 ? "first" : "firstlast";
  }
  return "f.last";
}

export function generateMirrorPhone(
  realValue: string,
  entityId: string,
  ctx: MirrorContext,
): string {
  const seed = `phone:${entityId}:${realValue}`;
  const cleaned = realValue.replace(/[^\d+]/g, "");
  const template = realValue.replace(/\d/g, "#");

  const fakeDigits = digits(seed, cleaned.length);
  let digitCursor = 0;
  let result = "";
  for (const char of template) {
    if (char === "#") {
      result += fakeDigits[digitCursor] ?? "0";
      digitCursor++;
    } else {
      result += char;
    }
  }

  const countryPrefix = ctx.pool.phonePrefix(ctx.locale);
  if (realValue.startsWith("+") && !result.startsWith("+")) {
    result = countryPrefix + result.replace(/^\+?\d{1,3}/, "");
  }

  return result;
}

export function generateMirrorDomain(
  realValue: string,
  entityId: string,
  ctx: MirrorContext,
): string {
  const seed = `domain:${entityId}:${realValue}`;
  const companyBase = ctx.linkedCompanyMirror
    ? companyToDomainBase(ctx.linkedCompanyMirror)
    : ctx.pool.pickCompanyPrefix(seed).toLowerCase();
  const tld = ctx.pool.pickTld(seed);
  return `${companyBase}${tld}`;
}

export function generateMirrorUrl(
  realValue: string,
  entityId: string,
  ctx: MirrorContext,
): string {
  const seed = `url:${entityId}:${realValue}`;
  let url = realValue;

  try {
    const parsed = new URL(realValue);
    const fakeDomain = generateMirrorDomain(parsed.hostname, entityId, ctx);
    url = realValue.replace(parsed.hostname, fakeDomain);
  } catch {
    const domainMatch = realValue.match(/^(https?:\/\/)?([^/]+)/i);
    if (domainMatch?.[2]) {
      const fakeDomain = generateMirrorDomain(domainMatch[2], entityId, ctx);
      url = realValue.replace(domainMatch[2], fakeDomain);
    }
  }

  if (ctx.linkedPersonFirst && ctx.linkedPersonLast) {
    const first = ctx.linkedPersonFirst.toLowerCase();
    const last = ctx.linkedPersonLast.toLowerCase();
    url = replacePathNames(url, first, last);
  }

  return url;
}

function replacePathNames(url: string, fakeFirst: string, fakeLast: string): string {
  return url
    .replace(/\/u\/[a-z]+-[a-z]+/gi, `/u/${fakeFirst}-${fakeLast}`)
    .replace(/\/user\/[a-z]+-[a-z]+/gi, `/user/${fakeFirst}-${fakeLast}`)
    .replace(/\/profile\/[a-z]+-[a-z]+/gi, `/profile/${fakeFirst}-${fakeLast}`)
    .replace(/@[a-z]+[._-][a-z]+/gi, `@${fakeFirst}_${fakeLast}`);
}

export function generateMirrorHandle(
  realValue: string,
  entityId: string,
  ctx: MirrorContext,
): string {
  const first = ctx.linkedPersonFirst ?? ctx.pool.pickFirstName(`handle:${entityId}:first`, ctx.locale, ctx.gender);
  const last = ctx.linkedPersonLast ?? ctx.pool.pickLastName(`handle:${entityId}:last`, ctx.locale);

  const sep = realValue.includes(".") ? "." : realValue.includes("-") ? "-" : "_";
  const prefix = realValue.startsWith("@") ? "@" : "";
  return `${prefix}${first.toLowerCase()}${sep}${last.toLowerCase()}`;
}

export function generateMirrorAddress(
  _realValue: string,
  entityId: string,
  ctx: MirrorContext,
): string {
  const seed = `address:${entityId}`;
  const num = (Number(digits(seed, 3)) % 900) + 100;
  return `${num} ${ctx.pool.pickStreet(seed)}`;
}

export function generateMirrorId(
  realValue: string,
  entityId: string,
  _ctx: MirrorContext,
): string {
  const seed = `id:${entityId}:${realValue}`;
  const prefixMatch = realValue.match(/^([A-Za-z\s]+[:# ]+)/);
  const prefix = prefixMatch ? prefixMatch[1] : "ID-";
  const digitCount = (realValue.match(/\d/g) ?? []).length || 9;
  return `${prefix}${digits(seed, digitCount)}`;
}

export function generateMirrorSecret(
  realValue: string,
  entityId: string,
): string {
  return `PIITOOL_SECRET_${digits(`secret:${entityId}:${realValue}`, 12)}`;
}

export function generateMirrorValue(
  kind: EntityKind,
  realValue: string,
  entityId: string,
  ctx: MirrorContext,
): string {
  switch (kind) {
    case "person":
      return generateMirrorPerson(realValue, entityId, ctx).full;
    case "company":
      return generateMirrorCompany(realValue, entityId, ctx);
    case "email":
      return generateMirrorEmail(realValue, entityId, ctx);
    case "phone":
      return generateMirrorPhone(realValue, entityId, ctx);
    case "domain":
      return generateMirrorDomain(realValue, entityId, ctx);
    case "url":
      return generateMirrorUrl(realValue, entityId, ctx);
    case "handle":
      return generateMirrorHandle(realValue, entityId, ctx);
    case "address":
      return generateMirrorAddress(realValue, entityId, ctx);
    case "id":
      return generateMirrorId(realValue, entityId, ctx);
    case "asset":
      return `asset-${digits(`asset:${entityId}`, 8)}`;
    case "secret":
      return generateMirrorSecret(realValue, entityId);
  }
}

export function preserveCase(source: string, replacement: string): string {
  if (source === source.toUpperCase() && source !== source.toLowerCase()) return replacement.toUpperCase();
  if (source === source.toLowerCase() && source !== source.toUpperCase()) return replacement.toLowerCase();
  if (source[0] === source[0]?.toUpperCase()) {
    return replacement[0]?.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
