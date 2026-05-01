import { z } from "zod";

export const EntityKindSchema = z.enum([
  "person",
  "company",
  "email",
  "phone",
  "domain",
  "url",
  "handle",
  "address",
  "id",
  "asset",
  "secret",
]);

export type EntityKind = z.infer<typeof EntityKindSchema>;

export const PiiSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  text: z.string().min(1),
  kind: EntityKindSchema,
  confidence: z.number().min(0).max(1).default(1),
  entityHint: z.string().optional(),
  formatHint: z.string().optional(),
  source: z.string().default("regex"),
});

export type PiiSpan = z.infer<typeof PiiSpanSchema>;

export const DetectorEntitySchema = z.object({
  hint: z.string().min(1),
  kind: EntityKindSchema,
  attributes: z.record(z.string(), z.string()).default({}),
  confidence: z.number().min(0).max(1).default(0.8),
});

export const DetectorRelationshipSchema = z.object({
  fromHint: z.string(),
  toHint: z.string(),
  type: z.enum(["employment", "ownership", "email_domain", "person_company", "related_to"]),
  confidence: z.number().min(0).max(1).default(0.8),
});

export const DetectorOutputSchema = z.object({
  entities: z.array(DetectorEntitySchema).default([]),
  spans: z.array(PiiSpanSchema).default([]),
  relationships: z.array(DetectorRelationshipSchema).default([]),
  localeHints: z.array(z.string()).default([]),
});

export type DetectorOutput = z.infer<typeof DetectorOutputSchema>;

export const FilterDirectionSchema = z.enum(["anonymize", "deanonymize"]);
export type FilterDirection = z.infer<typeof FilterDirectionSchema>;

export interface FilterResult {
  text: string;
  eventId: string;
  spans: PiiSpan[];
  replacements: Replacement[];
}

export interface Replacement {
  real: string;
  fake: string;
  kind: EntityKind;
  entityId: string;
  mirrorId: string;
}

export interface Detector {
  detect(text: string): Promise<DetectorOutput>;
}
