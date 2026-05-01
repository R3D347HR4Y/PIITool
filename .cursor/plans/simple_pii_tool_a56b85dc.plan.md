---
name: Simple PII Tool
overview: "Plan simple MVP for PIITool: local text anonymization core first, then LLM/MCP gateways, then media adapters. Reuse existing proxy/detection pieces where they save time, keep persistent reversible mappings in one local vault."
todos:
  - id: define-core-schema
    content: Define Zod detector schema and SQLite vault schema for text-only entities/mirrors.
    status: completed
  - id: build-text-core
    content: Implement regex detector, entity resolution, deterministic mirror generation, and span replacement.
    status: completed
  - id: add-local-llm-detector
    content: Add Ollama structured-output detector behind same detector interface.
    status: completed
  - id: add-gateway
    content: Add OpenAI-compatible proxy or LiteLLM hook that calls core anonymize/deanonymize functions.
    status: completed
  - id: add-mcp-proxy
    content: Add MCP middleware proxy after text gateway works.
    status: completed
  - id: add-media-adapters
    content: Add image and audio adapters that convert media to local descriptions/transcripts before filtering.
    status: completed
isProject: false
---

# Simple PIITool Implementation Plan

## Goal
Build [PIITool.md](/Users/red/PIITool/PIITool.md) as local privacy gateway: real PII enters local core, remote LLM sees stable fake mirrors, returned fake mirrors become real values before user/tools see them.

