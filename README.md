# vision-bridge-mcp

> Vision sidecar MCP server — gives text-only LLMs the ability to see images.
> Supports **OpenAI AND Anthropic** API formats natively. Includes model-capability routing skill.

## Why?

Most LLMs are text-only — they cannot see images. This MCP server bridges that gap by forwarding images to a vision-capable model and returning text results. It works with any OpenAI-compatible or Anthropic-compatible API endpoint.

When paired with the `vision-sidecar` skill, it automatically routes based on the host model's capabilities:

| Host Model | Image Path |
|---|---|
| **Text-only** (no multimodal) | Calls this MCP's `analyze_image`, uses result as text |
| **Multimodal** (gpt-4o / claude vision / gemini / grok, etc.) | Uses native image understanding, does **not** call this MCP |

Exception: when the system clipboard has an image and the conversation has no path/URL/attachment, even multimodal host models may pass `image="clipboard"`.

## Features

- ✅ **Three tools**: `analyze_image`, `ocr_image`, `compare_images`
- ✅ **Dual protocol**: OpenAI `chat/completions` AND Anthropic `messages` format
- ✅ **Clipboard support**: Windows (PowerShell) + macOS (Swift)
- ✅ **SHA256 file cache** with configurable TTL
- ✅ **URL download retry**: auto-downloads remote URLs to base64 when passthrough fails
- ✅ **Reasoning model fallback**: extracts `reasoning_content` when `content` is null
- ✅ **Full-chain timeout**: connection + headers + body reading
- ✅ **Safety limits**: 16MB response / 20MB image / 1MB error detail
- ✅ **Typed errors**: `VisionInputError` / `VisionApiError` / `VisionTimeoutError`
- ✅ **Comprehensive tests**: 30+ unit tests + end-to-end smoke tests
- ✅ **Zero new npm dependencies** (uses workspace `node_modules`)

## Quick Start

1. Ensure `node` ≥ 18 is in your PATH.
2. Set environment variables:

```bash
export VISION_API_BASE_URL=https://api.example.com/v1   # OpenAI: ends with /v1; Anthropic: base without /v1
export VISION_API_KEY=sk-...                             # API key
export VISION_MODEL=gpt-4o                               # Vision model name
# Optional: export VISION_API_FORMAT=anthropic            # openai (default) or anthropic
```

3. Register in your MCP client config:

```json
{
  "id": "vision-bridge-mcp",
  "transport": "stdio",
  "command": "node",
  "args": ["server.js"],
  "cwd": "/path/to/vision-bridge-mcp",
  "env": {
    "VISION_API_BASE_URL": "https://api.example.com/v1",
    "VISION_API_KEY": "your-key",
    "VISION_MODEL": "gpt-4o"
  },
  "enabled": true
}
```

## Configuration

| Variable | Description | Example |
|---|---|---|
| `VISION_API_BASE_URL` | Vision model API base URL. OpenAI: usually ends with `/v1`; Anthropic: base without `/v1` (auto-appends `/v1/messages`) | `https://api.openai.com/v1` or `https://api.anthropic.com/` |
| `VISION_API_KEY` | API key | `sk-...` |
| `VISION_MODEL` | Vision model name | `gpt-4o` |
| `VISION_API_FORMAT` | (Optional) Request protocol: `openai` (default) or `anthropic` | `anthropic` |
| `VISION_MAX_TOKENS` | (Optional) Max output tokens per call, default 2048 | `4096` |
| `VISION_CACHE_TTL` | (Optional) Cache TTL in seconds, default 3600; `0` or negative disables | `3600` |
| `VISION_CACHE_DIR` | (Optional) Cache directory, default `./.cache` | `/tmp/vision-cache` |
| `NODE_OPTIONS` | (Optional) `--dns-result-order=ipv4first` for Windows IPv6 routing issues | `--dns-result-order=ipv4first` |

Startup validates the first three variables; missing ones cause a readable error and exit (code 1).

## Tools

### `analyze_image`

> **Prerequisite**: Only call when the host model lacks multimodal vision. If the host model is multimodal, use its native image understanding.

