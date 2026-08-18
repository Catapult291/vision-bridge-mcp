import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  normalizeImageInput, buildChatBody, buildMultiImageBody, callVision, analyzeImage, downloadToDataUrl,
  buildOcrPrompt, ocrImage, compareImages,
  VisionInputError, VisionApiError, VisionTimeoutError, configFromEnv,
} from "../lib/vision.js";
import { readClipboardImage, resolveClipboardRunner } from "../lib/clipboard.js";

test("dataURL input passes through directly", async () => {
  const r = await normalizeImageInput("data:image/png;base64,AAAA");
  assert.equal(r.kind, "dataUrl");
  assert.equal(r.dataUrl, "data:image/png;base64,AAAA");
});

test("http(s) URL passthrough", async () => {
  const r = await normalizeImageInput("https://example.com/a.png");
  assert.deepEqual(r, { kind: "url", url: "https://example.com/a.png" });
});

test("local PNG converted to base64 dataURL", async () => {
  const r = await normalizeImageInput("test/samples/sample.png");
  assert.equal(r.kind, "dataUrl");
  assert.ok(r.dataUrl.startsWith("data:image/png;base64,"));
});

test("empty input throws readable error", async () => {
  await assert.rejects(() => normalizeImageInput("   "), VisionInputError);
});

test("non-existent file throws readable error", async () => {
  await assert.rejects(() => normalizeImageInput("test/samples/nope.png"), VisionInputError);
});

test("unsupported extension throws readable error", async () => {
  await assert.rejects(() => normalizeImageInput("test/samples/sample.txt"), VisionInputError);
});

test("buildChatBody generates OpenAI multimodal message", () => {
  const body = buildChatBody({ model: "m" }, { kind: "url", url: "https://x/a.png" }, "describe it");
  assert.equal(body.model, "m");
  assert.equal(body.messages[0].content[0].text, "describe it");
  assert.equal(body.messages[0].content[1].type, "image_url");
  assert.equal(body.messages[0].content[1].image_url.url, "https://x/a.png");
});

test("buildChatBody uses default prompt when prompt is missing", () => {
  const body = buildChatBody({ model: "m" }, { kind: "dataUrl", dataUrl: "data:image/png;base64,AA==" });
  assert.match(body.messages[0].content[0].text, /Describe this image/);
});

// ---- Anthropic format ----

test("buildChatBody anthropic generates image source base64 block", () => {
  const body = buildChatBody(
    { model: "m", format: "anthropic" },
    { kind: "dataUrl", dataUrl: "data:image/png;base64,AA==" },
    "describe it"
  );
  assert.equal(body.model, "m");
  assert.equal(body.messages[0].content[0].text, "describe it");
  const img = body.messages[0].content[1];
  assert.equal(img.type, "image");
  assert.deepEqual(img.source, { type: "base64", media_type: "image/png", data: "AA==" });
});

test("buildChatBody anthropic uses image source url block for http(s) URL", () => {
  const body = buildChatBody({ model: "m", format: "anthropic" }, { kind: "url", url: "https://x/a.png" }, "describe it");
  const img = body.messages[0].content[1];
  assert.equal(img.type, "image");
  assert.deepEqual(img.source, { type: "url", url: "https://x/a.png" });
});

test("buildMultiImageBody anthropic generates multi-image source blocks", () => {
  const body = buildMultiImageBody(
    { model: "m", format: "anthropic" },
    [{ kind: "dataUrl", dataUrl: "data:image/jpeg;base64,/9j/" }],
    "compare"
  );
  assert.equal(body.messages[0].content[1].type, "image");
  assert.equal(body.messages[0].content[1].source.media_type, "image/jpeg");
});

test("callVision anthropic calls /v1/messages and parses content array", async () => {
  let seenUrl, seenHeaders;
  const fakeFetch = async (url, opts) => {
    seenUrl = url;
    seenHeaders = opts.headers;
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "recognition result" }] }) };
  };
  const text = await callVision(
    { baseUrl: "https://api.example.com/", apiKey: "k", model: "m", format: "anthropic" },
    { model: "m", messages: [] },
    { fetchImpl: fakeFetch }
  );
  assert.equal(text, "recognition result");
  assert.equal(seenUrl, "https://api.example.com/v1/messages");
  assert.equal(seenHeaders["x-api-key"], "k");
  assert.equal(seenHeaders["anthropic-version"], "2023-06-01");
});

