#!/usr/bin/env node
// The Auto Edit agent's tool belt: the one command Claude may run outside its sandbox, because
// Remotion's Chrome and the downloads can't work inside it. Claude can't change this file (its
// file tools and sandbox only reach its own folder), and everything here reads and writes only
// that folder (CREATRON_AUTOEDIT_DIR, set by Creatron, never the shell's cwd). B-roll goes through
// the app (CREATRON_BROKER), which holds the API keys: they never reach this folder or Claude.
//
//   node autoedit-tools.ts stage <name>                  tell Creatron which step you're on
//   node autoedit-tools.ts cut keep.json                 keep these source ranges -> public/cut.mp4 + cut-words.json
//   node autoedit-tools.ts still <seconds> <name.png>    one frame of the Remotion video -> checks/<name.png>
//   node autoedit-tools.ts cutout [public/cut.mp4]      the speaker without background -> public/cutout.webm (see-through)
//   node autoedit-tools.ts render                        render src/index.ts "Main" -> out/final.mp4 at -14 LUFS
//   node autoedit-tools.ts check                         loudness, peaks, clipping and frames of out/final.mp4
//   node autoedit-tools.ts broll search "<words>" [--landscape|--portrait|--web]
//   node autoedit-tools.ts broll get <id> <name> [--from s --to s | --find "what it must show"] [--audio]
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { levelFilter, TARGET_LUFS } from "./loudness.ts";
import { chromeOutsideProtectedFolders } from "./remotion.ts";
import type { Word } from "./schema.ts";
import { ROOT, round, run } from "./tools.ts";

const DIR = process.env.CREATRON_AUTOEDIT_DIR;
if (!DIR || !existsSync(join(DIR, "autoedit.json"))) fail("run this from Creatron's Auto Edit (CREATRON_AUTOEDIT_DIR is not set)");
const config = JSON.parse(readFileSync(join(DIR, "autoedit.json"), "utf8")) as { source: string; media: string; fps: number; hasVideo: boolean };

/** A path inside the folder, from a name the agent gave. Anything pointing outside is refused. */
function inside(...parts: string[]): string {
  const p = resolve(DIR!, ...parts);
  if (relative(DIR!, p).startsWith("..")) fail(`${parts.join("/")} is outside the project folder`);
  return p;
}
const safeName = (name: string) => basename(name).replace(/[^\w.-]+/g, "-");

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "stage") console.log(`ok, stage: ${args[0] ?? "?"}`);
else if (cmd === "cut") await cut(args[0] ?? fail("usage: cut keep.json"));
else if (cmd === "still") await still(Number(args[0]), args[1] ?? fail("usage: still <seconds> <name.png>"));
else if (cmd === "render") await renderFinal();
else if (cmd === "cutout") await cutout(inside(args[0] ?? "public/cut.mp4"));
else if (cmd === "check") await check(inside(args[0] ?? "out/final.mp4"));
else if (cmd === "broll" && (args[0] === "search" || args[0] === "get")) await broker(args[0], args.slice(1));
else fail(`unknown command "${[cmd, ...args].join(" ")}". Commands: stage, cut, still, render, check, broll search, broll get`);

/** Keeps the given source ranges, joined with 10 ms audio fades, and times every word on the cut. */
async function cut(keepFile: string) {
  const raw = JSON.parse(readFileSync(inside(keepFile), "utf8"));
  const keep: [number, number][] = (Array.isArray(raw) ? raw : raw.keep).map((r: any) => (Array.isArray(r) ? [r[0], r[1]] : [r.start, r.end]));
  if (!keep.length || keep.some(([s, e]) => !(e > s) || s < 0)) fail("keep.json must be a list of [start, end] source seconds with end > start");
  const video = config.hasVideo;
  const filters: string[] = [];
  keep.forEach(([s, e], i) => {
    const fade = Math.max(e - s - 0.01, 0).toFixed(3);
    if (video) filters.push(`[0:v]trim=${s}:${e},setpts=PTS-STARTPTS[v${i}]`);
    filters.push(`[0:a]atrim=${s}:${e},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=${fade}:d=0.01[a${i}]`);
  });
  const pads = keep.map((_, i) => `${video ? `[v${i}]` : ""}[a${i}]`).join("");
  filters.push(`${pads}concat=n=${keep.length}:v=${video ? 1 : 0}:a=1${video ? "[v]" : ""}[a]`);
  const out = inside(video ? "public/cut.mp4" : "public/cut.m4a");
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", config.media, "-filter_complex", filters.join(";"),
    ...(video ? ["-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", "-r", String(config.fps)] : []),
    "-map", "[a]", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", out,
  ]);
  // Words on the new timeline: a word kept if its middle falls in a kept range.
  const words = JSON.parse(readFileSync(inside("transcript.json"), "utf8")).words as Word[];
  const cutWords: Word[] = [];
  let offset = 0;
  for (const [s, e] of keep) {
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid >= s && mid < e) cutWords.push({ text: w.text, start: round(Math.max(w.start, s) - s + offset, 3), end: round(Math.min(w.end, e) - s + offset, 3) });
    }
    offset += e - s;
  }
  writeFileSync(inside("cut-words.json"), JSON.stringify({ note: "word timings in seconds of public/cut file", duration: round(offset, 3), words: cutWords }, null, 1));
  console.log(`${relative(DIR!, out)}: ${round(offset, 2)} s from ${keep.length} parts. cut-words.json: ${cutWords.length} words.`);
}