- `image` (required, string): Local file path / http(s) URL / base64 dataURL / `clipboard`.
  - Local path: infers MIME from extension (png/jpg/jpeg/gif/webp/bmp), converts to base64 dataURL.
  - http(s) URL: passed as `image_url` directly.
  - dataURL: only `image/*` base64 encoding accepted.
  - `clipboard` / `clip` / `pasteboard`: reads current system clipboard image (Windows: `scripts/clipboard.ps1`, macOS: `scripts/clipboard.swift`), writes to temp PNG, then normalizes. Linux not supported.
- `prompt` (optional, string): Custom recognition instruction. Default: "Describe this image in detail."
- Returns: success `{ content: [{ type: "text", text }] }`; failure `{ content: [{ type: "text", text: "[vision_error] ..." }], isError: true }`.

Internal request (split by `VISION_API_FORMAT`):
- **OpenAI**: `POST {base}/chat/completions`, image as `image_url` part, auth `Authorization: Bearer`.
- **Anthropic**: `POST {base}/v1/messages`, image as `image` block (`source: {type: base64, media_type, data}` or `{type: url, url}`), auth `x-api-key` + `anthropic-version: 2023-06-01` (also sends `Authorization: Bearer` for compatibility).

Default timeout: 60s (covers connection + body reading).

Safety limits: API response 16MB, image download 20MB (content-length precheck + actual size recheck).

Behavior notes (from real model testing):
- Reasoning models may return `content: null` with answer in `reasoning_content` — automatically falls back.
- http(s) URL passthrough failure with media/download error → auto-downloads to base64 and retries once.

### `ocr_image`

- `image` (required, string): Same normalization as `analyze_image`.
- `languages` (optional, string): Language hints (e.g. `zh,en`).
- `format` (optional, enum): `plain` (default, plain text preserving layout) / `markdown` (preserves headings/lists/tables) / `json` (returns `blocks` array with `text` + `type`).
- Uses `image_url.detail = "high"` internally; prompt injected per format.

### `compare_images`

- `images` (required, array, 2–4): Each supports local path / http(s) URL / dataURL / clipboard.
- `prompt` (optional, string): Custom comparison instruction. Default: "Compare these images and describe their differences and similarities."
- Single user message with text + multiple `image_url` parts (`detail = "auto"`).
- If any URL fails with media/download error, all URLs are downloaded to base64 and retried once.

## Vision Sidecar Skill

The `vision-sidecar` skill provides model-capability routing. When enabled in your MCP client:

- Host model has multimodal → uses native image understanding (no MCP call)
- Host model is text-only → calls this MCP's `analyze_image`
- Exception: clipboard reading available for multimodal host models

Without the skill, the host model's behavior is completely unchanged — zero intrusion.

See `skill/vision-sidecar.md` for the skill file.

## Caching

Enabled by default. Caches vision API results for identical "image + prompt" combinations.

- **Key**: `SHA256(image identifier + "::" + prompt)`. Local files/dataURLs hashed by base64 content; http(s) URLs hashed by URL string.
- **Storage**: One JSON file per key (`{ result, cachedAt }`), stored in cache directory.
- **TTL**: Default 1 hour. Expired entries auto-deleted on next access.
- **Disable**: `VISION_CACHE_TTL=0` (or negative).
- **Note**: Key does not include model name. After switching `VISION_MODEL`, TTL-period may return cached results from the old model — clear cache directory when switching models.

## Testing

```bash
cd vision-bridge-mcp
node --test
```

- `test/vision.test.js`: Core library unit tests (input normalization / message body / API calls / error mapping / timeout / cache / URL retry / OCR / clipboard).
- `test/cache.test.js`: Cache module tests (key stability / hit / expiry / corrupted JSON / backward compat).
- `test/smoke.test.mjs`: End-to-end smoke test — spawns real `server.js` via stdio, uses local HTTP stub to simulate vision model, validates tools/list and tool calls.

## Comparison with Other Vision MCPs

See [docs/COMPARISON.md](docs/COMPARISON.md) for a detailed comparison with other vision MCP projects.

## License

MIT
