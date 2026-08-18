# vision-bridge-mcp — Architecture

This document describes how vision-bridge-mcp works internally: the overall data flow, input
normalization, message construction for both supported API formats, the URL download retry,
and the result cache. It is written for maintainers and for users who want to understand
exactly what the server does before forwarding their image to a vision model.

---

## 1. Overview

```
┌──────────────────────────────┐
│        Host Model            │
│   (LLM agent, e.g. DeepSeek, │
│    GLM, GPT-4o, Claude...)   │
└──────────────┬───────────────┘
               │
               │ ① decides the image path (vision-sidecar skill, when enabled):
               │    multimodal → native vision (no MCP call)
               │    text-only  → tool call: analyze_image / ocr_image / compare_images
               ▼
┌──────────────────────────────┐        MCP stdio JSON-RPC        ┌───────────────────────────┐
│        MCP Client            │ ◄──────────────────────────────► │     vision-bridge-mcp     │
│  (Claude Code / Cursor /     │                                  │  server.js (entry)        │
│   LiveAgent / any MCP host)  │                                  │  lib/vision.js (core)     │
└──────────────────────────────┘                                  └─────────────┬─────────────┘
                                                                                │ ② HTTPS POST
                                                                                ▼
                                                              ┌────────────────────────────────┐
                                                              │      Vision Model API          │
                                                              │  OpenAI  chat/completions OR    │
                                                              │  Anthropic /v1/messages         │
                                                              │  (official APIs or compatible   │
                                                              │   gateways / relays)            │
                                                              └────────────────────────────────┘
```

vision-bridge-mcp is a **stateless sidecar**: it holds no conversation memory. Each tool call
is an independent request that normalizes the image input, optionally consults the cache,
builds a single API request, and returns the vision model's text answer (or a typed error).

Side paths:

```
                 ┌───────────────┐   exec (15s)     ┌─────────────────┐
   clipboard ──► │ lib/clipboard │ ───────────────► │ scripts/         │  Windows: PowerShell
                 └───────────────┘   temp PNG       │ clipboard.ps1 / │  macOS: Swift
                                                    │ clipboard.swift  │  Linux: unsupported
                                                    └─────────────────┘

                 ┌───────────────┐   fs.readFile    ┌──────────────────────────────┐
   local path ─► │ normalize     │ ───────────────► │ base64 dataURL in memory      │
                 │ (lib/vision)  │                  └──────────────────────────────┘

                 ┌───────────────┐   fetch          ┌──────────────────────────────┐
   http(s) URL ─►│ downloadToData│ ───────────────► │ dataURL (only on retry path) │
                 │ Url           │   (60s, 20MB)    └──────────────────────────────┘

                 ┌───────────────┐
   dataURL ─────►│ regex-validated; passed through unchanged
                 └───────────────┘
```

## 2. Request lifecycle (one tool call)

```
tool call
  │
  ├─ safeCall (server.js): wraps any error into {content:[{text:"[vision_error] ..."}], isError:true}
  │
  ├─ normalizeImageInput(input)            lib/vision.js
  │    └─ produces a normalized descriptor: {kind:"url", url} | {kind:"dataUrl", dataUrl}
  │
  ├─ cache lookup (if enabled)             lib/cache.js
  │    └─ SHA256(image identifier + "::" + prompt) → hit? return cached text immediately
  │
  ├─ build body                            buildChatBody (1 image) / buildMultiImageBody (2–4 images)
  │    └─ OpenAI image_url parts or Anthropic image blocks, per VISION_API_FORMAT
  │
  ├─ callVision(config, body)              lib/vision.js
  │    ├─ POST {base}/chat/completions  (openai)
  │    └─ POST {base}/v1/messages       (anthropic)
  │         ├─ 60s timeout covers connection + headers + body read
  │         ├─ 16MB response limit (content-length precheck)
  │         └─ parse answer: anthropic content[] / openai message.content ?? reasoning_content
  │
  ├─ on media/download failure for URL input → downloadToDataUrl() → rebuild body → retry ONCE
  │
  ├─ cache store (if enabled)
  │
  └─ return text
```

## 3. Input normalization

`normalizeImageInput(input)` decides the image's kind in this order:

