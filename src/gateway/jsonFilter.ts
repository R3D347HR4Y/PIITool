import type { PiiTool } from "../core/piitool.ts";

export async function mapStrings(value: unknown, mapper: (text: string) => Promise<string>): Promise<unknown> {
  if (typeof value === "string") return mapper(value);
  if (Array.isArray(value)) return Promise.all(value.map((item) => mapStrings(item, mapper)));
  if (value && typeof value === "object") {
    const mapped = await Promise.all(
      Object.entries(value).map(async ([key, inner]) => [key, await mapStrings(inner, mapper)] as const),
    );
    return Object.fromEntries(mapped);
  }
  return value;
}

export async function anonymizeJson(tool: PiiTool, value: unknown): Promise<unknown> {
  return mapStrings(value, async (text) => (await tool.anonymize(text)).text);
}

export async function deanonymizeJson(tool: PiiTool, value: unknown): Promise<unknown> {
  return mapStrings(value, async (text) => (await tool.deanonymize(text)).text);
}
