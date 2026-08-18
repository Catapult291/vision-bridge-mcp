import fs from "node:fs/promises";
import path from "node:path";
import { readClipboardImage as readClipboardImageDefault } from "./clipboard.js";
import { VisionInputError, VisionApiError, VisionTimeoutError } from "./errors.js";
import { computeCacheKey, getCachedResult, setCachedResult } from "./cache.js";

export { VisionInputError, VisionApiError, VisionTimeoutError };

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

// Used by downloadToDataUrl to infer MIME from URL extension when Content-Type is missing
export const MIME_BY_EXT_FOR_URL = MIME_BY_EXT;

const DEFAULT_MAX_TOKENS = 2048;
const OCR_MAX_TOKENS = 8192; // OCR text volume is large, needs higher limit
const DEFAULT_CACHE_TTL_SECONDS = 3600; // Default cache TTL: 1 hour; VISION_CACHE_TTL=0 disables
// Safety limits: API response (JSON) 16MB, image download 20MB
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_ERROR_DETAIL_BYTES = 1024 * 1024;
// Only accept image/* base64 dataURLs
const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,[\sA-Za-z0-9+/=]+$/;
const CLIPBOARD_RE = /^(clipboard|clip|pasteboard)$/i;

const msgOf = (e) => (e instanceof Error ? e.message : String(e));
const isTimeoutAbort = (e) => e instanceof VisionTimeoutError || (e && e.name === "AbortError");

function contentLength(res) {
  const get = typeof res?.headers?.get === "function" ? res.headers.get.bind(res.headers) : null;
  if (!get) return null;
  const n = Number(get("content-length"));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function normalizeImageInput(input, { readClipboard = readClipboardImageDefault } = {}) {
  const s = String(input ?? "").trim();
  if (!s) throw new VisionInputError("image parameter is empty");
  if (CLIPBOARD_RE.test(s)) {
    const filePath = await readClipboard();
    try {
      return await normalizeImageInput(filePath);
    } finally {
      // Only clean up temp PNGs created by this module (vision-clipboard-*.png)
      if (/vision-clipboard-\d+\.png$/i.test(path.basename(filePath))) {
        fs.unlink(filePath).catch(() => {});
      }
    }
  }
  if (s.startsWith("data:")) {
    if (!DATA_URL_RE.test(s)) {
      throw new VisionInputError("Invalid dataURL: only image/* base64 encoding is accepted (e.g. data:image/png;base64,....)");
    }
    return { kind: "dataUrl", dataUrl: s };
  }
  if (/^https?:\/\//i.test(s)) return { kind: "url", url: s };
  const ext = path.extname(s).toLowerCase();
  if (!MIME_BY_EXT[ext]) {
    throw new VisionInputError(`Unsupported file type: ${ext || "(no extension)"} (supported: ${Object.keys(MIME_BY_EXT).join(", ")})`);
  }
  let buf;
  try {
    buf = await fs.readFile(s);
  } catch (e) {
    throw new VisionInputError(`Cannot read image file: ${s} (${e.code || e.message})`);
  }
  return { kind: "dataUrl", dataUrl: `data:${MIME_BY_EXT[ext]};base64,${buf.toString("base64")}` };
}

const ANTHROPIC_VERSION = "2023-06-01";

// Split a dataURL (data:image/<mime>;base64,<data>) into an Anthropic image source (base64 form)
function dataUrlToAnthropicSource(dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(String(dataUrl ?? ""));
  if (!m) throw new VisionInputError("Invalid dataURL: only image/* base64 encoding is accepted");
  return { type: "base64", media_type: m[1], data: m[2] };
}

// Generate a single image content part. For format="anthropic" use Anthropic image block,
// otherwise use OpenAI image_url block (detail only applies to OpenAI).
function imageContentPart(normalized, format, detail) {
  if (format === "anthropic") {
    if (normalized.kind === "url") {
      return { type: "image", source: { type: "url", url: normalized.url } };
    }
    return { type: "image", source: dataUrlToAnthropicSource(normalized.dataUrl) };
  }
  const imageUrl = normalized.kind === "url" ? normalized.url : normalized.dataUrl;
  const url = detail === undefined ? { url: imageUrl } : { url: imageUrl, detail };
  return { type: "image_url", image_url: url };
}

export function buildChatBody(config, normalized, prompt) {
  const text = (prompt ?? "").trim() || "Describe this image in detail.";
  const format = config.format === "anthropic" ? "anthropic" : "openai";
  return {
    model: config.model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text },
        imageContentPart(normalized, format),
      ],
    }],
    max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