async function remotion() {
  const serveUrl = await bundle({ entryPoint: inside("src/index.ts"), rootDir: DIR!, publicDir: inside("public") });
  const browser = await ensureBrowser();
  if (!("path" in browser)) fail("couldn't get Remotion's browser");
  const browserExecutable = chromeOutsideProtectedFolders(browser.path);
  const composition = await selectComposition({ serveUrl, id: "Main", browserExecutable });
  return { serveUrl, browserExecutable, composition };
}

async function still(seconds: number, name: string) {
  if (!Number.isFinite(seconds)) fail("usage: still <seconds> <name.png>");
  const { serveUrl, browserExecutable, composition } = await remotion();
  const frame = Math.min(Math.round(seconds * composition.fps), composition.durationInFrames - 1);
  mkdirSync(inside("checks"), { recursive: true });
  const out = inside("checks", safeName(name.endsWith(".png") ? name : `${name}.png`));
  await renderStill({ composition, serveUrl, frame, output: out, imageFormat: "png", browserExecutable, overwrite: true });
  console.log(`${relative(DIR!, out)} (frame ${frame}). Read it to look at it.`);
}

async function renderFinal() {
  const { serveUrl, browserExecutable, composition } = await remotion();
  mkdirSync(inside("out"), { recursive: true });
  const raw = inside("out/raw.mp4");
  const progress = inside(".render-progress");
  let last = 0;
  await renderMedia({
    composition, serveUrl, codec: "h264", crf: 18, outputLocation: raw, browserExecutable, concurrency: cpus().length,
    audioBitrate: "256k", overwrite: true,
    onProgress: ({ progress: p }) => {
      if (p - last >= 0.01 || p === 1) writeFileSync(progress, String((last = p)));
    },
  });
  console.log(`rendered ${composition.width}x${composition.height}, ${round(composition.durationInFrames / composition.fps, 2)} s`);
  await master(raw, inside("out/final.mp4"));
  rmSync(raw, { force: true });
  rmSync(progress, { force: true });
  await check(inside("out/final.mp4"));
}

/** Loudness of a file's audio: integrated LUFS and true peak. */
async function loudness(file: string, chain = "") {
  const { stderr } = await run("ffmpeg", ["-v", "info", "-nostats", "-i", file, "-vn", "-af", `${chain ? `${chain},` : ""}ebur128=peak=true`, "-f", "null", "-"]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  return { lufs: Number(summary.match(/I:\s+(-?[\d.]+|-inf) LUFS/)?.[1]), peak: Number(summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/)?.[1]) };
}

/** Same picture, audio taken to -14 LUFS with peaks caught by a limiter (corrected for what it takes). */
async function master(input: string, out: string) {
  const before = await loudness(input);
  if (!Number.isFinite(before.lufs)) return void copyFileSync(input, out);
  let gain = TARGET_LUFS - before.lufs;
  for (let pass = 0; pass < 4; pass++) {
    const now = (await loudness(input, levelFilter(gain))).lufs;
    if (!Number.isFinite(now) || Math.abs(TARGET_LUFS - now) <= 0.2) break;
    gain += TARGET_LUFS - now;
  }
  const part = `${out}.part.mp4`;
  const encode = (g: number) =>
    run("ffmpeg", ["-y", "-v", "error", "-i", input, "-c:v", "copy", "-af", levelFilter(g), "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", part]);
  await encode(gain);
  // AAC can push peaks back over the limiter's ceiling: give up a little loudness to stay under -1 dBTP.
  const { peak } = await loudness(part);
  if (peak > -1) await encode((gain -= peak + 1.2));
  renameSync(part, out);
  console.log(`audio levelled: ${before.lufs} LUFS -> target ${TARGET_LUFS} (gain ${round(gain, 1)} dB)`);
}

