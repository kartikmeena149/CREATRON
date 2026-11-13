// Small helpers for running the local tools (ffmpeg, ffprobe, whisper.cpp) and for working files.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { need, toolOf, whisperModelFile } from "./toolchain.ts";

// The app sets CREATRON_ROOT because its bundled code runs from out/, not src/.
export const ROOT = process.env.CREATRON_ROOT || resolve(import.meta.dirname, "..");

export type RunResult = { stdout: string; stderr: string };

/**
 * Runs a command and resolves with its output; rejects with the tail of stderr on failure.
 * A tool Creatron knows (ffmpeg, ffprobe, whisper-cli, yt-dlp, swiftc) is started through the
 * toolchain wall (toolchain.ts), which finds it or its backup; a missing one rejects in one line.
 */
export function run(cmd: string, args: string[], onStderr?: (chunk: string) => void, onStdout?: (chunk: string) => void): Promise<RunResult> {
  return new Promise((ok, fail) => {
    const tool = toolOf(cmd);
    let env: NodeJS.ProcessEnv | undefined;
    if (tool) {
      try {
        const found = need(tool);
        cmd = found.cmd;
        args = [...found.pre, ...args];
        if (found.env) env = { ...process.env, ...found.env };
      } catch (e) {
        return fail(e);
      }
    }
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      onStdout?.(String(d));
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      onStderr?.(String(d));
    });
    child.on("error", (e) => fail(new Error(`could not start ${cmd}: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) ok({ stdout, stderr });
      else fail(new Error(`${cmd} exited with ${code}\n${stderr.split("\n").slice(-15).join("\n")}`));
    });
  });
}

/** A per-video working folder, keyed by path, size and modified time so edits to the file bust the cache. */
export function workDir(video: string): string {
  const abs = resolve(video);
  const st = statSync(abs);
  const key = createHash("sha1").update(`${abs}:${st.size}:${st.mtimeMs}`).digest("hex").slice(0, 10);
  const slug = basename(abs, extname(abs)).replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40);
  const dir = join(ROOT, "work", `${slug}-${key}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function whisperModel(): string {
  const found = whisperModelFile();
  if (!found)
    throw new Error(
      "No Whisper model found. Download ggml-small.en.bin from https://huggingface.co/ggerganov/whisper.cpp " +
        "into models/, or set CREATRON_WHISPER_MODEL.",
    );
  return found.file;
}

export { round } from "./round.ts";
