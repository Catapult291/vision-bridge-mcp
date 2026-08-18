# Acceptance Test Record

- Date: 2026-08-10
- Environment: Vision model via local gateway, `VISION_API_BASE_URL` set to local endpoint
- Method: Test runner spawns real `server.js` via stdio, calls `analyze_image` for each case

## Test Cases

| # | Input | Result | Notes |
|---|---|---|---|
| 1 | Local path (UI screenshot) | ✅ | Returned 1421-char detailed description, accurate recognition |
| 2 | Web URL (Wikipedia hibiscus image) | ✅ | URL passthrough rejected by upstream (HTTP 400 media error) → auto-downloaded to base64 and retried → recognized "hibiscus" with petal details |
| 3 | Local path + custom prompt "describe layout, buttons, text — concise" | ✅ | Returned 348-char structured two-column layout description, strictly followed "concise" instruction |
| 4a | Non-existent path `test/samples/nope.png` | ✅ | `[vision_error] Cannot read image file: ... (ENOENT)` |
| 4b | Non-image file `test/samples/sample.txt` | ✅ | `[vision_error] Unsupported file type: .txt (supported: .png, .jpg, .jpeg, .gif, .webp, .bmp)` |
| 5 | Regression: vision-sidecar skill disabled | ✅ (manual) | No auto-call of analyze_image; behavior unchanged without skill |

## Issues Found & Fixed During Acceptance

1. **Empty content**: Reasoning models may return `content: null` with the answer in `reasoning_content`; default 1024 tokens get consumed by reasoning.
   - Fix: `callVision` falls back to `reasoning_content`; `max_tokens` 1024 → 2048.
2. **Remote URL not supported by upstream**: Some gateways return HTTP 400 "failed to download or process media content" for `image_url` with remote URLs.
   - Fix: Added `analyzeImage` orchestration — when URL passthrough fails with media/download error, download image to base64 and retry once.
3. **Windows IPv6 connectivity issue**: `fetch` (undici) prefers IPv6 addresses causing `UND_ERR_CONNECT_TIMEOUT`; curl works fine, node fails.
   - Fix: Add `NODE_OPTIONS=--dns-result-order=ipv4first` to the environment.

## Notes

- `reasoning_content` fallback means returned text may contain reasoning chain fragments; acceptable for image description scenarios. To get pure final answers, consider upgrading to "retry once with higher max_tokens when content is empty".
- Single recognition takes ~10–30s (reasoning models); synchronous tool semantics mean the host model's tool call naturally waits.