## Research Findings
- LiteLLM already supports provider routing, streaming, OpenAI-compatible APIs, custom hooks, and PII guardrail modes including `pre_call`, `post_call`, and `pre_mcp_call`: [LiteLLM proxy](https://docs.litellm.ai/docs/simple_proxy), [call hooks](https://litellm.vercel.app/docs/proxy/call_hooks), [Presidio masking](https://docs.litellm.ai/docs/proxy/guardrails/pii_masking_v2).
- MCP redaction proxy pattern exists. `mcpose`, `elastic-pii-proxy`, and `mcp-shield-pii` show useful middleware shape: intercept tool calls/resources, redact response before logs/model, support audit after redaction.
- Local structured extraction is practical. Ollama supports JSON Schema structured outputs through `format`, useful for local PII detector agent with Zod/Pydantic schema validation.
- Detection engines worth reusing: DataFog for regex + spaCy + GLiNER cascade, Rust `redact` for fast pattern/ONNX NER, Presidio as mature baseline.
- SQLite with JSON columns + FTS5/trigram-like indexes is enough for portable vault + fuzzy candidate search. True typo fuzzy can be added with edit-distance scoring in app code.

## Recommended Simple Stack
- Core language: Bun/TypeScript for fast iteration, `bun:sqlite`, Zod schemas, native HTTP server, easy JSON handling.
- Optional detector sidecar: Python only if using DataFog/Presidio/GLiNER early. Keep it behind same `/detect` interface so Rust/ONNX detector can replace later.
- Gateway: start as OpenAI-compatible local proxy for `/v1/chat/completions`; optionally mount as LiteLLM plugin later instead of replacing LiteLLM.
- MCP: use middleware proxy pattern after text MVP; wrap configured MCP servers and pass tool responses through same anonymize/deanonymize core.
- Fake data: deterministic faker seeded from vault entity ID + locale, with mirror records stored once for stable names/emails/domains.

## MVP Scope
Implement text-only first:
- Forward filter user messages, tool responses, file reads, conversation histories.
- Backward filter model responses, tool calls, gateway agent messages, file writes.
- Persist reversible mapping in local encrypted SQLite vault.
- Use regex detection first for exact PII, then local LLM structured detector for people/org/domain relationship extraction.
- Add review queue for new/fuzzy entities before permanent mapping.

```mermaid
flowchart LR
  userText["User or Tool Text"] --> forwardFilter[Forward Filter]
  forwardFilter --> detect[Local Detector]
  detect --> vault[SQLite PII Vault]
  vault --> mirror[Mirror Generator]
  mirror --> remoteLLM[Remote LLM]
  remoteLLM --> backwardFilter[Backward Filter]
  backwardFilter --> userOut["User or Tool Output"]
```

## Core Modules
- `pii-core`: pure library with `detect`, `resolveEntities`, `anonymize`, `deanonymize`, `replaceSpans`, `auditEvent`.
- `pii-vault`: SQLite schema for `entities`, `attributes`, `mirrors`, `aliases`, `assets`, `events`; JSON `metadata` field for schema evolution.
- `pii-detector`: regex pass + local LLM JSON Schema pass. Detector returns spans, confidence, normalized values, entity relationships.
- `pii-gateway`: OpenAI-compatible proxy that rewrites request/response JSON, including streaming chunks.
- `pii-mcp-proxy`: later wrapper for MCP stdio/SSE/HTTP servers.
- `pii-ui`: small local review UI for fuzzy matches, whitelisting, merge/create decisions.

## Data Model Simple Version
Use stable entity IDs and flexible attributes instead of dynamic DB migrations:
- `entities`: `id`, `kind` (`person`, `company`, `asset`), `is_real`, `mirror_id`, `whitelisted`, `locale`, `created_at`, `metadata_json`.
- `attributes`: `entity_id`, `key`, `value`, `normalized_value`, `format_hint`, `confidence`, `source`.
- `aliases`: alternate spellings and handles for fuzzy lookup.
- `events`: redaction/audit records with redacted previews only.
- FTS table indexes normalized names, emails, domains, phones, handles, company names.

## Replacement Rules
- Prefer span-based replacement from detector output, not global regex replace, to avoid corrupting unrelated text.
- Longest span first, no overlapping replacements unless higher-confidence detector wins.
- Preserve format where needed: casing, email username/domain shape, phone locale, URL path shape.
- Store mirror once; same real person/company always maps to same fake mirror.
- Whitelisted entities pass through unchanged, but still tracked.

## Local Detector Prompt Shape
Use Zod schema as single source of truth; send JSON Schema to Ollama `format` at temperature 0. Output must include:
- `entities`: person/company/domain/email/phone/address/url/handle/id/asset refs.
- `spans`: byte offsets + original text + confidence + entity link.
- `relationships`: employment, ownership, email-domain-company, person-company links.
- `localeHints`: language/region used for fake data generation.

## Build Phases
1. Text core: SQLite vault, deterministic mirror generator, regex detector, span replacement, unit tests.
2. Local LLM detector: Ollama structured output + validation + merge/fuzzy workflow.
3. OpenAI-compatible proxy: request anonymization, response deanonymization, streaming support.
4. MCP proxy: wrap tool responses and tool call args, audit after redaction.
5. Files/media: file-read adapter; image-to-description via local vision model; audio-to-text via local Whisper; both pass into text core.
6. Hardening: encryption at rest, dry-run mode, audit logs, confidence thresholds, leak tests, config wizard.

## Config
Use one TOML or JSON config plus env overrides:
- model providers: Ollama, LM Studio, OpenRouter, OpenAI, Anthropic endpoint/model/key.
- detector mode: `regex`, `local_llm`, `hybrid`, confidence thresholds.
- vault path, encryption key source, review mode, whitelist rules.
- gateway ports and upstream provider routing.
- MCP server list and per-tool policy.

## Main Risks
- False negatives leak PII. Mitigation: hybrid regex + NER + local LLM, dry-run metrics, fail-closed mode for high-risk outputs.
- Bad deanonymization can alter code/tool args. Mitigation: replacement maps only known mirrors, span-aware replacement, tests on JSON/code/text.
- Streaming is tricky. Mitigation: start buffering small responses, then add streaming-safe token window replacement.
- Dynamic schema can get messy. Mitigation: keep relational core stable, put evolving extra fields in JSON metadata, version detector schema.

## First Implementation Target
Build local text-only CLI/API:
- `piitool detect <file>` returns structured entities.
- `piitool anon <text>` returns anonymized text + event ID.
- `piitool deanonymize <text>` returns restored text.
- `POST /v1/filter/anonymize` and `/v1/filter/deanonymize` expose same behavior for future gateways.