/** What a viewer gets: length, loudness, peaks, clipping, and a sheet of frames to look at. */
async function check(file: string) {
  if (!existsSync(file)) fail(`${relative(DIR!, file)} doesn't exist yet`);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]);
  const info = JSON.parse(stdout);
  const duration = Number(info.format.duration);
  const v = info.streams.find((s: any) => s.codec_type === "video");
  const l = await loudness(file);
  const { stderr } = await run("ffmpeg", ["-v", "info", "-nostats", "-i", file, "-vn", "-af", "astats=measure_overall=Peak_level+Number_of_samples:measure_perchannel=none", "-f", "null", "-"]);
  const peakDb = Number(stderr.match(/Peak level dB:\s*(-?[\d.]+|-inf)/)?.[1]);
  const { stderr: clipErr } = await run("ffmpeg", ["-v", "info", "-nostats", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"]);
  const atMax = Number(clipErr.match(/histogram_0db:\s*(\d+)/)?.[1] ?? 0);
  mkdirSync(inside("checks"), { recursive: true });
  const every = Math.max(1, duration / 12);
  await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-vf", `fps=1/${every.toFixed(3)},scale=-2:480,tile=6x2:padding=6:color=white`, "-frames:v", "1", inside("checks/sheet.jpg")]);
  console.log(
    [
      `${relative(DIR!, file)}: ${v ? `${v.width}x${v.height}, ` : ""}${round(duration, 2)} s`,
      `loudness ${l.lufs} LUFS (target ${TARGET_LUFS}), true peak ${l.peak} dBFS, sample peak ${peakDb} dB, samples at 0 dB (clipped): ${atMax}`,
      `checks/sheet.jpg: 12 frames, one every ${round(every, 2)} s (left to right, top to bottom). Read it to look.`,
    ].join("\n"),
  );
}

/** B-roll search and download happen in Creatron itself (it has the keys); this just asks it. */
async function broker(what: string, rest: string[]) {
  const url = process.env.CREATRON_BROKER ?? fail("Creatron isn't listening for B-roll requests");
  const res = await fetch(`${url}/broll/${what}`, { method: "POST", body: JSON.stringify({ args: rest }) }).catch((e) => fail(`couldn't reach Creatron: ${e.message}`));
  const text = await res.text();
  if (!res.ok) fail(text);
  console.log(text);
}

/**
 * The person cut out of their background, as a see-through video with the same timing as the input
 * (Apple Vision person segmentation, on this Mac). The helper is compiled once from tools/person-mask.swift.
 */
async function cutout(input: string) {
  if (!existsSync(input)) fail(`${relative(DIR!, input)} doesn't exist (run cut first)`);
  const helper = join(homedir(), "Library", "Caches", "Creatron", "person-mask");
  if (!existsSync(helper)) {
    console.error("building the person-mask helper (once, about a minute)");
    mkdirSync(join(homedir(), "Library", "Caches", "Creatron"), { recursive: true });
    await run("swiftc", ["-O", join(ROOT, "tools", "person-mask.swift"), "-o", helper]);
  }
  const work = inside(".cache", "cutout");
  mkdirSync(work, { recursive: true });
  // Vision works at any size; 1920 tall is plenty and keeps it quick.
  const small = join(work, "in.mp4");
  await run("ffmpeg", ["-y", "-v", "error", "-i", input, "-vf", "scale=-2:'min(1920,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-an", small]);
  const mask = join(work, "mask.mp4");
  await run(helper, [small, mask]);
  const out = inside("public", "cutout.webm");
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", small, "-i", mask,
    "-filter_complex", "[1:v]format=gray[m];[0:v][m]alphamerge,format=yuva420p",
    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-b:v", "6M", "-an", out,
  ]);
  rmSync(work, { recursive: true, force: true });
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "csv=p=0", out]);
  console.log(`public/cutout.webm (${stdout.trim().replace(/\n/g, ", ")}): the speaker with a see-through background, same timing as ${relative(DIR!, input)}.`);
  console.log('Use <OffthreadVideo src={staticFile("cutout.webm")} transparent muted /> and keep playing the sound from the cut.');
}