| Input | Detection | Result |
|---|---|---|
| `clipboard` / `clip` / `pasteboard` (case-insensitive) | exact regex | Read system clipboard image to a temp PNG via `lib/clipboard.js`, then recursively normalize the temp file; temp file is deleted afterwards (only `vision-clipboard-*.png` names are ever removed) |
| `data:...` | prefix check + `DATA_URL_RE` validation | `{kind:"dataUrl", dataUrl}` — only `image/*;base64,` dataURLs accepted, anything else is a `VisionInputError` |
| `http://` / `https://` | scheme prefix | `{kind:"url", url}` — passed through to the vision API as-is on the first attempt |
| local file path | extension lookup (`png/jpg/jpeg/gif/webp/bmp`) | Read file with `fs.readFile`, encode as `data:{mime};base64,...` |

Normalization rules:

- MIME is inferred **from the file extension** for local files; unknown extensions are rejected
  with a list of supported types.
- The clipboard path supports **Windows (PowerShell) and macOS (Swift) only**. On Linux it
  throws `VisionInputError` with a readable message.
- A dataURL that fails the `image/*` validation regex is rejected immediately — no guessing.
- Empty / whitespace-only input is a `VisionInputError`.

## 4. Message body construction (OpenAI vs Anthropic)

The request format is chosen by `VISION_API_FORMAT` (`openai` default, `anthropic` to switch).
Both formats put the prompt text and the image(s) into a single user message.

### 4.1 OpenAI (`POST {base}/chat/completions`)

```json
{
  "model": "<VISION_MODEL>",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "<prompt>" },
      { "type": "image_url", "image_url": { "url": "<url-or-dataURL>", "detail": "auto" } }
    ]
  }],
  "max_tokens": 2048
}
```

- `detail` is added only for OpenAI: `"auto"` for `compare_images`, `"high"` for
  `ocr_image`, omitted for `analyze_image`.
- Auth header: `Authorization: Bearer <key>`.
- For `ocr_image` the body also sets `temperature: 0` and `max_tokens: 8192` (OCR text
  volume is large); `compare_images` uses the default 2048.

### 4.2 Anthropic (`POST {base}/v1/messages`)

```json
{
  "model": "<VISION_MODEL>",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "<prompt>" },
      {
        "type": "image",
        "source": { "type": "base64", "media_type": "image/png", "data": "<base64>" }
      }
    ]
  }],
  "max_tokens": 2048
}
```

- URLs keep their native Anthropic form: `source: { "type": "url", "url": "..." }`.
- dataURLs are split into `{type:"base64", media_type, data}` blocks.
- Auth headers: `x-api-key`, `anthropic-version: 2023-06-01`, plus `Authorization: Bearer`
  for compatibility with Anthropic-compatible relays.
- `{base}` is used verbatim and `/v1/messages` is appended — set
  `VISION_API_BASE_URL` to the **base without `/v1`** for Anthropic (e.g.
  `https://api.anthropic.com/`), and to a URL **ending with `/v1`** for OpenAI.

### 4.3 Response parsing

| Format | Extraction |
|---|---|
| Anthropic | `data.content` array → join `text` blocks (or string content) |
| OpenAI | `data.choices[0].message.content`, falling back to `message.reasoning_content` when `content` is `null` (reasoning models like mimo-v2.5) |

An empty result is a `VisionApiError("...empty content")`.

## 5. URL download retry

Some gateways do not support remote image URL passthrough and return an HTTP 4xx with a
media/download-related message. vision-bridge-mcp detects this and retries **once** with the
image downloaded to a base64 dataURL:

```
first call with {kind:"url", url}
   │
   ├─ success ──────────────────────────────────────► return answer
   │
   └─ VisionApiError, message matches /media|download/i AND input contains a URL
        │
        └─ downloadToDataUrl(url)
             ├─ fetch with 60s timeout (connection + headers + body)
             ├─ 20MB cap: content-length precheck AND actual-size recheck
             ├─ MIME: response content-type (image/*) → URL path extension → "image/png" fallback
             └─ dataURL
        │
        └─ rebuild body with {kind:"dataUrl", dataUrl} → call again (once)
             └─ result cached under the ORIGINAL url+prompt key
```

- `analyze_image`: single-image retry.
- `compare_images` / `ocr_image`: if **any** URL fails with a media error, **all** URLs in the
  request are downloaded and the whole request is retried once (an atomic retry, so the
  vision model still sees a consistent multi-image request).
- Retry only happens for `VisionApiError` whose message contains `media` or `download`;
  other errors (timeout, auth, rate limit) are thrown as-is.

## 6. Caching

Enabled by default (`VISION_CACHE_TTL=3600` seconds); set `VISION_CACHE_TTL=0` or negative
to disable.