test("callVision anthropic empty content throws error", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [] }) });
  await assert.rejects(
    () => callVision({ baseUrl: "https://x", apiKey: "k", model: "m", format: "anthropic" }, {}, { fetchImpl: fakeFetch }),
    VisionApiError
  );
});

test("configFromEnv reads VISION_API_FORMAT=anthropic", () => {
  const cfg = configFromEnv({
    VISION_API_BASE_URL: "https://x",
    VISION_API_KEY: "k",
    VISION_MODEL: "m",
    VISION_API_FORMAT: "anthropic",
  });
  assert.equal(cfg.format, "anthropic");
});

test("callVision returns text on success", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "recognition result" } }] }) });
  const text = await callVision({ baseUrl: "http://stub/v1/", apiKey: "k", model: "m" }, { model: "m", messages: [] }, { fetchImpl: fakeFetch });
  assert.equal(text, "recognition result");
});

test("callVision non-2xx passes through status code", async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
  await assert.rejects(
    () => callVision({ baseUrl: "http://stub", apiKey: "k", model: "m" }, {}, { fetchImpl: fakeFetch }),
    (e) => e instanceof VisionApiError && e.status === 429
  );
});

test("callVision timeout throws VisionTimeoutError", async () => {
  const fakeFetch = async (_url, opts) => {
    await new Promise((resolve, reject) => {
      const onAbort = () => { clearTimeout(t); reject(opts.signal.reason ?? new Error("aborted")); };
      const t = setTimeout(() => { opts.signal.removeEventListener("abort", onAbort); resolve(); }, 500);
      opts.signal.addEventListener("abort", onAbort);
    });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await assert.rejects(
    () => callVision({ baseUrl: "http://stub", apiKey: "k", model: "m" }, {}, { fetchImpl: fakeFetch, timeoutMs: 50 }),
    VisionTimeoutError
  );
});

test("callVision empty content throws error", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) });
  await assert.rejects(
    () => callVision({ baseUrl: "http://stub", apiKey: "k", model: "m" }, {}, { fetchImpl: fakeFetch }),
    VisionApiError
  );
});

test("callVision falls back to reasoning_content when content is null", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: null, reasoning_content: "thinking result" } }] }) });
  const text = await callVision({ baseUrl: "http://stub", apiKey: "k", model: "m" }, {}, { fetchImpl: fakeFetch });
  assert.equal(text, "thinking result");
});

test("analyzeImage URL passthrough failure (media error) retries by downloading to base64", async () => {
  let calls = 0;
  const fakeFetch = async (url, opts) => {
    calls++;
    if (calls === 1) {
      return { ok: false, status: 400, text: async () => '{"error":{"message":"failed to download or process media content"}}' };
    }
    if (calls === 2) {
      return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "retry success" } }] }) };
  };
  const text = await analyzeImage({ baseUrl: "http://stub", apiKey: "k", model: "m" }, "https://example.com/a.png", undefined, { fetchImpl: fakeFetch });
  assert.equal(text, "retry success");
  assert.equal(calls, 3);
});

test("analyzeImage URL passthrough failure (non-media error) does not retry", async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; return { ok: false, status: 401, text: async () => "unauthorized" }; };
  await assert.rejects(
    () => analyzeImage({ baseUrl: "http://stub", apiKey: "k", model: "m" }, "https://example.com/a.png", undefined, { fetchImpl: fakeFetch }),
    (e) => e instanceof VisionApiError && e.status === 401
  );
  assert.equal(calls, 1);
});

test("configFromEnv missing variables throws readable error", () => {
  assert.throws(() => configFromEnv({}), VisionInputError);
  assert.throws(() => configFromEnv({ VISION_API_BASE_URL: "x", VISION_API_KEY: "k" }), VisionInputError);
});

// ---- dataURL MIME validation ----

test("non-image MIME dataURL rejected", async () => {
  await assert.rejects(() => normalizeImageInput("data:text/plain;base64,AAAA"), VisionInputError);
});

test("dataURL without base64 encoding or empty payload rejected", async () => {
  await assert.rejects(() => normalizeImageInput("data:image/png"), VisionInputError);
  await assert.rejects(() => normalizeImageInput("data:image/png;base64,"), VisionInputError);
});

test("valid image MIME dataURL passes", async () => {
  const r = await normalizeImageInput("data:image/jpeg;base64,/9j/4AAQ");
  assert.equal(r.kind, "dataUrl");
  assert.equal(r.dataUrl, "data:image/jpeg;base64,/9j/4AAQ");
});

