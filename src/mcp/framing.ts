export async function* readMcpFrames(stream: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = stream.getReader();
  let buffer = Buffer.alloc(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer = Buffer.concat([buffer, Buffer.from(value)]);

    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const length = Number(header.match(/content-length:\s*(\d+)/i)?.[1]);
      if (!Number.isFinite(length)) throw new Error("MCP frame missing Content-Length");
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) break;
      const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.subarray(bodyEnd);
      yield JSON.parse(body) as Record<string, unknown>;
    }
  }
}

export function encodeMcpFrame(message: unknown): Uint8Array {
  const body = JSON.stringify(message);
  return new TextEncoder().encode(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