```
computeCacheKey(image, prompt) = SHA256(image + "::" + prompt)
  image = normalized identifier:
          {kind:"url"}   → the URL string
          {kind:"dataUrl"} → the full base64 dataURL (i.e. content-addressed)
```

- **Storage**: one JSON file per key in the cache directory
  (`VISION_CACHE_DIR`, default `./.cache`): `{ "result": "...", "cachedAt": <ms> }`.
- **Read**: on hit, validates shape and TTL; expired entries are deleted and treated as a
  miss. Corrupted/missing files are treated as a miss.
- **Write**: directory auto-created; write failures are swallowed (cache is best-effort and
  never fails the request).
- **Scope**: key does **not** include the model name — after switching `VISION_MODEL` you may
  get old-model answers until the TTL expires (clear the cache directory when switching
  models).
- The URL-retry result is stored under the original URL+prompt key, so the next call is a
  direct hit.

## 7. Timeouts & safety limits

| Limit | Value | Where |
|---|---|---|
| API call timeout | 60 s (configurable per call in tests) | `AbortController`, covers connection + response headers + body read; timer cleared in `finally` |
| Image download timeout | 60 s | same full-chain semantics |
| API response size | 16 MB | `content-length` precheck before body read |
| Image download size | 20 MB | `content-length` precheck + actual-buffer recheck |
| Error detail size | 1 MB (text sliced to 500 chars) | error messages stay small |
| Clipboard exec timeout | 15 s | `lib/clipboard.js` |

Timeout has priority over "parse failure" and "read error detail failed" — a timeout is
always surfaced as `VisionTimeoutError`.

## 8. Error model

```
VisionInputError    — bad input: empty image, invalid dataURL, unsupported extension,
                      unreadable file, clipboard failure, unsupported platform
VisionApiError      — upstream failure: HTTP status (with status code), oversized response,
                      unparseable body, empty content, network error
VisionTimeoutError  — the 60s full-chain timeout expired
```

`server.js` wraps every tool call in `safeCall`: on success it returns
`{content:[{type:"text", text}]}`; on any error it returns
`{content:[{type:"text", text:"[vision_error] <message>"}], isError:true}` so MCP clients can
display a readable failure without crashing the tool loop.

## 9. Configuration

Read once at startup by `configFromEnv(process.env)`; missing required variables abort with
exit code 1 before the server starts.

| Variable | Required | Default | Effect |
|---|---|---|---|
| `VISION_API_BASE_URL` | ✅ | — | API base; OpenAI: ends with `/v1`, Anthropic: without `/v1` |
| `VISION_API_KEY` | ✅ | — | Bearer / `x-api-key` credential |
| `VISION_MODEL` | ✅ | — | Vision model name sent in the body |
| `VISION_API_FORMAT` | | `openai` | `openai` or `anthropic` |
| `VISION_MAX_TOKENS` | | `2048` | `max_tokens` per call (OCR overrides to 8192) |
| `VISION_CACHE_TTL` | | `3600` | seconds; `0`/negative disables cache |
| `VISION_CACHE_DIR` | | `./.cache` | cache directory (auto-created) |

## 10. Module map

| File | Responsibility |
|---|---|
| `server.js` | Entry point: config validation, MCP tool registration (`analyze_image` / `ocr_image` / `compare_images`), `safeCall` error wrapper, stdio transport |
| `lib/vision.js` | Core: input normalization, message body builders, `callVision` (dual-format HTTP), `downloadToDataUrl`, OCR prompt builder, retry + cache orchestration, `configFromEnv` |
| `lib/cache.js` | SHA256 key computation, TTL-aware file cache read/write |
| `lib/clipboard.js` | Platform-resolved clipboard → temp PNG runner (win32 PowerShell / darwin Swift) |
| `lib/errors.js` | `VisionInputError` / `VisionApiError(status)` / `VisionTimeoutError` |
| `scripts/clipboard.ps1` | Windows clipboard image extraction |
| `scripts/clipboard.swift` | macOS clipboard image extraction |
| `test/*` | Unit tests + stdio end-to-end smoke test against a local HTTP stub |

## 11. Design notes

- **Zero conversation state** — the server is trivially parallelizable and restart-safe; all
  transient state lives in the cache directory only.
- **Result caching is server-side and transparent** — the host model never knows whether an
  answer came from the vision API or the cache; caching never changes tool semantics.
- **The vision-sidecar skill is a separate routing layer** (see `skill/vision-sidecar.md`);
  it runs in the host model, not in this server. Without the skill, this server behaves
  identically for any caller.
