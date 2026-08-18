/**
 * Cache module — optional SHA256 file cache.
 *
 * Caches vision API results for identical "image + prompt" combinations
 * to avoid redundant calls and save tokens / API costs.
 * Adapted from kitlau86/agent-vision-mcp (ported to ESM with parameterized TTL).
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Default cache TTL: 1 hour */
export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Compute cache key: SHA256(image + "::" + prompt)
 * image is the normalized image identifier (http(s) URL or base64 dataURL).
 */
export function computeCacheKey(imageData, prompt) {
  const hash = createHash("sha256");
  hash.update(imageData);
  hash.update("::");
  hash.update(prompt ?? "");
  return hash.digest("hex");
}

/**
 * Try to read a cached result.
 * @returns The result string on hit; null on miss or expiry (expired entries are auto-cleaned).
 */
export async function getCachedResult(cacheKey, cacheDir, ttlMs = DEFAULT_CACHE_TTL_MS) {
  const filePath = join(cacheDir, `${cacheKey}.json`);
  try {
    const raw = await readFile(filePath, "utf-8");
    const entry = JSON.parse(raw);
    if (typeof entry?.result !== "string" || typeof entry?.cachedAt !== "number") {
      return null;
    }
    if (Date.now() - entry.cachedAt > ttlMs) {
      await unlink(filePath).catch(() => {});
      return null;
    }
    return entry.result;
  } catch {
    // File missing / JSON corrupted / permission error → cache miss
    return null;
  }
}

/**
 * Write a result to cache (auto-creates directory).
 */
export async function setCachedResult(cacheKey, result, cacheDir) {
  if (!existsSync(cacheDir)) {
    await mkdir(cacheDir, { recursive: true });
  }
  const entry = { result, cachedAt: Date.now() };
  await writeFile(join(cacheDir, `${cacheKey}.json`), JSON.stringify(entry), "utf-8");
}
