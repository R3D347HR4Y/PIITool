import type { PiiToolConfig } from "../core/config.ts";
import type { PiiTool } from "../core/piitool.ts";

export interface AudioFilterResult {
  transcript: string;
  anonymizedTranscript: string;
  eventId: string;
}

export async function filterAudioTranscript(path: string, tool: PiiTool, config: PiiToolConfig): Promise<AudioFilterResult> {
  const baseUrl = process.env.PIITOOL_STT_BASE_URL ?? config.upstream.baseUrl;
  const apiKey = process.env.PIITOOL_STT_API_KEY ?? config.upstream.apiKey;
  const model = process.env.PIITOOL_STT_MODEL ?? "whisper-1";
  const form = new FormData();
  form.set("model", model);
  form.set("file", Bun.file(path));

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/audio/transcriptions`, {
    method: "POST",
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    body: form,
  });

  if (!response.ok) throw new Error(`STT failed: ${response.status}`);
  const payload = (await response.json()) as { text?: string };
  const transcript = payload.text ?? "";
  const filtered = await tool.anonymize(transcript);
  return { transcript, anonymizedTranscript: filtered.text, eventId: filtered.eventId };
}
