import { preserveCase } from "./mirror.ts";
import type { PiiSpan, Replacement } from "./schema.ts";

export function applySpanReplacements(text: string, spans: PiiSpan[], resolve: (span: PiiSpan) => Replacement | null): {
  text: string;
  replacements: Replacement[];
} {
  const replacements: Replacement[] = [];
  let cursor = text.length;
  let output = "";

  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    if (span.end > cursor || span.start < 0 || span.end > text.length) continue;
    const replacement = resolve(span);
    if (!replacement) continue;
    replacements.push(replacement);
    output = preserveCase(span.text, replacement.fake) + text.slice(span.end, cursor) + output;
    cursor = span.start;
  }

  return { text: text.slice(0, cursor) + output, replacements: replacements.reverse() };
}
