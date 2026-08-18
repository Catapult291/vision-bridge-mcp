import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_URL = "data:image/png;base64,AAAA";

let stub, stubUrl, client, requests;

before(async () => {
  requests = [];
  // Local stub simulating a vision model's OpenAI-compatible API, recording requests for assertions
  stub = http.createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      if (raw.length < 1024 * 1024) raw += c; // 1MB limit, safety
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "bad json" }));
        return;
      }
      requests.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization ?? null,
        contentType: req.headers["content-type"] ?? null,
        body,
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: `recognized model=${body.model}` } }] }));
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  stubUrl = `http://127.0.0.1:${stub.address().port}/v1`;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["server.js"],
    cwd: serverDir,
    env: { ...process.env, VISION_API_BASE_URL: stubUrl, VISION_API_KEY: "test-key", VISION_MODEL: "stub-vl", VISION_CACHE_TTL: "0" },
  });
  client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(transport);
});

after(async () => {
  await client.close();
  await new Promise((r) => stub.close(r));
});

test("tools/list exposes analyze_image", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("analyze_image"), `tools = ${names.join(", ")}`);
});

test("analyze_image carries auth/body to stub, exact assertions on success path", async () => {
  const r = await client.callTool({
    name: "analyze_image",
    arguments: { image: DATA_URL },
  });

  // Success path: no isError, text matches exactly
  assert.equal(r.isError, undefined, "success path should not mark isError");
  assert.equal(r.content[0].text, "recognized model=stub-vl");

  // What the stub actually received: method / path / auth / Content-Type / dataURL in body
  assert.equal(requests.length, 1, "should make exactly one API request");
  const { method, url, auth, contentType, body } = requests[0];
  assert.equal(method, "POST");
  assert.equal(url, "/v1/chat/completions");
  assert.equal(auth, "Bearer test-key");
  assert.match(contentType ?? "", /^application\/json/);
  assert.equal(body.model, "stub-vl");
  assert.equal(body.messages[0].content[1].type, "image_url");
  assert.equal(body.messages[0].content[1].image_url.url, DATA_URL);
});

test("analyze_image with non-existent path returns readable error and makes no API request", async () => {
  const r = await client.callTool({
    name: "analyze_image",
    arguments: { image: "test/samples/nope.png" },
  });
  assert.equal(r.isError, true);
  assert.ok(r.content[0].text.includes("[vision_error]"), r.content[0].text);
  assert.ok(r.content[0].text.includes("Cannot read image file"), r.content[0].text);
  assert.equal(requests.length, 1, "input normalization failure should not make API request");
});

test("analyze_image with invalid dataURL returns readable error and makes no API request", async () => {
  const r = await client.callTool({
    name: "analyze_image",
    arguments: { image: "data:text/plain;base64,AAAA" },
  });
  assert.equal(r.isError, true);
  assert.ok(r.content[0].text.includes("[vision_error]"), r.content[0].text);
  assert.ok(r.content[0].text.includes("Invalid dataURL"), r.content[0].text);
  assert.equal(requests.length, 1, "invalid dataURL should not make API request");
});

test("analyze_image tool description declares clipboard and multimodal routing", async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === "analyze_image");
  assert.ok(tool, "should expose analyze_image");
  assert.match(tool.description ?? "", /clipboard/i);
  assert.match(tool.description ?? "", /multimodal|text-only|vision/i);
});

test("tools/list exposes ocr_image and compare_images", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("ocr_image"), `tools = ${names.join(", ")}`);
  assert.ok(names.includes("compare_images"), `tools = ${names.join(", ")}`);
  const ocr = tools.find((t) => t.name === "ocr_image");
  assert.match(ocr.description ?? "", /OCR/i);
  const cmp = tools.find((t) => t.name === "compare_images");
  assert.match(cmp.description ?? "", /2\u20134|2-4|differences|similarities/i);
});
