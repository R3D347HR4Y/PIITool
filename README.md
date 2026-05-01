# PIITool

Local PII anonymization gateway for AI workflows. PIITool replaces real people, companies, emails, domains, phones, URLs, handles, addresses, IDs, API keys, sensitive environment variables, and media-derived text with stable fake mirrors before data reaches remote models. Responses can be deanonymized back to real values through the local vault.

## What Works

- Text detection through regex or hybrid regex + local Ollama structured output.
- Reversible anonymization/deanonymization with stable fake mirrors.
- Local SQLite vault with optional AES-GCM encryption for stored attribute values.
- CLI commands for text, image descriptions, and audio transcripts.
- OpenAI-compatible gateway at `/v1/chat/completions`.
- Direct filter API at `/v1/filter/anonymize` and `/v1/filter/deanonymize`.
- MCP stdio proxy that filters tool calls/resources through the same core.
- Secret aliases like `PIITOOL_SECRET_123456789012` for API keys/env values, with SecurityAgent approval before tool-call deanonymization.
- Password-protected web UI for managing entities, reviews, security rules, and pending approvals.
- Anti-jailbreak hardening: deterministic secret guards, truncation detection, LLM advisory-only architecture.
- CLI setup wizard (`piitool setup`), health checker (`piitool doctor`), and MCP config generator (`piitool mcp-wrap`).

## Quick Start

```sh
bun install
bun run src/cli/index.ts setup    # interactive installer
bun run start                     # start gateway
bun run src/cli/index.ts doctor   # verify health
```

Or manual setup:

```sh
cp config.example.env .env
source .env
ollama pull qwen2.5:7b
bun run start
```

## Web UI

Set `PIITOOL_GATEWAY_PASSWORD` to enable the password-protected dashboard. Open `http://localhost:4317` in a browser.

Pages:
- **Dashboard** — entity, review, and security counts at a glance.
- **Entities** — searchable table with whitelist toggle.
- **Reviews** — review queue with approve/whitelist/merge actions.
- **Filter** — manual anonymize/deanonymize text box.
- **Security Rules** — CRUD for security rules.
- **Pending Approvals** — approve/deny/always buttons for pending tool calls.
- **Decision Audit** — filterable history of all security decisions.
- **Legislator** — chat-style interface for natural language rule changes.
- **Rule Changes** — history of rule changes with revert buttons.

API authentication supports both session cookies (from web login) and `Authorization: Bearer <password>` header (for CLI/curl).

## CLI

```sh
bun run src/cli/index.ts detect "John Doe emailed meryl.l@blackwaterlab.eu"
bun run src/cli/index.ts anon "John Doe works at Blackwater Labs"
bun run src/cli/index.ts deanonymize "Jamie Roberts works at Raylong Labels"
bun run src/cli/index.ts detect --file ./notes.txt
bun run src/cli/index.ts image ./photo.png
bun run src/cli/index.ts audio ./meeting.wav
```

### MCP Wrapping

Automatically wrap all MCP servers in `~/.cursor/mcp.json` with PIITool's proxy:

```sh
bun run src/cli/index.ts mcp-wrap ~/.cursor/mcp.json
bun run src/cli/index.ts mcp-wrap ~/.cursor/mcp.json --dry-run
```

### Setup / Doctor / Unwrap

```sh
bun run src/cli/index.ts setup     # interactive installer, detects Hermes/OpenClaw/Cursor
bun run src/cli/index.ts doctor    # health check: Ollama, gateway, harness wiring, MCP coverage
bun run src/cli/index.ts unwrap    # restore backed-up configs
bun run src/cli/index.ts unwrap --harness hermes
bun run src/cli/index.ts unwrap --mcp
```

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

Configure your MCP client to run PIITool instead of the downstream server. Tool-call args/resources are checked by SecurityAgent first; only approved calls are deanonymized before upstream execution. Upstream responses are anonymized before they reach the model.

## Agent Harness Integration

PIITool sits between agent harnesses (Hermes, OpenClaw, Cursor) and hosted LLMs:

1. **LLM API Proxy** — harness sends API calls to `http://localhost:4317/v1` instead of directly to OpenRouter/OpenAI/Anthropic. PIITool anonymizes outbound prompts and deanonymizes responses (excluding secrets by default).
2. **MCP Proxy** — each MCP server is wrapped so tool-call arguments pass through SecurityAgent before execution, and tool outputs are anonymized before reaching the LLM.

Use `piitool setup` for interactive configuration, or `piitool mcp-wrap` to wrap MCP configs manually.

## SecurityAgent

SecurityAgent governs tool calls and MCP calls after PIITool has handled PII. A `supersafe` rule can allow a call without local LLM approval:

- `in`: input/tool arguments are safe.
- `out`: tool output is safe.
- `inout`: both directions are safe.
- no matching rule: follows `PIITOOL_SECURITY_MODE`.

### Anti-Jailbreak Hardening

The security pipeline is deterministic-first. LLM decisions are advisory and can only escalate (deny or pending), never downgrade a deterministic check:

1. **Deterministic policy check** — stored rules are evaluated first.
2. **Deterministic secret scan** — regex scans full payload for raw secrets and PIITOOL_SECRET aliases, with no truncation.
3. **Truncation guard** — if context sent to the LLM was truncated, decision is forced to `pending_approval` regardless of LLM output.
4. **LLM advisory** — if deterministic checks pass and mode includes agent, the local LLM provides a recommendation.
5. **Post-deanonymize gate** — after secrets are restored for tool calls, a final regex check blocks any raw secret that lacks explicit param-specific approval.

