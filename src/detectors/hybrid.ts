import type { Detector, DetectorOutput } from "../core/schema.ts";
import { dedupeSpans } from "./regex.ts";

export class HybridDetector implements Detector {
  constructor(private detectors: Detector[]) {}

  async detect(text: string): Promise<DetectorOutput> {
    const outputs = await Promise.allSettled(
      this.detectors.map((detector) => Promise.resolve().then(() => detector.detect(text))),
    );
    const fulfilled = outputs.flatMap((output) => (output.status === "fulfilled" ? [output.value] : []));
    return {
      entities: fulfilled.flatMap((output) => output.entities),
      spans: dedupeSpans(fulfilled.flatMap((output) => output.spans)),
      relationships: fulfilled.flatMap((output) => output.relationships),
      localeHints: [...new Set(fulfilled.flatMap((output) => output.localeHints))],
    };
  }
}