// ---- Response body reading covered by timeout ----

test("callVision response body reading is covered by timeout", async () => {
  let signal;
  const fakeFetch = async (_url, opts) => {
    signal = opts.signal;
    return {
      ok: true,
      status: 200,
      json: async () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    };
  };
  await assert.rejects(
    () => callVision({ baseUrl: "http://stub", apiKey: "k", model: "m" }, {}, { fetchImpl: fakeFetch, timeoutMs: 50 }),
    VisionTimeoutError
  );
});

test("callVision non-2xx error body reading is covered by timeout", async () => {
  let signal;
  const fakeFetch = async (_url, opts) => {
    signal = opts.signal;
    return {
      ok: false,
      status: 500,
      text: async () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    };
  };
  await assert.rejects(
    () => callVision({ baseUrl: "http://stub", apiKey: "k", model: "m" }, {}, { fetchImpl: fakeFetch, timeoutMs: 50 }),
    VisionTimeoutError
  );
});

test("downloadToDataUrl response body reading is covered by timeout", async () => {
  let signal;
  const fakeFetch = async (_url, opts) => {
    signal = opts.signal;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    };
  };
  await assert.rejects(
    () => downloadToDataUrl("https://example.com/a.png", { fetchImpl: fakeFetch, timeoutMs: 50 }),
    VisionTimeoutError
  );
});

// ---- Non-JSON response wrapping ----

test("callVision non-JSON response wrapped as VisionApiError (with status code)", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token < in JSON"); } });
  await assert.rejects(
    () => callVision({ baseUrl: "http://stub", apiKey: "k", model: "m" }, {}, { fetchImpl: fakeFetch }),
    (e) => e instanceof VisionApiError && e.status === 200 && /unparseable/i.test(e.message)
  );
});

// ---- Response body size limit ----

test("callVision response content-length exceeding limit throws error", async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    headers: { get: (k) => (k === "content-length" ? String(20 * 1024 * 1024) : null) },
    json: async () => ({}),
  });
  await assert.rejects(
    () => callVision({ baseUrl: "http://stub", apiKey: "k", model: "m" }, {}, { fetchImpl: fakeFetch }),
    /too large/i
  );
});

// ---- downloadToDataUrl ----

test("downloadToDataUrl converts to base64 (content-type takes priority)", async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    headers: { get: (k) => (k === "content-type" ? "image/webp" : null) },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  const r = await downloadToDataUrl("https://example.com/a.png", { fetchImpl: fakeFetch });
  assert.ok(r.startsWith("data:image/webp;base64,"));
});

test("downloadToDataUrl infers MIME from extension when no content-type", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new Uint8Array([1]).buffer });
  const r = await downloadToDataUrl("https://example.com/a.webp", { fetchImpl: fakeFetch });
  assert.ok(r.startsWith("data:image/webp;base64,"));
});

test("downloadToDataUrl content-length exceeding limit throws error", async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    headers: { get: (k) => (k === "content-length" ? String(30 * 1024 * 1024) : null) },
    arrayBuffer: async () => new Uint8Array([1]).buffer,
  });
  await assert.rejects(
    () => downloadToDataUrl("https://example.com/a.png", { fetchImpl: fakeFetch }),
    /content-length 31457280 bytes/
  );
});

test("downloadToDataUrl actual size exceeding limit throws error", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new Uint8Array(64).buffer });
  await assert.rejects(
    () => downloadToDataUrl("https://example.com/a.png", { fetchImpl: fakeFetch, maxBytes: 32 }),
    /actual 64 bytes/
  );
});

test("downloadToDataUrl HTTP non-2xx throws readable error", async () => {
  const fakeFetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    () => downloadToDataUrl("https://example.com/a.png", { fetchImpl: fakeFetch }),
    /HTTP 404/
  );
});

// ---- maxTokens ----

test("buildChatBody uses config.maxTokens", () => {
  const body = buildChatBody({ model: "m", maxTokens: 512 }, { kind: "dataUrl", dataUrl: "data:image/png;base64,AA==" });
  assert.equal(body.max_tokens, 512);
});

