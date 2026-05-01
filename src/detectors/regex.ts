import type { Detector, DetectorOutput, EntityKind, PiiSpan } from "../core/schema.ts";

const NOT_PERSON_NAMES = new Set([
  // Places
  "new york", "los angeles", "san francisco", "san diego", "las vegas", "hong kong",
  "buenos aires", "rio grande", "santa cruz", "puerto rico", "costa rica", "sierra leone",
  "north carolina", "south carolina", "west virginia", "rhode island", "sri lanka",
  // US states / regions often capitalized like names
  "monterey park", "palo alto", "santa monica", "beverly hills", "long beach",
  "grand rapids", "cedar rapids", "palm springs", "fort worth", "baton rouge",
  // Street/place words
  "state street", "main street", "high street", "wall street", "park avenue",
  "oxford street", "baker street", "elm street", "broad street", "church street",
  "market street", "union square", "times square", "central park", "hyde park",
  // Months / days
  "black friday", "good friday", "palm sunday", "ash wednesday",
  // Common false positives
  "hello world", "open source", "best practices", "dark mode", "light mode",
  "null pointer", "stack overflow", "pull request", "merge conflict", "code review",
  "task force", "front end", "back end", "full stack", "real time", "read only",
  "trade mark", "copy right", "white house", "united states", "united kingdom",
  "united nations", "european union", "prime minister", "vice president",
  // Titles that look like names
  "dear sir", "dear madam",
]);

const COMMON_DOMAINS_SKIP = new Set([
  "example.com", "example.org", "example.net", "localhost",
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "google.com", "github.com", "stackoverflow.com", "wikipedia.org",
  "amazon.com", "facebook.com", "twitter.com", "linkedin.com",
  "youtube.com", "instagram.com", "reddit.com", "microsoft.com",
  "apple.com", "openai.com", "anthropic.com",
]);

const patterns: Array<{ kind: EntityKind; re: RegExp; confidence: number; formatHint?: string }> = [
  { kind: "secret", re: /\bPIITOOL_SECRET_[A-Fa-f0-9]{12}\b/gi, confidence: 1, formatHint: "secret_alias" },
  { kind: "secret", re: /\b(?:[A-Z][A-Z0-9_]*(?:API|TOKEN|SECRET|KEY|PASSWORD|PRIVATE)[A-Z0-9_]*)\s*=\s*["']?[^"'\s]{8,}["']?/g, confidence: 0.99, formatHint: "env_secret" },
  { kind: "secret", re: /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9_-]{16,}|sk_test_[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/g, confidence: 0.99, formatHint: "api_key" },
  { kind: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, confidence: 0.99, formatHint: "email" },
  { kind: "url", re: /\bhttps?:\/\/[^\s<>"')]+/gi, confidence: 0.95, formatHint: "url" },
  { kind: "phone", re: /(?<!\w)(?:\+?\d[\d .()-]{7,}\d)(?!\w)/g, confidence: 0.85, formatHint: "phone" },
  { kind: "id", re: /\b(?:SSN|SIREN|SIRET|TAX\s*(?:id)?|VAT|ID)\s*[:# ]+\s*[A-Z0-9-]{5,}\b/gi, confidence: 0.8, formatHint: "identifier" },
  { kind: "company", re: /\b[A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+)*\s+(?:Inc|LLC|Ltd|Labs|Corp|Corporation|Records|Systems|Studio|Partners|Works|Group|Holdings|Media|Entertainment|Publishing|Music|Films|Pictures|Agency|Consulting|Services|Foundation|Institute|Association|Technologies|Solutions|Dynamics|Industries|Enterprises|Ventures|Capital|Digital|Creative|Global|International)\b/g, confidence: 0.78 },
  { kind: "handle", re: /(?<!\w)@[a-z0-9_][a-z0-9_.-]{2,}/gi, confidence: 0.75, formatHint: "handle" },
  { kind: "domain", re: /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|biz|info|app|tech|dev|eu|uk|de|fr|es|it|nl|au|ca|jp|cn|br|ru|in|za|mx|ar|cl|se|no|fi|dk|ch|at|be|pt|pl|cz|hu|ro|bg|hr|sk|si|lt|lv|ee|ie|is)\b/gi, confidence: 0.75, formatHint: "domain" },
  { kind: "person", re: /\b[A-Z][a-z]{2,}\s+(?:[A-Z][a-z]{1,2}\.\s+)?[A-Z][a-z]{2,}(?:-[A-Z][a-z]{2,})?\b/g, confidence: 0.62 },
];

export class RegexDetector implements Detector {
  async detect(text: string): Promise<DetectorOutput> {
    const spans: PiiSpan[] = [];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern.re)) {
        if (match.index === undefined || !match[0]) continue;
        if (shouldSkip(pattern.kind, match[0])) continue;
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          kind: pattern.kind,
          confidence: pattern.confidence,
          formatHint: pattern.formatHint,
          source: "regex",
        });
      }
    }
    return { entities: [], spans: dedupeSpans(spans), relationships: [], localeHints: [] };
  }
}

function shouldSkip(kind: EntityKind, value: string): boolean {
  if (kind === "person") {
    return NOT_PERSON_NAMES.has(value.toLowerCase());
  }
  if (kind === "domain") {
    return COMMON_DOMAINS_SKIP.has(value.toLowerCase());
  }
  return false;
}

export function dedupeSpans(spans: PiiSpan[]): PiiSpan[] {
  return spans
    .sort((a, b) => b.end - b.start - (a.end - a.start) || b.confidence - a.confidence)
    .reduce<PiiSpan[]>((kept, span) => {
      const overlaps = kept.some((other) => span.start < other.end && other.start < span.end);
      return overlaps ? kept : [...kept, span];
    }, [])
    .sort((a, b) => a.start - b.start);
}
