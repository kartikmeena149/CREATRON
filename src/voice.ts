// Voice Lab engine: a library of voices (built-in + cloned from a clip) and script-to-speech,
// all local with Kyutai Pocket TTS. The model runs as a small server we start on first use,
// so it loads once (~3 s per line instead of ~8 s with a fresh process each time).
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { SPEECH_LUFS } from "./loudness.ts";
import { ROOT, run } from "./tools.ts";

const POCKET_TTS =
  process.env.CREATRON_POCKET_TTS || "/Library/Frameworks/Python.framework/Versions/3.11/bin/pocket-tts";
const VOICES_DIR = join(ROOT, "voices");
const INDEX = join(VOICES_DIR, "voices.json");
const OUT_DIR = join(ROOT, "work", "voiceovers");

export const BUILT_IN_VOICES = [
  "alba", "anna", "vera", "fantine", "cosette", "eponine", "azelma", "mary", "jane", "eve", "caro_davy",
  "marius", "javert", "jean", "charles", "paul", "george", "michael", "bill_boerst", "peter_yearsley",
  "stuart_bell", "giovanni", "lola", "juergen", "rafael", "daan", "estelle",
];

export type Voice = { id: string; name: string; kind: "cloned" | "builtin"; file?: string; createdAt?: string };
type Stored = { id: string; name: string; file: string; createdAt: string; consent: true };

function readIndex(): Stored[] {
  return existsSync(INDEX) ? (JSON.parse(readFileSync(INDEX, "utf8")) as Stored[]) : [];
}
function writeIndex(list: Stored[]) {
  mkdirSync(VOICES_DIR, { recursive: true });
  writeFileSync(INDEX, JSON.stringify(list, null, 2));
}

export function listVoices(): Voice[] {
  const cloned = readIndex()
    .filter((v) => existsSync(v.file))
    .map((v) => ({ id: v.id, name: v.name, kind: "cloned" as const, file: v.file, createdAt: v.createdAt }));
  const builtin = BUILT_IN_VOICES.map((n) => ({ id: `builtin:${n}`, name: n.replace(/_/g, " "), kind: "builtin" as const }));
  return [...cloned, ...builtin];
}

/**
 * Makes a new voice from a stretch of any audio or video file: up to 25 s, mono 24 kHz
 * (what Pocket TTS clones from), rumble removed and levelled so quiet clips clone well.
 * Cloning someone needs their permission; the caller must pass consent.
 */
export async function cloneVoice(opts: { source: string; start: number; duration: number; name: string; consent: boolean }): Promise<Voice> {
  if (!opts.consent) throw new Error("Cloning needs confirmation that this is your voice or you have permission.");
  const name = opts.name.trim() || "My voice";
  const id = randomUUID().slice(0, 8);
  mkdirSync(VOICES_DIR, { recursive: true });
  const file = join(VOICES_DIR, `${id}.wav`);
  await run("ffmpeg", [
    "-y", "-v", "error", "-ss", String(Math.max(0, opts.start)), "-t", String(Math.min(25, Math.max(3, opts.duration))),
    "-i", opts.source, "-vn", "-ac", "1", "-ar", "24000",
    "-af", "highpass=f=70,loudnorm=I=-20:TP=-2", file,
  ]);
  writeIndex([...readIndex(), { id, name, file, createdAt: new Date().toISOString(), consent: true }]);
  return { id, name, kind: "cloned", file };
}

export function deleteVoice(id: string) {
  const list = readIndex();
  const v = list.find((x) => x.id === id);
  if (v) rmSync(v.file, { force: true });
  writeIndex(list.filter((x) => x.id !== id));
}

/** One-time import of the voice from the my-voiceover skill, so it shows up as "Kartik". */
export function importSkillVoice() {
  const ref = join(homedir(), ".claude", "skills", "my-voiceover", "voice_ref_K1.wav");
  const list = readIndex();
  if (!existsSync(ref) || list.some((v) => v.id === "kartik")) return;
  mkdirSync(VOICES_DIR, { recursive: true });
  const file = join(VOICES_DIR, "kartik.wav");
  writeFileSync(file, readFileSync(ref));
  writeIndex([{ id: "kartik", name: "Kartik (my voice)", file, createdAt: new Date().toISOString(), consent: true }, ...list]);
}

// ---- The Pocket TTS server -------------------------------------------------------------------

let server: { proc: ChildProcess; port: number; ready: Promise<void> } | undefined;

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
    s.on("error", fail);
  });
}

