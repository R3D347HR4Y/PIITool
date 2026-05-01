# PIITool

Local PII anonymization gateway for AI workflows. PIITool replaces real people, companies, emails, domains, phones, URLs, handles, addresses, IDs, and media-derived text with stable fake mirrors before data reaches remote models. Responses can be deanonymized back to real values through the local vault.

## What Works

- Text detection through regex or hybrid regex + local Ollama structured output.
- Reversible anonymization/deanonymization with stable fake mirrors.
- Local SQLite vault with optional AES-GCM encryption for stored attribute values.
- CLI commands for text, image descriptions, and audio transcripts.
- OpenAI-compatible gateway at `/v1/chat/completions`.
- Direct filter API at `/v1/filter/anonymize` and `/v1/filter/deanonymize`.
- MCP stdio proxy that filters tool calls/resources through the same core.

## Setup

```sh
bun install
cp config.example.env .env
```

Load config before running commands:

```sh
set -a
source .env
set +a
```

For local LLM detection, run Ollama and pull a structured-output-friendly model:

```sh
ollama pull qwen2.5:7b
```

## CLI

```sh
bun run src/cli/index.ts detect "John Doe emailed meryl.l@blackwaterlab.eu"
bun run src/cli/index.ts anon "John Doe works at Blackwater Labs"
bun run src/cli/index.ts deanonymize "Jamie Roberts works at Raylong Labels"
```

File input:

```sh
bun run src/cli/index.ts detect --file ./notes.txt
bun run src/cli/index.ts anon --file ./notes.txt
```

Media adapters:

```sh
bun run src/cli/index.ts image ./photo.png
bun run src/cli/index.ts audio ./meeting.wav
```

Images are described by a local Ollama vision model first, then the description is anonymized. Audio is transcribed by a Whisper-compatible `/v1/audio/transcriptions` endpoint first, then the transcript is anonymized.

## Gateway

Start local gateway:

```sh
bun run start
```

Health:

```sh
curl http://localhost:4317/health
```

Direct anonymization:

```sh
curl http://localhost:4317/v1/filter/anonymize \
  -H "content-type: application/json" \
  -d '{"text":"John Doe emailed meryl.l@blackwaterlab.eu"}'
```

OpenAI-compatible chat proxy:

```sh
curl http://localhost:4317/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      { "role": "user", "content": "Write an email to John Doe at meryl.l@blackwaterlab.eu" }
    ]
  }'
```

Set SDK `base_url` to `http://localhost:4317/v1` and API key to any value your SDK requires. PIITool forwards to `PIITOOL_UPSTREAM_BASE_URL`.

## MCP Proxy

Wrap an MCP stdio server:

```sh
PIITOOL_MCP_COMMAND='npx -y @modelcontextprotocol/server-filesystem /Users/red' bun run mcp
```

Configure your MCP client to run PIITool instead of the downstream server. Tool-call args/resources are deanonymized before upstream calls; upstream responses are anonymized before they reach the model.

## Review Gateway

PIITool can record people/companies that need a user decision:

- `PIITOOL_REVIEW_MODE=auto`: default. Anonymization behaves normally; fuzzy candidates may be recorded for audit/review.
- `PIITOOL_REVIEW_MODE=queue`: unknown or fuzzy people/companies create `pending` review items while PIITool still anonymizes with a mirror.

Review endpoints are local-only and currently unauthenticated. Do not expose the gateway to an untrusted network.

List pending review items:

```sh
curl "http://localhost:4317/v1/review/items?status=pending"
```

Approve as a new anonymized entity:

```sh
curl -X POST http://localhost:4317/v1/review/items/<review-id>/approve-new
```

Whitelist a review item so it passes through unchanged later:

```sh
curl -X POST http://localhost:4317/v1/review/items/<review-id>/whitelist
```

Merge a review item into an existing entity:

```sh
curl -X POST http://localhost:4317/v1/review/items/<review-id>/merge \
  -H "content-type: application/json" \
  -d '{"targetEntityId":"real_..."}'
```

Search entities and change policy:

```sh
curl "http://localhost:4317/v1/entities?kind=person&q=robin"
curl -X POST http://localhost:4317/v1/entities/<entity-id>/whitelist \
  -H "content-type: application/json" \
  -d '{"whitelisted":true}'
curl -X POST http://localhost:4317/v1/entities/<source-id>/merge \
  -H "content-type: application/json" \
  -d '{"targetEntityId":"real_..."}'
```

CLI equivalents:

```sh
bun run src/cli/index.ts review list pending
bun run src/cli/index.ts review approve-new <review-id>
bun run src/cli/index.ts review whitelist <review-id>
bun run src/cli/index.ts review merge <review-id> <entity-id>
bun run src/cli/index.ts entities search robin
bun run src/cli/index.ts entities whitelist <entity-id> true
bun run src/cli/index.ts entities merge <source-id> <target-id>
```

## Configuration

Use `config.example.env` as the template. Main variables:

- `PIITOOL_VAULT_PATH`: SQLite vault path.
- `PIITOOL_VAULT_KEY`: optional encryption key for vault values.
- `PIITOOL_DETECTOR_MODE`: `regex`, `local_llm`, or `hybrid`.
- `OLLAMA_BASE_URL`: local Ollama endpoint.
- `PIITOOL_DETECTOR_MODEL`: local detector model.
- `PIITOOL_UPSTREAM_BASE_URL`: OpenAI-compatible upstream.
- `PIITOOL_UPSTREAM_API_KEY`: upstream API key.
- `PIITOOL_GATEWAY_PORT`: local gateway port.
- `PIITOOL_REVIEW_MODE`: `auto` or `queue` for review item creation.
- `PIITOOL_MCP_COMMAND`: downstream MCP stdio command.

## Development

```sh
bun test
bun run typecheck
```

### Debug Tests In Cursor/VSCode

Open Run and Debug, then choose:

- `Bun: Debug All Tests` to run every test with breakpoints.
- `Bun: Debug Current Test File` to run only the focused test file.

Both configs use Bun's inspector through `.vscode/launch.json`.

## Current Limits

- Streaming gateway returns a buffered SSE response, not true token-by-token streaming yet.
- Review queue is API/CLI only; no browser UI yet.
- Media inputs are converted to text first; raw images/audio are not forwarded.
- Detection quality depends on regex coverage and the local Ollama model when `local_llm` or `hybrid` mode is used.
