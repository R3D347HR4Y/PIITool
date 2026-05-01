import { z } from "zod";
import type { Detector, DetectorOutput } from "../core/schema.ts";
import { DetectorOutputSchema } from "../core/schema.ts";

export interface OllamaDetectorOptions {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

export class OllamaDetector implements Detector {
  constructor(private options: OllamaDetectorOptions) {}

  async detect(text: string): Promise<DetectorOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          format: z.toJSONSchema(DetectorOutputSchema),
          options: { temperature: 0 },
          messages: [
            {
              role: "system",
              content:
                "Extract PII only. Return JSON matching schema. Use character offsets in original text. Include people, companies, emails, domains, phones, URLs, handles, addresses, IDs, and relationships.",
            },
            { role: "user", content: text },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Ollama detector failed: ${response.status}`);
      const payload = (await response.json()) as { message?: { content?: string } };
      return DetectorOutputSchema.parse(JSON.parse(payload.message?.content ?? "{}"));
    } finally {
      clearTimeout(timeout);
    }
  }
}
