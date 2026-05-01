import type { PiiToolConfig } from "./config.ts";
import { loadConfig } from "./config.ts";
import type { Detector, FilterResult, PiiSpan, Replacement } from "./schema.ts";
import { PiiVault } from "./vault.ts";
import { preserveCase } from "./mirror.ts";
import { RegexDetector } from "../detectors/regex.ts";
import { OllamaDetector } from "../detectors/ollama.ts";
import { HybridDetector } from "../detectors/hybrid.ts";

export class PiiTool {
  readonly vault: PiiVault;
  readonly detector: Detector;

  constructor(readonly config: PiiToolConfig = loadConfig()) {
    this.vault = new PiiVault(
      config.vaultPath,
      undefined,
      config.ollama.baseUrl,
      config.ollama.model,
      config.reviewMode,
    );
    this.detector = createDetector(config);
  }

  async detect(text: string) {
    return this.detector.detect(text);
  }

  async anonymize(text: string): Promise<FilterResult> {
    const detected = await this.detector.detect(text);
    const replacementMap = this.vault.resolveCoherent(detected.spans);

    const sortedSpans = detected.spans
      .map((span, idx) => ({ span, idx }))
      .sort((a, b) => b.span.start - a.span.start);

    let output = text;
    const replacements: Replacement[] = [];

    for (const { span, idx } of sortedSpans) {
      const replacement = replacementMap.get(idx);
      if (!replacement) continue;
      replacements.unshift(replacement);
      const fake = preserveCase(span.text, replacement.fake);
      output = output.slice(0, span.start) + fake + output.slice(span.end);
    }

    const eventId = this.vault.recordEvent("anonymize", text, output, replacements);
    return { text: output, eventId, spans: detected.spans, replacements };
  }

  async deanonymize(text: string, options: { includeKinds?: string[]; excludeKinds?: string[] } = {}): Promise<FilterResult> {
    const detected = await this.detector.detect(text);
    const replacements: Replacement[] = [];
    let output = text;

    for (const span of [...detected.spans].sort((a, b) => b.start - a.start)) {
      const replacement = this.vault.reverseLookup(span.text);
      if (!replacement) continue;
      if (options.includeKinds && !options.includeKinds.includes(replacement.kind)) continue;
      if (options.excludeKinds?.includes(replacement.kind)) continue;
      replacements.unshift(replacement);
      output = output.slice(0, span.start) + replacement.real + output.slice(span.end);
    }

    const eventId = this.vault.recordEvent("deanonymize", text, output, replacements);
    return { text: output, eventId, spans: detected.spans, replacements };
  }

  close(): void {
    this.vault.close();
  }
}

export function createDetector(config: PiiToolConfig): Detector {
  const regex = new RegexDetector();
  if (config.detectorMode === "regex") return regex;

  const ollama = new OllamaDetector({
    baseUrl: config.ollama.baseUrl,
    model: config.ollama.model ?? "qwen2.5:7b",
    keepAlive: config.ollama.keepAlive,
  });
  if (config.detectorMode === "local_llm") return ollama;
  return new HybridDetector([regex, ollama]);
}

export function spansToPreview(spans: PiiSpan[]): Array<Pick<PiiSpan, "text" | "kind" | "confidence" | "source">> {
  return spans.map(({ text, kind, confidence, source }) => ({ text, kind, confidence, source }));
}