async function ensureServer(log: (m: string) => void): Promise<number> {
  if (server && server.proc.exitCode === null) {
    await server.ready;
    return server.port;
  }
  if (!existsSync(POCKET_TTS)) throw new Error(`Pocket TTS isn't installed (looked for ${POCKET_TTS}).`);
  await stopStaleVoiceEngine();
  const port = await freePort();
  log("starting the voice engine (first time takes a few seconds)");
  const proc = spawn(POCKET_TTS, ["serve", "--port", String(port), "--host", "127.0.0.1"], { stdio: "ignore" });
  const ready = (async () => {
    for (let i = 0; i < 240; i++) {
      if (proc.exitCode !== null) throw new Error("The voice engine stopped while starting. Check the Hugging Face login.");
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("The voice engine took too long to start.");
  })();
  server = { proc, port, ready };
  mkdirSync(join(ROOT, "work"), { recursive: true });
  writeFileSync(PID_FILE, String(proc.pid));
  await ready;
  return port;
}

const PID_FILE = join(ROOT, "work", "voice-engine.pid");

export function stopVoiceEngine() {
  server?.proc.kill();
  server = undefined;
  rmSync(PID_FILE, { force: true });
}

/**
 * Stops an engine left behind by an app that didn't shut down cleanly (crash, force quit).
 * Only kills the process if it really is our Pocket TTS server.
 */
export async function stopStaleVoiceEngine() {
  if (!existsSync(PID_FILE)) return;
  const pid = Number(readFileSync(PID_FILE, "utf8"));
  rmSync(PID_FILE, { force: true });
  if (!pid || pid === server?.proc.pid) return;
  try {
    const { stdout } = await run("ps", ["-p", String(pid), "-o", "command="]);
    if (stdout.includes("pocket-tts") && stdout.includes("serve")) process.kill(pid);
  } catch {} // not running any more
}

/** Splits a script into short pieces: one per line, long lines at sentence ends (avoids clipped endings). */
export function scriptChunks(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?]+[.!?]*["')\]]*\s*/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .reduce<string[]>((out, s) => {
      // Glue very short sentences to the previous one so the delivery doesn't sound choppy.
      if (out.length && (s.length < 25 || out.at(-1)!.length < 25) && out.at(-1)!.length + s.length < 180) out[out.length - 1] += ` ${s}`;
      else out.push(s);
      return out;
    }, []);
}

/** Speaks the script in the chosen voice and returns the finished wav (speed applied, pitch kept). */
export async function generateVoiceover(
  opts: { text: string; voiceId: string; speed: number },
  log: (m: string) => void = () => {},
): Promise<{ file: string; duration: number }> {
  const chunks = scriptChunks(opts.text);
  if (!chunks.length) throw new Error("The script is empty.");
  const voice = listVoices().find((v) => v.id === opts.voiceId);
  if (!voice) throw new Error("That voice no longer exists.");
  const port = await ensureServer(log);

  const id = randomUUID().slice(0, 8);
  const dir = join(OUT_DIR, id);
  mkdirSync(dir, { recursive: true });
  const parts: string[] = [];
  for (const [i, text] of chunks.entries()) {
    log(`speaking line ${i + 1} of ${chunks.length}`);
    const form = new FormData();
    form.append("text", text);
    if (voice.kind === "builtin") form.append("voice_url", voice.id.replace("builtin:", ""));
    else form.append("voice_wav", new Blob([readFileSync(voice.file!)], { type: "audio/wav" }), "voice.wav");
    const res = await fetch(`http://127.0.0.1:${port}/tts`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`voice engine error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const part = join(dir, `${String(i).padStart(3, "0")}.wav`);
    writeFileSync(part, Buffer.from(await res.arrayBuffer()));
    parts.push(part);
  }

  // Join with a short breath between lines, apply the speed (atempo keeps pitch), level it.
  log("finishing the voiceover");
  const file = join(OUT_DIR, `${id}.wav`);
  const inputs = parts.flatMap((p) => ["-i", p]);
  const gap = "anullsrc=r=24000:cl=mono";
  const filter =
    parts.map((_, i) => `[${i}:a]aresample=24000[p${i}]`).join(";") + ";" +
    parts.map((_, i) => `[p${i}]` + (i < parts.length - 1 ? `[g${i}]` : "")).join("") +
    `concat=n=${parts.length * 2 - 1}:v=0:a=1,atempo=${opts.speed},loudnorm=I=${SPEECH_LUFS}:TP=-2,aresample=48000[out]`;
  const gaps = parts.slice(0, -1).map((_, i) => `${gap},atrim=0:0.18[g${i}]`).join(";");
  await run("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", [gaps, filter].filter(Boolean).join(";"), "-map", "[out]", file]);
  rmSync(dir, { recursive: true, force: true });
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return { file, duration: Number(stdout.trim()) };
}
