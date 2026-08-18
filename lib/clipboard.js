import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { VisionInputError } from "./errors.js";

const execFileDefault = promisify(execFileCb);
const DEFAULT_SCRIPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");

const msgOf = (e) => (e instanceof Error ? e.message : String(e));

/**
 * Resolve platform-specific clipboard runner.
 * @returns {{ command: string, args: string[] } | null}
 */
export function resolveClipboardRunner({
  platform = process.platform,
  scriptDir = DEFAULT_SCRIPT_DIR,
  outFile,
} = {}) {
  if (platform === "win32") {
    return {
      command: "powershell",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(scriptDir, "clipboard.ps1"),
        "-OutFile",
        outFile,
      ],
    };
  }
  if (platform === "darwin") {
    return {
      command: "/usr/bin/swift",
      args: [path.join(scriptDir, "clipboard.swift"), outFile],
    };
  }
  return null;
}

/**
 * Read current system clipboard image to a temp PNG path.
 * Inject execFile/platform/tmpDir for unit tests.
 */
export async function readClipboardImage({
  platform = process.platform,
  scriptDir = DEFAULT_SCRIPT_DIR,
  tmpDir = os.tmpdir(),
  now = Date.now,
  execFile = execFileDefault,
} = {}) {
  const outFile = path.join(tmpDir, `vision-clipboard-${now()}.png`);
  const runner = resolveClipboardRunner({ platform, scriptDir, outFile });
  if (!runner) {
    throw new VisionInputError(
      `Clipboard reading is not supported on this platform: ${platform} (supported: win32 / darwin)`
    );
  }
  try {
    await execFile(runner.command, runner.args, {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
  } catch (e) {
    const detail = (e && (e.stderr || e.stdout)) ? String(e.stderr || e.stdout).trim() : msgOf(e);
    throw new VisionInputError(`Clipboard read failed: ${detail || msgOf(e)}`);
  }
  return outFile;
}