// Multi-image message body: text + multiple images (OpenAI with detail; Anthropic without detail)
export function buildMultiImageBody(config, normalizedList, prompt, { detail = "auto", maxTokens, temperature } = {}) {
  const text = (prompt ?? "").trim() || "Describe the content of these images.";
  const format = config.format === "anthropic" ? "anthropic" : "openai";
  const content = [{ type: "text", text }];
  for (const n of normalizedList) {
    content.push(imageContentPart(n, format, detail));
  }
  const body = {
    model: config.model,
    messages: [{ role: "user", content }],
    max_tokens: maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  if (temperature !== undefined) body.temperature = temperature;
  return body;
}

export async function callVision(config, body, { fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  const format = config.format === "anthropic" ? "anthropic" : "openai";
  const url = `${String(config.baseUrl).replace(/\/+$/, "")}${format === "anthropic" ? "/v1/messages" : "/chat/completions"}`;
  const headers = format === "anthropic"
    ? {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        Authorization: `Bearer ${config.apiKey}`,
      }
    : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` };
  const controller = new AbortController();
  // Timeout covers the entire chain: connection, response headers, response body reading (json/text)
  const timer = setTimeout(() => controller.abort(new VisionTimeoutError("Vision service timeout")), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const cl = contentLength(res);
    if (cl !== null && cl > MAX_RESPONSE_BYTES) {
      throw new VisionApiError(`Vision service response too large (${cl} bytes, exceeds ${MAX_RESPONSE_BYTES} limit)`, res.status);
    }
    if (!res.ok) {
      let detail = "";
      try {
        const errCl = contentLength(res);
        if (errCl !== null && errCl > MAX_ERROR_DETAIL_BYTES) {
          detail = "(error detail too large, omitted)";
        } else {
          detail = (await res.text()).slice(0, 500);
        }
      } catch (e) {
        if (isTimeoutAbort(e)) throw e; // Timeout takes priority over "failed to read error detail"
      }
      throw new VisionApiError(`Vision service returned HTTP ${res.status}: ${detail}`, res.status);
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      if (isTimeoutAbort(e)) throw e; // Timeout takes priority over "parse failure"
      throw new VisionApiError(`Vision service returned unparseable response: ${msgOf(e)}`, res.status);
    }
    let text;
    if (format === "anthropic") {
      // Anthropic Messages: answer is in content array (each block {type, text}), or content is a string directly
      const content = data?.content;
      text = Array.isArray(content)
        ? content.map((b) => (b?.type === "text" ? (b?.text ?? "") : "")).join("")
        : (typeof content === "string" ? content : "");
    } else {
      const msg = data?.choices?.[0]?.message;
      const raw = msg?.content ?? msg?.reasoning_content; // Reasoning models may have content=null, answer in reasoning_content
      text = Array.isArray(raw) ? raw.map((p) => p?.text ?? "").join("") : raw;
    }
    if (typeof text !== "string" || !text.trim()) throw new VisionApiError("Vision service returned empty content", 0);
    return text.trim();
  } catch (e) {
    if (isTimeoutAbort(e)) throw new VisionTimeoutError("Vision service timeout");
    if (e instanceof VisionApiError) throw e;
    throw new VisionApiError(`Failed to call vision service: ${msgOf(e)}`, 0);
  } finally {
    clearTimeout(timer);
  }
}

// Download an http(s) URL image as base64 dataURL (fallback when URL passthrough is not supported by the vision model)
export async function downloadToDataUrl(url, { fetchImpl = fetch, timeoutMs = 60000, maxBytes = MAX_IMAGE_BYTES } = {}) {
  const controller = new AbortController();
  // Timeout covers the entire chain: connection, response headers, response body reading (arrayBuffer)
  const timer = setTimeout(() => controller.abort(new VisionTimeoutError("Image download timeout")), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new VisionInputError(`Image download failed: HTTP ${res.status} (${url})`);
    const cl = contentLength(res);
    if (cl !== null && cl > maxBytes) {
      throw new VisionInputError(`Image too large (content-length ${cl} bytes, exceeds ${maxBytes} limit)`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new VisionInputError(`Image too large (actual ${buf.length} bytes, exceeds ${maxBytes} limit)`);
    }
    const ctype = typeof res.headers?.get === "function" ? res.headers.get("content-type") : null;
    const mime = (ctype && ctype.includes("image") && ctype.split(";")[0].trim())
      || MIME_BY_EXT[path.extname(new URL(url).pathname).toLowerCase()]
      || "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch (e) {
    if (e instanceof VisionInputError) throw e;
    if (isTimeoutAbort(e)) throw new VisionTimeoutError("Image download timeout");
    throw new VisionInputError(`Image download failed: ${url} (${msgOf(e)})`);
  } finally {
    clearTimeout(timer);
  }
}

// ---- OCR / Multi-image comparison (inspired by Dellety/vision-mcp-for-ds) ----

const OCR_FORMAT_INSTRUCTIONS = {
  plain: "Extract all text from the image. Output strictly verbatim — do not paraphrase, rewrite, complete, or translate. Preserve original layout and line breaks. Read top-to-bottom, left-to-right. Use [?] for unrecognizable characters.",
  markdown: "Extract all text from the image and output in Markdown format. Output strictly verbatim — do not paraphrase, rewrite, complete, or translate. Preserve headings, lists, tables, and other structures. Read top-to-bottom, left-to-right. Use [?] for unrecognizable characters.",
  json: 'Extract all text from the image. Output strictly verbatim — do not paraphrase, rewrite, complete, or translate. Return JSON: {"blocks":[{"text":"...","type":"heading|paragraph|list_item|table|caption|other"}]}. Use [?] for unrecognizable characters.',
};

export function buildOcrPrompt(format = "plain", languages = "") {
  let prompt = OCR_FORMAT_INSTRUCTIONS[format] || OCR_FORMAT_INSTRUCTIONS.plain;
  const langs = String(languages ?? "").trim();
  if (langs) prompt += `\nExpected languages: ${langs}. Ensure these language characters are correctly recognized.`;
  return prompt;
}

// Multi-image orchestration: cache + URL passthrough failure (media download error) → download all URLs to base64 and retry once
async function runMultiImage(config, normalizedList, prompt, opts, detail, bodyOpts = {}) {
  const cache = config?.cache;
  const cacheOn = Boolean(cache && cache.dir && Number.isFinite(cache.ttlMs) && cache.ttlMs > 0);
  let cacheKey = null;
  if (cacheOn) {
    const imagesKey = normalizedList.map((n) => (n.kind === "url" ? n.url : n.dataUrl)).join("||");
    cacheKey = computeCacheKey(imagesKey, prompt ?? "");
    const hit = await getCachedResult(cacheKey, cache.dir, cache.ttlMs);
    if (hit !== null) return hit;
  }
  try {
    const body = buildMultiImageBody(config, normalizedList, prompt, { detail, ...bodyOpts });
    const result = await callVision(config, body, opts);
    if (cacheOn) await setCachedResult(cacheKey, result, cache.dir).catch(() => {});
    return result;
  } catch (e) {
    const hasUrl = normalizedList.some((n) => n.kind === "url");
    const isMediaFailure = hasUrl && e instanceof VisionApiError && /media|download/i.test(e.message);
    if (!isMediaFailure) throw e;
    const downloaded = await Promise.all(normalizedList.map(async (n) => {
      if (n.kind !== "url") return n;
      const dataUrl = await downloadToDataUrl(n.url, opts);
      return { kind: "dataUrl", dataUrl };
    }));
    const body = buildMultiImageBody(config, downloaded, prompt, { detail, ...bodyOpts });
    const result = await callVision(config, body, opts);
    if (cacheOn) await setCachedResult(cacheKey, result, cache.dir).catch(() => {});
    return result;
  }
}

export async function ocrImage(config, input, {
  format = "plain",
  languages = "",
  fetchImpl = fetch,
  timeoutMs = 60000,
  readClipboard = readClipboardImageDefault,
} = {}) {
  const opts = { fetchImpl, timeoutMs };
  const normalized = await normalizeImageInput(input, { readClipboard });
  const prompt = buildOcrPrompt(format, languages);
  return runMultiImage(config, [normalized], prompt, opts, "high", { maxTokens: OCR_MAX_TOKENS, temperature: 0 });
}

export async function compareImages(config, images, {
  prompt = "Compare these images and describe their differences and similarities.",
  fetchImpl = fetch,
  timeoutMs = 60000,
  readClipboard = readClipboardImageDefault,
} = {}) {
  const opts = { fetchImpl, timeoutMs };
  const list = Array.isArray(images) ? images : [];
  if (list.length < 2 || list.length > 4) {
    throw new VisionInputError(`compare_images requires 2–4 images, received ${list.length}`);
  }
  const normalized = await Promise.all(list.map((img) => normalizeImageInput(img, { readClipboard })));
  const fullPrompt = (prompt ?? "").trim() || "Compare these images and describe their differences and similarities.";
  return runMultiImage(config, normalized, fullPrompt, opts, "auto");
}

// Main entry: when URL passthrough fails with a media-related error, download to base64 and retry once
export async function analyzeImage(config, input, prompt, {
  fetchImpl = fetch,
  timeoutMs = 60000,
  readClipboard = readClipboardImageDefault,
} = {}) {
  const opts = { fetchImpl, timeoutMs };
  const normalized = await normalizeImageInput(input, { readClipboard });

  // Cache: key = SHA256(image identifier + "::" + prompt), hit → return immediately, saves tokens
  const cache = config?.cache;
  const cacheOn = Boolean(cache && cache.dir && Number.isFinite(cache.ttlMs) && cache.ttlMs > 0);
  let cacheKey = null;
  if (cacheOn) {
    const imageKey = normalized.kind === "url" ? normalized.url : normalized.dataUrl;
    cacheKey = computeCacheKey(imageKey, prompt ?? "");
    const hit = await getCachedResult(cacheKey, cache.dir, cache.ttlMs);
    if (hit !== null) return hit;
  }

  try {
    const body = buildChatBody(config, normalized, prompt);
    const result = await callVision(config, body, opts);
    if (cacheOn) await setCachedResult(cacheKey, result, cache.dir).catch(() => {});
    return result;
  } catch (e) {
    const isMediaFailure = normalized.kind === "url"
      && e instanceof VisionApiError
      && /media|download/i.test(e.message);
    if (isMediaFailure) {
      const dataUrl = await downloadToDataUrl(normalized.url, opts);
      const body = buildChatBody(config, { kind: "dataUrl", dataUrl }, prompt);
      const result = await callVision(config, body, opts);
      // Cache under the original URL+prompt identity so next time it's a direct hit
      if (cacheOn) await setCachedResult(cacheKey, result, cache.dir).catch(() => {});
      return result;
    }
    throw e;
  }
}

export function configFromEnv(env = process.env) {
  const missing = [];
  if (!env.VISION_API_BASE_URL) missing.push("VISION_API_BASE_URL");
  if (!env.VISION_API_KEY) missing.push("VISION_API_KEY");
  if (!env.VISION_MODEL) missing.push("VISION_MODEL");
  if (missing.length) throw new VisionInputError(`Missing required environment variables: ${missing.join(", ")}`);
  const maxTokens = Number(env.VISION_MAX_TOKENS);
  const cacheTtlSeconds = Number(env.VISION_CACHE_TTL);
  let cacheTtlMs = DEFAULT_CACHE_TTL_SECONDS * 1000;
  if (Number.isFinite(cacheTtlSeconds)) {
    // VISION_CACHE_TTL=0 (or negative) disables cache; >0 means seconds
    cacheTtlMs = cacheTtlSeconds > 0 ? Math.round(cacheTtlSeconds * 1000) : 0;
  }
  const cacheDir = (env.VISION_CACHE_DIR ?? "").trim() || path.join(process.cwd(), ".cache");
  const format = String(env.VISION_API_FORMAT ?? "openai").toLowerCase() === "anthropic" ? "anthropic" : "openai";
  return {
    baseUrl: env.VISION_API_BASE_URL,
    apiKey: env.VISION_API_KEY,
    model: env.VISION_MODEL,
    format,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS,
    cache: { dir: cacheDir, ttlMs: cacheTtlMs },
  };
}
