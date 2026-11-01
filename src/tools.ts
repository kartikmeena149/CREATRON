// Small helpers for running the local tools (ffmpeg, ffprobe, whisper.cpp) and for working files.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");

export type RunResult = { stdout: string; stderr: string };

/** Runs a command and resolves with its output; rejects with the tail of stderr on failure. */
export function run(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
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
  const candidates = [
    process.env.CREATRON_WHISPER_MODEL,
    join(ROOT, "models", "ggml-small.en.bin"),
    join(homedir(), ".cache", "hyperframes", "whisper", "models", "ggml-small.en.bin"),
  ].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => existsSync(p));
  if (!found)
    throw new Error(
      "No Whisper model found. Download ggml-small.en.bin from https://huggingface.co/ggerganov/whisper.cpp " +
        "into models/, or set CREATRON_WHISPER_MODEL.",
    );
  return found;
}

export const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
