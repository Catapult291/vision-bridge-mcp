import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  computeCacheKey, getCachedResult, setCachedResult, DEFAULT_CACHE_TTL_MS,
} from "../lib/cache.js";
import { analyzeImage } from "../lib/vision.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "vision-cache-"));

test("computeCacheKey is stable for same input, different for different input", () => {
  const k1 = computeCacheKey("data:image/png;base64,AAAA", "describe it");
  const k2 = computeCacheKey("data:image/png;base64,AAAA", "describe it");
  assert.equal(k1, k2);
  assert.notEqual(computeCacheKey("data:image/png;base64,AAAB", "describe it"), k1);
  assert.notEqual(computeCacheKey("data:image/png;base64,AAAA", "extract text"), k1);
});

test("setCachedResult then getCachedResult hits", async () => {
  const dir = await tmp();
  try {
    const key = computeCacheKey("img", "p");
    await setCachedResult(key, "result", dir);
    assert.equal(await getCachedResult(key, dir), "result");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getCachedResult returns null on miss", async () => {
  const dir = await tmp();
  try {
    assert.equal(await getCachedResult(computeCacheKey("x", "y"), dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getCachedResult returns null on expiry and cleans up file", async () => {
  const dir = await tmp();
  try {
    const key = computeCacheKey("img", "p");
    await setCachedResult(key, "result", dir);
    assert.equal(await getCachedResult(key, dir, -1), null); // ttlMs<0 → expired
    await assert.rejects(() => readFile(path.join(dir, `${key}.json`)), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getCachedResult returns null on corrupted JSON", async () => {
  const dir = await tmp();
  try {
    const key = computeCacheKey("img", "p");
    await writeFile(path.join(dir, `${key}.json`), "{not json", "utf-8");
    assert.equal(await getCachedResult(key, dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("analyzeImage second call with same input hits cache, no API call", async () => {
  const dir = await tmp();
  try {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "recognition result" } }] }) };
    };
    const config = { baseUrl: "http://stub", apiKey: "k", model: "m", cache: { dir, ttlMs: DEFAULT_CACHE_TTL_MS } };
    const img = "data:image/png;base64,AAAA";
    assert.equal(await analyzeImage(config, img, "describe it", { fetchImpl: fakeFetch }), "recognition result");
    assert.equal(calls, 1);
    assert.equal(await analyzeImage(config, img, "describe it", { fetchImpl: fakeFetch }), "recognition result");
    assert.equal(calls, 1, "second call should hit cache, no API request");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("analyzeImage different prompt does not share cache", async () => {
  const dir = await tmp();
  try {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "recognition result" } }] }) };
    };
    const config = { baseUrl: "http://stub", apiKey: "k", model: "m", cache: { dir, ttlMs: DEFAULT_CACHE_TTL_MS } };
    const img = "data:image/png;base64,AAAA";
    await analyzeImage(config, img, "describe it", { fetchImpl: fakeFetch });
    await analyzeImage(config, img, "extract text", { fetchImpl: fakeFetch });
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("analyzeImage without cache config does not cache (backward compatible)", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "recognition result" } }] }) };
  };
  const config = { baseUrl: "http://stub", apiKey: "k", model: "m" }; // no cache
  const img = "data:image/png;base64,AAAA";
  await analyzeImage(config, img, undefined, { fetchImpl: fakeFetch });
  await analyzeImage(config, img, undefined, { fetchImpl: fakeFetch });
  assert.equal(calls, 2, "without cache config, every call should hit the API");
});