test("configFromEnv parses VISION_MAX_TOKENS, invalid or missing falls back to 2048", () => {
  const base = { VISION_API_BASE_URL: "x", VISION_API_KEY: "k", VISION_MODEL: "m" };
  assert.equal(configFromEnv({ ...base, VISION_MAX_TOKENS: "4096" }).maxTokens, 4096);
  assert.equal(configFromEnv({ ...base, VISION_MAX_TOKENS: "abc" }).maxTokens, 2048);
  assert.equal(configFromEnv({ ...base, VISION_MAX_TOKENS: "-1" }).maxTokens, 2048);
  assert.equal(configFromEnv(base).maxTokens, 2048);
});

// ---- clipboard ----

test("resolveClipboardRunner win32 uses powershell + clipboard.ps1", () => {
  const r = resolveClipboardRunner({ platform: "win32", scriptDir: "S", outFile: "O.png" });
  assert.equal(r.command, "powershell");
  assert.ok(r.args.some((a) => String(a).endsWith("clipboard.ps1")));
  assert.ok(r.args.includes("-OutFile"));
  assert.ok(r.args.includes("O.png"));
  assert.ok(r.args.includes("-Sta"));
});

test("resolveClipboardRunner darwin uses swift + clipboard.swift", () => {
  const r = resolveClipboardRunner({ platform: "darwin", scriptDir: "S", outFile: "O.png" });
  assert.equal(r.command, "/usr/bin/swift");
  assert.ok(r.args[0].endsWith("clipboard.swift"));
  assert.equal(r.args[1], "O.png");
});

test("resolveClipboardRunner unsupported platform returns null", () => {
  assert.equal(resolveClipboardRunner({ platform: "linux", scriptDir: "S" }), null);
});

test("readClipboardImage calls runner and writes OutFile as temp png path", async () => {
  let seen;
  const expected = path.join("T", "vision-clipboard-12345.png");
  const out = await readClipboardImage({
    platform: "win32",
    scriptDir: "S",
    tmpDir: "T",
    now: () => 12345,
    execFile: async (command, args) => {
      seen = { command, args };
    },
  });
  assert.equal(out, expected);
  assert.equal(seen.command, "powershell");
  assert.ok(seen.args.includes(expected));
});

test("readClipboardImage unsupported platform throws readable error", async () => {
  await assert.rejects(
    () => readClipboardImage({ platform: "linux", execFile: async () => {} }),
    (e) => e instanceof VisionInputError && /Clipboard/i.test(e.message) && /linux/.test(e.message)
  );
});

test("readClipboardImage runner failure wrapped as VisionInputError", async () => {
  await assert.rejects(
    () => readClipboardImage({
      platform: "win32",
      scriptDir: "/s",
      tmpDir: "/tmp",
      execFile: async () => { throw new Error("no image found in clipboard"); },
    }),
    (e) => e instanceof VisionInputError && /Clipboard read failed/i.test(e.message)
  );
});

test("normalizeImageInput clipboard keyword routes through clipboard and returns dataURL", async () => {
  const r = await normalizeImageInput("clipboard", {
    readClipboard: async () => "test/samples/sample.png",
  });
  assert.equal(r.kind, "dataUrl");
  assert.ok(r.dataUrl.startsWith("data:image/png;base64,"));
});

test("normalizeImageInput CLIPBOARD case-insensitive", async () => {
  const r = await normalizeImageInput("  CLIPBOARD  ", {
    readClipboard: async () => "test/samples/sample.png",
  });
  assert.equal(r.kind, "dataUrl");
});

test("normalizeImageInput clipboard read failure propagates VisionInputError", async () => {
  await assert.rejects(
    () => normalizeImageInput("clipboard", {
      readClipboard: async () => { throw new VisionInputError("Clipboard read failed: empty"); },
    }),
    (e) => e instanceof VisionInputError && /Clipboard read failed/i.test(e.message)
  );
});

test("analyzeImage clipboard input successfully recognizes image", async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: "clipboard image" } }] }),
  });
  const text = await analyzeImage(
    { baseUrl: "http://stub", apiKey: "k", model: "m" },
    "clipboard",
    undefined,
    { fetchImpl: fakeFetch, readClipboard: async () => "test/samples/sample.png" }
  );
  assert.equal(text, "clipboard image");
});

// ---- OCR ----

test("buildOcrPrompt plain contains extraction instructions", () => {
  const p = buildOcrPrompt("plain", "");
  assert.match(p, /Extract all text/i);
});