Secrets are stricter than normal PII. API keys and sensitive env assignments are exposed to LLMs only as stable aliases such as `PIITOOL_SECRET_123456789012`. Broad allow rules do not auto-release these aliases into tool calls; a secret-bearing call needs explicit param-specific approval (`approve-always-params`) or a fresh human/agent approval. Pending gateway payloads redact raw secret-looking values before they are displayed.

### Legislator Guardrails

LegislatorAgent enforces deterministic constraints:
- Global allow-all rules (`targetName='*' + allow`) are rejected.
- `allow_always_global` rules cannot be created via legislator (must be created manually via API).
- Maximum 20 rules per session to prevent rule flooding.

### Modes

- `PIITOOL_SECURITY_MODE=off`: allow everything.
- `PIITOOL_SECURITY_MODE=policy`: allow/deny only from stored rules, otherwise `PIITOOL_SECURITY_DEFAULT`.
- `PIITOOL_SECURITY_MODE=agent`: ask local SecurityAgent when no rule matches.
- `PIITOOL_SECURITY_MODE=agent_with_human`: unresolved checks become pending approvals in the gateway.

Security CLI:

```sh
bun run src/cli/index.ts security pending list pending
bun run src/cli/index.ts security pending approve <id>
bun run src/cli/index.ts security pending deny <id>
bun run src/cli/index.ts security rules list
bun run src/cli/index.ts security rules add '<json>'
bun run src/cli/index.ts security rules delete <id>
bun run src/cli/index.ts security legislator 'allow "filesystem.read_file"'
bun run src/cli/index.ts security rule-changes list
bun run src/cli/index.ts security rule-changes revert <id>
```

## Configuration

Use `config.example.env` as the template. Main variables:

- `PIITOOL_VAULT_PATH`: SQLite vault path.
- `PIITOOL_VAULT_KEY`: optional encryption key for vault values.
- `PIITOOL_DETECTOR_MODE`: `regex`, `local_llm`, or `hybrid`.
- `OLLAMA_BASE_URL`: local Ollama endpoint.
- `PIITOOL_DETECTOR_MODEL`: local detector model.
- `PIITOOL_OLLAMA_KEEP_ALIVE`: Ollama model residency after requests, default `10m`.
- `PIITOOL_UPSTREAM_BASE_URL`: OpenAI-compatible upstream.
- `PIITOOL_UPSTREAM_API_KEY`: upstream API key.
- `PIITOOL_GATEWAY_PORT`: local gateway port.
- `PIITOOL_GATEWAY_PASSWORD`: password for web UI authentication.
- `PIITOOL_SESSION_TTL_MS`: session duration, default `3600000` (1h).
- `PIITOOL_REVIEW_MODE`: `auto` or `queue` for review item creation.
- `PIITOOL_MCP_COMMAND`: downstream MCP stdio command.
- `PIITOOL_SECURITY_MODE`: `off`, `policy`, `agent`, or `agent_with_human`.
- `PIITOOL_SECURITY_MODEL`: local model used by SecurityAgent.
- `PIITOOL_SECURITY_TIMEOUT_MS`: pending approval timeout.
- `PIITOOL_SECURITY_DEFAULT`: fallback decision when policy has no match.
- `PIITOOL_LEGISLATOR_MODEL`: local model intended for LegislatorAgent.
- `PIITOOL_LEGISLATOR_MAX_HISTORY`: max security decisions exposed to LegislatorAgent.

## Development

```sh
bun test
bun run typecheck
```

Optional real-LLM integration tests are skipped by default. They require Ollama and the configured model:

```sh
ollama pull qwen2.5:7b
bun run test:llm
```

First Ollama run can be slow while the model loads; LLM tests allow up to 120 seconds per test.

Override model or endpoint when needed:

```sh
PIITOOL_TEST_LLM=1 \
PIITOOL_OLLAMA_BASE_URL=http://localhost:11434 \
PIITOOL_OLLAMA_MODEL=qwen2.5:7b \
PIITOOL_OLLAMA_KEEP_ALIVE=10m \
bun test test/llm-integration.test.ts
```

PIITool sends Ollama `keep_alive` on detector and SecurityAgent calls, so repeated LLM tests avoid model reload while Ollama keeps the model resident. Prompt tokens still take time to ingest on each stateless request; keep static rules/prompts compact and let policy rules bypass LLM whenever possible.

### Debug Tests In Cursor/VSCode

Open Run and Debug, then choose:

- `Bun: Debug All Tests` to run every test with breakpoints.
- `Bun: Debug Focused .test.ts File` to run only the focused test file. Focus must be on a `*.test.ts` file; if README is focused, Bun will try to parse Markdown as a test.
- `Bun: Debug LLM Integration Tests` to run real Ollama detector/SecurityAgent tests.
- `Bun: Debug Focused .test.ts File with LLM` to run focused tests with `PIITOOL_TEST_LLM=1`.

Both configs use Bun's inspector through `.vscode/launch.json`.

## Current Limits

- Streaming gateway returns a buffered SSE response, not true token-by-token streaming yet.
- Security scopes are stored/evaluated as metadata; Docker/container execution is not implemented yet.
- Media inputs are converted to text first; raw images/audio are not forwarded.
- Detection quality depends on regex coverage and the local Ollama model when `local_llm` or `hybrid` mode is used.
- URL-based MCP servers (HTTP SSE, e.g., Figma Desktop) are not proxied yet; only stdio-based servers are wrapped.
