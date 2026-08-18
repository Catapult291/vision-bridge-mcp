import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  analyzeImage, ocrImage, compareImages, configFromEnv,
  VisionInputError, VisionApiError, VisionTimeoutError,
} from "./lib/vision.js";

let config;
try {
  config = configFromEnv(process.env);
} catch (e) {
  console.error(`[vision-bridge] startup failed: ${e.message}`);
  process.exit(1);
}

const server = new McpServer({ name: "vision-bridge-mcp", version: "0.2.0" });

// Unified error wrapper: returns text on success, isError-marked text on failure
async function safeCall(fn) {
  try {
    const text = await fn();
    return { content: [{ type: "text", text }] };
  } catch (e) {
    const msgOf = (x) => (x instanceof Error ? x.message : String(x));
    const msg = e instanceof VisionInputError ? msgOf(e)
      : e instanceof VisionTimeoutError ? msgOf(e)
      : e instanceof VisionApiError ? msgOf(e)
      : `Internal vision error: ${msgOf(e)}`;
    return { content: [{ type: "text", text: `[vision_error] ${msg}` }], isError: true };
  }
}

server.registerTool(
  "analyze_image",
  {
    title: "Vision Bridge (for text-only host models)",
    description:
      "Send an image (local file path / http(s) URL / dataURL / clipboard) to a vision model for recognition, returning text results. " +
      "Only call this when the host model lacks multimodal vision capabilities; if the host model is already multimodal (e.g. gpt-4o / claude vision / gemini / grok), use its native image understanding instead. " +
      "Exception: when the system clipboard has an image and the conversation has no path/URL/attachment, even multimodal host models may pass image=\"clipboard\". " +
      "Text-only host models should use the returned result as image content without guessing.",
    inputSchema: {
      image: z.string().describe("Image input: local file path, http(s) URL, dataURL, or clipboard/clip/pasteboard to read system clipboard"),
      prompt: z.string().optional().describe("Custom recognition instruction (default: describe this image in detail)"),
    },
  },
  async ({ image, prompt }) => safeCall(() => analyzeImage(config, image, prompt))
);

server.registerTool(
  "ocr_image",
  {
    title: "Image OCR (extract text from image)",
    description:
      "Extract all text from an image using a vision model (OCR). Supports local path / http(s) URL / dataURL / clipboard. " +
      "`format` controls output: plain (plain text, preserves layout), markdown (preserves heading/list/table structure), json (structured blocks). " +
      "`languages` provides language hints (e.g. \"zh,en\") to improve multilingual character recognition accuracy.",
    inputSchema: {
      image: z.string().describe("Image input: local file path, http(s) URL, dataURL, or clipboard/clip/pasteboard to read system clipboard"),
      languages: z.string().optional().describe("Expected recognition language hints, e.g. 'zh,en' (optional)"),
      format: z.enum(["plain", "markdown", "json"]).optional().describe("Output format: plain / markdown / json (default: plain)"),
    },
  },
  async ({ image, languages, format }) => safeCall(() => ocrImage(config, image, { format, languages }))
);

server.registerTool(
  "compare_images",
  {
    title: "Image Comparison (2–4 images)",
    description:
      "Send 2–4 images to a vision model to compare differences and similarities. Supports local path / http(s) URL / dataURL / clipboard. " +
      "`prompt` customizes the comparison instruction (default: compare differences and similarities).",
    inputSchema: {
      images: z.array(z.string()).min(2).max(4).describe("2–4 images (local path / http(s) URL / dataURL / clipboard)"),
      prompt: z.string().optional().describe("Comparison instruction (default: compare differences and similarities)"),
    },
  },
  async ({ images, prompt }) => safeCall(() => compareImages(config, images, { prompt }))
);

const transport = new StdioServerTransport();
await server.connect(transport);
