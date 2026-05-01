import { createHash } from "node:crypto";

export function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}_${stableHash(value).slice(0, 16)}`;
}

export function redactPreview(text: string): string {
  return text.length <= 160 ? text : `${text.slice(0, 157)}...`;
}