test("buildOcrPrompt carries language hints", () => {
  const p = buildOcrPrompt("markdown", "zh,en");
  assert.match(p, /Markdown/i);
  assert.match(p, /zh,en/);
});

test("buildOcrPrompt json contains structured instructions", () => {
  const p = buildOcrPrompt("json", "");
  assert.match(p, /"blocks"/);
});

test("ocrImage calls with detail=high and returns text", async () => {
  let seenBody;
  const fakeFetch = async (_url, opts) => {
    seenBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "OCR result" } }] }) };
  };
  const text = await ocrImage(
    { baseUrl: "http://stub", apiKey: "k", model: "m" },
    "data:image/png;base64,AAAA",
    { format: "markdown", fetchImpl: fakeFetch }
  );
  assert.equal(text, "OCR result");
  assert.equal(seenBody.messages[0].content[1].image_url.detail, "high");
  assert.equal(seenBody.max_tokens, 8192);
  assert.equal(seenBody.temperature, 0);
  assert.match(seenBody.messages[0].content[0].text, /Markdown/i);
});

test("ocrImage default format uses plain prompt", async () => {
  let seenBody;
  const fakeFetch = async (_url, opts) => {
    seenBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "x" } }] }) };
  };
  await ocrImage({ baseUrl: "http://stub", apiKey: "k", model: "m" }, "data:image/png;base64,AAAA", { fetchImpl: fakeFetch });
  assert.match(seenBody.messages[0].content[0].text, /Extract all text/i);
});

// ---- Multi-image comparison ----

test("buildMultiImageBody generates text + N image_url parts", () => {
  const body = buildMultiImageBody(
    { model: "m" },
    [
      { kind: "url", url: "https://x/a.png" },
      { kind: "dataUrl", dataUrl: "data:image/png;base64,AAAA" },
    ],
    "compare these",
    { detail: "auto" }
  );
  assert.equal(body.messages[0].content.length, 3);
  assert.equal(body.messages[0].content[0].text, "compare these");
  assert.equal(body.messages[0].content[1].image_url.url, "https://x/a.png");
  assert.equal(body.messages[0].content[1].image_url.detail, "auto");
  assert.equal(body.messages[0].content[2].image_url.url, "data:image/png;base64,AAAA");
});

test("compareImages returns text and sends multiple images", async () => {
  let seenBody;
  const fakeFetch = async (_url, opts) => {
    seenBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "differences: ..." } }] }) };
  };
  const text = await compareImages(
    { baseUrl: "http://stub", apiKey: "k", model: "m" },
    ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"],
    { fetchImpl: fakeFetch }
  );
  assert.equal(text, "differences: ...");
  assert.equal(seenBody.messages[0].content.length, 3);
  assert.match(seenBody.messages[0].content[0].text, /Compare these images/i);
});

test("compareImages fewer than 2 images throws readable error", async () => {
  await assert.rejects(
    () => compareImages({ baseUrl: "http://stub", apiKey: "k", model: "m" }, ["data:image/png;base64,AAAA"], {}),
    (e) => e instanceof VisionInputError && /2\u20134/.test(e.message)
  );
});

test("compareImages more than 4 images throws readable error", async () => {
  const five = ["1", "2", "3", "4", "5"].map((i) => `data:image/png;base64,${i}`);
  await assert.rejects(
    () => compareImages({ baseUrl: "http://stub", apiKey: "k", model: "m" }, five, {}),
    (e) => e instanceof VisionInputError && /2\u20134/.test(e.message)
  );
});

test("compareImages with URL and media failure downloads all URLs and retries once", async () => {
  let calls = 0;
  let secondBody;
  const fakeFetch = async (url, opts) => {
    calls++;
    if (calls === 1) {
      return { ok: false, status: 400, text: async () => '{"error":{"message":"failed to download or process media content"}}' };
    }
    if (calls === 2) {
      return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => new Uint8Array([9]).buffer };
    }
    secondBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "retry success" } }] }) };
  };
  const text = await compareImages(
    { baseUrl: "http://stub", apiKey: "k", model: "m" },
    ["https://example.com/a.png", "data:image/png;base64,AAAA"],
    { fetchImpl: fakeFetch }
  );
  assert.equal(text, "retry success");
  assert.equal(calls, 3);
  assert.ok(secondBody.messages[0].content[1].image_url.url.startsWith("data:image/png;base64,"));
  assert.equal(secondBody.messages[0].content[2].image_url.url, "data:image/png;base64,AAAA");
});
