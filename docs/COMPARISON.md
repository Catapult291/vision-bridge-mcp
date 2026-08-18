# vision-bridge-mcp vs. Other Vision MCP Servers

> **Data verification**: All star counts, languages and activity dates below were fetched live from the GitHub REST API (`gh api repos/<owner>/<repo>`) on **2026-08-18**. Star counts drift over time; treat them as a snapshot.
> **Scope**: This document focuses on **LLM vision bridge / sidecar** servers (Category A) — the direct competitors of vision-bridge-mcp. Categories B/C are listed for completeness.
> **Method**: vision-bridge-mcp capabilities are confirmed from its source code. Competitor capabilities are taken from each project's README (checked on the same date); items marked `?` could not be confirmed from the README.

---

## 1. Landscape Overview

### Category A — LLM vision bridge / sidecar (direct competitors)

Give text-only LLMs (DeepSeek, GLM, Qwen-coder, etc.) the ability to "see" by forwarding images to a vision-capable model over the network.

| # | Repo | Lang | Stars | Pushed | Positioning |
|---|---|---|---|---|---|
| 1 | **JochenYang/luma-mcp** | TypeScript | **109** | 2026-07 | Multi-provider vision MCP (GLM-4.6V / DeepSeek-OCR / Qwen3-VL / Doubao / Hunyuan). Single tool `image_understand`, large-image auto-cropping, HTTP/Docker deployment, npx, bundled `vision-skill`. **Strongest competitor.** |
| 2 | **tan-yong-sheng/ai-vision-mcp** | TypeScript | **74** | 2026-04 | Gemini/Vertex AI. Image + video, design audit (color/contrast/hierarchy). |
| 3 | **djannot/puppeteer-vision-mcp** | TypeScript | **48** | — | Puppeteer screenshots + vision analysis. |
| 4 | **Capetlevrai/clipboard-vision-mcp** | Python | **44** | 2026-07 | Clipboard-first vision bridge (fork of itcomgroup/vision-mcp-server). 5 `*_from_clipboard` tools, free Groq + Qwen backend, Windows/macOS/Linux X11+Wayland clipboard. |
| 5 | **TheNomadInOrbit/Vision-MCP-Server** | TypeScript | **20** | 2026-07 | OpenRouter vision models, single `analyze_image` tool. |
| 6 | **Loveacup/vision-mcp-server** | TypeScript | **19** | — | Multimodal vision via multiple providers (upstream of Dellety's fork). |
| 7 | **Nazruden/mcp-openvision** | Python | **15** | 2025-04 | OpenRouter vision models, single tool, PyPI. |
| 8 | **lmtttt/deepseek-vision-mcp** | Python | **11** | — | Wraps DeepSeek web chat's native multimodal endpoint. |
| 9 | **kbrisso/byte-vision-mcp** | Go | **11** | — | Go vision MCP. |
| 10 | **kitlau86/agent-vision-mcp** | TypeScript | **10** | 2026-06 | Single `analyze_image`, OpenAI-compatible, SHA256 cache, npm. |
| 11 | **ghbalf/llm-vision-mcp** | TypeScript | **9** | 2026-04 | 6 providers (OpenAI / Anthropic / Google / Ollama / OpenAI-compatible / Generic HTTP), CLI+env+config 3-level config. |
| 12 | **Dellety/vision-mcp-for-ds** | TypeScript | **7** | 2026-08 | 4 tools (analyze/ocr/compare/video), profile presets. Fork of Loveacup/vision-mcp-server. |
| 13 | **ironsheep/image_tools_mcp** | **Go** | **6** | 2026-06 | Precise image measurement tools (pixel distance / color / shape), non-LLM. |
| 14 | **mikechambers/image-vision-mcp** | JavaScript | **5** | 2025-04 | Ollama llava local model, minimal. |
| 15 | **Pelican0126/vision-mcp** | TypeScript | **1** | 2026-06 | 8 tools, **server-led agentic zoom** (grid → grounding → precise crop), ffmpeg video sampling, `structuredContent` metadata output, SSRF/path-allowlist hardening. Underrated depth. |
| 16 | **moton16/dsh-vision-mcp** | JavaScript | **1** | 2026-08 | Zero-dependency (`img2text` single tool), provider fallback, npm. |
| 17 | **systemmin/image-mcp** | TypeScript | **1** | 2026-07 | Anthropic/Zhipu/Ollama backends, multi-image compare. |

**vision-bridge-mcp** (this project) — currently **0 stars** (just created 2026-08-18). Node.js, dual-protocol (OpenAI + Anthropic), 3 tools, clipboard support, SHA256+TTL cache, URL-download retry, model-capability routing skill.

### Category B — Local / self-hosted CV (different trade-off: runs on your machine, no LLM API)

| Repo | Lang | Stars | Notes |
|---|---|---|---|
| **groundlight/mcp-vision** | Python | **61** | HuggingFace CV models (zero-shot detection, zoom_to_object), Docker+GPU. |
| **ihugang/ocrtool-mcp** | Swift | **39** | macOS Vision framework local OCR (no LLM involved). |
| **wjh1547485653-max/minicpm-vision-mcp** | JavaScript | **13** | Local MiniCPM-V, vision + audio. |
| **mikechambers/image-vision-mcp** | JavaScript | **5** | Ollama llava. |

### Category C — Non-LLM image processing / deprecated

| Repo | Lang | Stars | Status | Notes |
|---|---|---|---|---|
| **GongRzhe/opencv-mcp-server** | Python | **111** | ⚠️ **archived (2025-09)** | OpenCV image/video processing, non-AI. |
| **landing-ai/vision-agent-mcp** | TypeScript | **28** | ⚠️ **deprecated** | Use Agentic Document Extraction instead. |
| **agentralabs/agentic-vision** | Rust | **11** | active | Persistent CLIP visual memory, screenshot capture/recall — adjacent, not a bridge. |

---

## 2. Feature Comparison Matrix (Category A, core competitors)

Legend: ✅ supported · ❌ not supported · ⚠️ partial/different approach · ? unconfirmed from README

| Feature | **vision-bridge** (this) | luma-mcp 109★ | ai-vision-mcp 74★ | puppeteer-vision 48★ | clipboard-vision 44★ | Vision-MCP-Srv 20★ | Loveacup 19★ | mcp-openvision 15★ | agent-vision 10★ | llm-vision 9★ | Dellety/vision-ds 7★ | Pelican0126 1★ | dsh-vision 1★ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Language / runtime** | Node.js | Node/TS | TS | TS | Python | Node/TS | TS | Python | TS | TS | TS | TS | Node |
| **analyze_image (basic)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **ocr_image (structured)** | ✅ plain/md/json | ⚠️ via prompt/OCR models | ❌ | ❌ | ✅ extract_text | ❌ | ? | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **compare_images (2–4)** | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ? | ❌ | ❌ | ❌ | ✅ | ? | ❌ |
| **Video support** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ? | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **OpenAI-compatible** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Anthropic Messages native** | ✅ (env switch) | ❌ | ❌ | ❌ | ❌ | ❌ | ? | ❌ | ❌ | ✅ (provider) | ❌ | ❌ | ❌ |
| **Clipboard input** | ✅ Win+macOS | ❌ | ❌ | ❌ | ✅ Win+mac+Linux | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ Win only | ❌ |
| **Result caching** | ✅ SHA256+TTL | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ SHA256 | ❌ | ❌ | ❌ | ❌ |
| **URL-passthrough failure → auto download retry** | ✅ (verified) | ⚠️ network retry only | ❌ | ❌ | ❌ | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ⚠️ download+SSRF (no retry) | ❌ |
| **reasoning_content fallback** | ✅ (unique) | ❌ | ❌ | ❌ | ❌ | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Model-capability routing skill** | ✅ vision-sidecar (routing) | ⚠️ vision-skill (always-bridge) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Agentic zoom / auto-crop** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Provider presets / profiles** | ❌ | ✅ multi-provider | ✅ Gemini | ❌ | ✅ Groq free | ✅ OpenRouter | ? | ✅ OpenRouter | ❌ | ✅ 6 providers | ✅ profiles | ✅ profiles | ❌ |
| **npm / PyPI install** | ❌ (planned) | ✅ npx | ❌ | ? | ? | ❌ | ? | ✅ PyPI | ✅ npm | ❌ | ❌ | ❌ | ✅ npm |
| **HTTP / Docker deployment** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Zero npm dependencies** | ⚠️ (SDK+zod needed, not yet declared) | ❌ | ❌ | ❌ | n/a (Python) | ❌ | ❌ | n/a | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Full-chain timeout + size caps** | ✅ 60s / 16MB / 20MB / 1MB | ⚠️ retry | ❌ | ❌ | ❌ | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ⚠️ size caps | ❌ |
| **Typed error classes** | ✅ 3 classes | ❌ | ❌ | ❌ | ❌ | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Security hardening (SSRF/path allowlist)** | ❌ | ✅ SSRF | ❌ | ❌ | ❌ | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Automated tests** | ✅ 71 cases + smoke E2E | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ✅ smoke | ✅ mock |

---

## 3. What vision-bridge-mcp Does That Others Don't

1. **Native dual protocol (OpenAI `chat/completions` + Anthropic `messages`)** — switch with `VISION_API_FORMAT`. Most competitors are OpenAI-only; ghbalf offers Anthropic only as one of several preset providers, not as a first-class side-by-side protocol. If your stack talks to an Anthropic-compatible gateway (Claude, or a relay that speaks Anthropic format), vision-bridge needs **no proxy shim**.
2. **Model-capability routing skill (`vision-sidecar`)** — the only project whose skill *routes by host-model capability*: multimodal host models use their native vision (no token waste), text-only host models call the MCP. luma-mcp's `vision-skill` is different: it always bridges via a script, and only as an alternative to its MCP server. Zero intrusion when the skill is not enabled.
3. **URL-passthrough failure auto-download retry** — detects `media/download` API errors (gateways that reject remote image URLs) and retries with base64. Verified against real gateways; multi-image retries as a whole.
4. **`reasoning_content` fallback** — handles reasoning models (e.g. mimo-v2.5) that return `content: null` with the answer in `reasoning_content`. No competitor handles this.
5. **Production-grade robustness in a small package** — full-chain timeout (connection+headers+body via `AbortController`, cleared in `finally`), 16MB response / 20MB image / 1MB error-detail caps, 3 typed error classes surfaced as MCP `isError`, 71 unit tests + stdio end-to-end smoke test.
6. **Structured OCR** (`plain` / `markdown` / `json` blocks) with `detail=high`, `temperature=0`, and language hints.

## 4. Where Competitors Are Stronger (honest gaps)

| Gap | Competitor | Detail |
|---|---|---|
| **Video analysis** | ai-vision-mcp, Dellety, Pelican0126 | frame sampling / native video input. |
| **Agentic zoom / large-image cropping** | luma-mcp, Pelican0126 | luma auto-crops large screenshots; Pelican0126 does deterministic grid → model grounding → precise crop with early exit. vision-bridge sends the full image as-is. |
| **HTTP / Docker shared deployment** | luma-mcp | LAN multi-client sharing of one instance (v1.7.0+). |
| **Linux clipboard** | clipboard-vision-mcp | X11 + Wayland support; vision-bridge explicitly errors on Linux. |
| **Free vision backend** | clipboard-vision-mcp | Groq free tier + Qwen 27B; vision-bridge requires your own API key. |
| **Multi-provider presets** | luma-mcp, ghbalf, Dellety | vision-bridge requires manually filling base_url / model / key. |
| **Security hardening** | Pelican0126, luma-mcp | path allowlist + SSRF checks on URL download. vision-bridge downloads URLs without SSRF validation (a feature/attack-surface trade-off to document). |
| **npm/npx install** | luma-mcp, agent-vision, dsh-vision, mcp-openvision | Published as `npx vision-bridge-sidecar` (0.1.0+). npm name differs from the GitHub repo name because `vision-bridge-mcp` was already taken on npm. |
| **Zero-dependency install** | dsh-vision | vision-bridge needs `@modelcontextprotocol/sdk` + `zod`; both are declared in `package.json` (dependencies + engines since 0.1.0). |

## 5. Positioning Summary

- **Best fit for**: users behind **non-standard API gateways** (Anthropic-compatible relays, self-hosted proxies) where dual protocol is a hard requirement; **mixed multimodal/text-only model setups** that want capability routing without token waste; **Windows/macOS desktop screenshot workflows** needing clipboard input; users who value **production robustness** (timeouts, caps, typed errors, tests).
- **Weakest fit for**: video analysis, huge dense screenshots needing zoom, Linux-only desktops, LAN shared deployment, no-API-key scenarios.
- **Differentiators to lead with in the README**: dual protocol, capability-routing skill, URL-download retry, `reasoning_content` fallback. **Differentiators NOT to claim**: "zero dependencies" (relies on `@modelcontextprotocol/sdk` + `zod`, declared in `package.json`), "unique skill" (luma-mcp has one too, though with different semantics).

---

*Snapshot generated 2026-08-18. Re-verify star counts before re-publishing this document.*
