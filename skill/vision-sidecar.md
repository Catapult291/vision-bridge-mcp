---
name: vision-sidecar
description: "Route image understanding by host-model capability. Text-only host models delegate images to vision-bridge-mcp's analyze_image / ocr_image / compare_images; multimodal host models (grok-4.5, gpt-4o, gemini, claude vision, qwen-vl, etc.) use their native vision and skip the MCP. Use when a conversation contains image attachments, web images, local screenshots, or when captcha / UI / chart recognition is needed."
---

# Vision Sidecar (Image-Routing Skill)

When this skill is enabled, the host model picks its image path by **whether it has native multimodal vision** — it does not always delegate to the MCP.

## Capability check (decide first)

Run a quick self-check before doing any image understanding:

| Verdict | Condition | Path |
|---|---|---|
| **Multimodal** | The current model itself can see images (e.g. `grok-4.5`, `gpt-4o` / `gpt-4.1` / `gpt-5*`, `gemini-*`, `claude-*-*` vision, `qwen*-vl*`, similar VL/vision models) | **Understand natively** — do NOT call `analyze_image` just to "see" the image |
| **Text-only** | Pure-text model, or the image is not visible in your current context | **Call the vision MCP** |

Conservative rules when unsure:

- If the image content was delivered to you as a multimodal message and you can describe pixel-level details → treat as **multimodal**.
- If you cannot see the image at all — only a path / URL / placeholder → treat as **text-only**, call the MCP.

## Path A: Multimodal host → understand natively

1. Read and understand the image directly (user attachments, images already in context, task-related screenshots).
2. To **display** an image to the user, use the host's image display tool; displaying ≠ understanding — understanding uses your own vision.
3. If the platform already delivered a local path / URL into your multimodal context, describe it directly; do not route through the MCP.
4. **The only MCP exception**: when the system clipboard holds an image, the conversation has no path / URL / dataURL / attachment, and you cannot natively read the OS clipboard → call `analyze_image(image="clipboard")`.
5. Never treat the MCP as a "more accurate second opinion"; with multimodal capability the MCP is a bypass, not the default.

## Path B: Text-only host → vision MCP

### When to call

Call the vision MCP whenever an image needs **semantic understanding**:

- `analyze_image(image, prompt?)` — general understanding of a single image
- `ocr_image(image, format?, languages?)` — structured text extraction (`plain` / `markdown` / `json`)
- `compare_images(images, prompt?)` — differences / similarities between 2–4 images

Applicable inputs:

- image attachments sent in the conversation
- web image URLs encountered during a task (when their content matters)
- local screenshot / image file paths produced by tools
- clipboard-only images (pass `image="clipboard"` when no path / URL / dataURL exists)

**Skip** decorative images: icons, solid color blocks, ad banners, images irrelevant to the task.

### How to call

- `image`: pass the path / URL / dataURL directly; if only the OS clipboard has the image, pass `clipboard` (also accepts `clip` / `pasteboard`).
- `prompt`: customize as needed, e.g.
  - "Read the captcha in this image"
  - "Describe this UI's layout, buttons, and text"
  - "What is in this image? List item by item"
- Response language follows the conversation language; add an explicit language hint in `prompt` when needed.
- Clipboard is supported on Windows / macOS only; on failure, relay the error and ask the user to save the image to a file and pass the path.

### After the result

- Treat the returned text as the image content and continue the original task.
- **Never guess image content**; if the tool returns a failure, relay it truthfully.

### Path B failure (degradation)

- If the tool returns `[vision_error] ...`, tell the user "vision service is temporarily unavailable" and continue with the rest of the task; do not stall, do not fabricate image content.

## Shared boundaries

- Process one image that needs understanding at a time; multiple images in order.
- Do not modify or cache images; understanding is stateless (result caching, when enabled, is handled server-side by vision-bridge-mcp).
- Decorative images are skipped on both paths.
- When the skill is not enabled, routing is inactive and the host keeps its default image handling — zero intrusion.

## Installation

vision-bridge-mcp ships this file at `skill/vision-sidecar.md`. To enable routing in your MCP client:

1. Copy `skill/vision-sidecar.md` into your MCP client's skills directory (e.g. Claude Code `~/.claude/skills/`, Cursor `.cursor/skills/`, LiveAgent skills root, or any agent that loads SKILL.md-style files) — rename to `SKILL.md` where the client requires that layout.
2. Configure vision-bridge-mcp as an MCP server in the same client (see README Quick Start).
3. The skill only takes effect when enabled; behavior is unchanged otherwise.

## Difference from luma-mcp's `vision-skill`

luma-mcp also ships a vision skill, but with different semantics: its `vision-skill` **always bridges** images through a script to the vision API (an alternative to its MCP server). `vision-sidecar` is a **routing layer**: multimodal host models use their native vision (zero token cost), and only text-only host models call the MCP. The decision is based on the host model's capability — not on "an image exists".
