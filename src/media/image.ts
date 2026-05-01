import type { PiiToolConfig } from "../core/config.ts";
import type { PiiTool } from "../core/piitool.ts";

export interface ImageFilterResult {
  description: string;
  anonymizedDescription: string;
  eventId: string;
}

export async function filterImageDescription(path: string, tool: PiiTool, config: PiiToolConfig): Promise<ImageFilterResult> {
  const bytes = await Bun.file(path).arrayBuffer();
  const image = Buffer.from(bytes).toString("base64");
  const model = process.env.PIITOOL_VISION_MODEL ?? config.ollama.model ?? "llava";

  const response = await fetch(`${config.ollama.baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0 },
      messages: [
        {
          role: "user",
          content:
            "Describe this image precisely for an AI assistant without sending the image. Include visible text, people, faces, logos, colors, layout, and objects.",
          images: [image],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Vision model failed: ${response.status}`);
  const payload = (await response.json()) as { message?: { content?: string } };
  const description = payload.message?.content ?? "";
  const filtered = await tool.anonymize(description);
  return { description, anonymizedDescription: filtered.text, eventId: filtered.eventId };
}
