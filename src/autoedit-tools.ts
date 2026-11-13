#!/usr/bin/env node
// The project tool belt: the commands that turn an editable project (src/project.ts) into
// pictures and a finished file. Auto Edit's AI runs it (it is the one command allowed outside
// its sandbox, because Remotion's Chrome and the downloads can't work inside it), and so does a
// person: `creatron project render <folder>` and the project's render.command call this file.
// The AI can't change this file (its file tools and sandbox only reach its own folder), and
// everything here reads and writes only that folder (CREATRON_AUTOEDIT_DIR, never the shell's cwd).
// B-roll goes through the app (CREATRON_BROKER), which holds the API keys.
// Every tool is started through the toolchain wall (toolchain.ts): a missing one is said in one
// line with what to do instead, never a crash that ends the job.
//
//   node autoedit-tools.ts tools                         which tools work now and what each job uses
//   node autoedit-tools.ts stage <name>                  tell Creatro which step you're on
//   node autoedit-tools.ts cut keep.json                 keep these source ranges -> "cuts" + "captions" in project/timeline.json
//   node autoedit-tools.ts still <seconds> <name.png>    one frame of the video -> notes/checks/<name.png>
//   node autoedit-tools.ts cutout                        the speaker without background -> assets/cutouts/speaker.webm
//   node autoedit-tools.ts render [draft]                render the project -> Export/<Name>.mp4 at -14 LUFS
//   node autoedit-tools.ts check                         is it still editable? + loudness, peaks, frames of the export
//   node autoedit-tools.ts broll search "<words>" [--landscape|--portrait|--web]
//   node autoedit-tools.ts broll get <id> <name> [--from s --to s | --find "what it must show"] [--audio]
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { levelFilter, TARGET_LUFS } from "./loudness.ts";
import { type Cut, captionPages, finalFile, projectPaths, readTimeline, validateProject, writeTimeline } from "./project.ts";
import { chromeOutsideProtectedFolders } from "./remotion.ts";
import type { Word } from "./schema.ts";
import { FALLBACK, find, healthReport } from "./toolchain.ts";
import { ROOT, round, run } from "./tools.ts";

const DIR = process.env.CREATRON_AUTOEDIT_DIR;
if (!DIR || !existsSync(projectPaths(DIR).timeline)) fail("this isn't a Creatro project folder (no project/timeline.json). Set CREATRON_AUTOEDIT_DIR, or use: creatron project <command> <folder>");
const P = projectPaths(DIR);
const config = readTimeline(DIR);
/** The original recording (source/...). Read, never written. */
const SOURCE = join(DIR, config.source);

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
else if (cmd === "tools") console.log(healthReport());
else if (cmd === "cut") await cut(args[0] ?? fail("usage: cut keep.json"));
else if (cmd === "still") await still(Number(args[0]), args[1] ?? fail("usage: still <seconds> <name.png>"));
else if (cmd === "render") await renderFinal(args[0] === "draft");
else if (cmd === "cutout") await cutout();
else if (cmd === "check") await check(args[0] ? inside(args[0]) : finalFile(DIR, config.name));
else if (cmd === "broll" && (args[0] === "search" || args[0] === "get")) await broker(args[0], args.slice(1));
else fail(`unknown command "${[cmd, ...args].join(" ")}". Commands: tools, stage, cut, still, cutout, render, check, broll search, broll get`);

/**
 * Keeps the given source ranges. Nothing is cut into a file: the ranges become "cuts" in
 * project/timeline.json (the Footage component plays the source through them), and the words
 * inside them become "captions" there, as live text timed to the source.
 */
async function cut(keepFile: string) {
  const raw = JSON.parse(readFileSync(inside(keepFile), "utf8"));
  const keep: [number, number][] = (Array.isArray(raw) ? raw : raw.keep).map((r: any) => (Array.isArray(r) ? [r[0], r[1]] : [r.start, r.end]));
  if (!keep.length || keep.some(([s, e]) => !(e > s) || s < 0)) fail("keep.json must be a list of [start, end] source seconds with end > start");
  const cuts: Cut[] = keep.map(([s, e]) => ({ start: round(s, 3), end: round(e, 3) }));
  const transcript = join(P.notes, "transcript.json");
  const words = existsSync(transcript) ? ((JSON.parse(readFileSync(transcript, "utf8")).words as Word[]) ?? []) : [];
  const timeline = readTimeline(DIR!);
  timeline.cuts = cuts;
  timeline.captions = captionPages(words, cuts);
  if (timeline.cutout && !cuts.every((c) => timeline.cutout!.ranges.some(([s, e]) => c.start >= s && c.end <= e))) console.log("note: the speaker cutout no longer covers every cut. Run cutout again if you use it.");
  writeTimeline(DIR!, timeline);
  // For planning: every kept word on the OUTPUT timeline (derived, rewritten by every cut; not a source of truth).
  const cutWords: Word[] = [];
  let offset = 0;
  for (const { start: s, end: e } of cuts) {
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid >= s && mid < e) cutWords.push({ text: w.text, start: round(Math.max(w.start, s) - s + offset, 3), end: round(Math.min(w.end, e) - s + offset, 3) });
    }
    offset += e - s;
  }
  writeFileSync(join(P.notes, "cut-words.json"), JSON.stringify({ note: "derived from project/timeline.json cuts: word timings in seconds of the FINISHED video. Edit timeline.json, not this.", duration: round(offset, 3), words: cutWords }, null, 1));
  console.log(`project/timeline.json: ${cuts.length} cuts, ${round(offset, 2)} s, ${timeline.captions.length} caption pages (live text, source times). notes/cut-words.json: ${cutWords.length} words on the finished video's timeline.`);
}

/** Which engine the project is built with: Remotion code, or (the fallback) a HyperFrames page. */
function engine(): "remotion" | "hyperframes" {
  return existsSync(P.entry) ? "remotion" : existsSync(P.html) ? "hyperframes" : fail("there is no video to render yet: write project/src/index.ts (Remotion) or project/index.html (HyperFrames)");
}

/** The HyperFrames CLI on this project, through the wall. */
function hyperframes(args: string[]) {
  const hf = find("hyperframes") ?? fail(`HyperFrames isn't working on this Mac. ${FALLBACK.hyperframes.without}.`);
  return run(hf.cmd, [...hf.pre, ...args, join(DIR!, "project")]);
}

async function remotion() {
  if (!find("remotion")) fail(`Remotion isn't working. ${FALLBACK.remotion.without}.`);
  const serveUrl = await bundle({
    entryPoint: P.entry,
    rootDir: join(DIR!, "project"),
    publicDir: P.public,
    symlinkPublicDir: true, // source/ and assets/ are played where they are, never copied
    // The project uses Creatro's own Remotion and React, wherever the folder lives.
    webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, modules: [join(ROOT, "node_modules"), "node_modules"] } }),
  });
  const browser = await ensureBrowser();
  if (!("path" in browser)) fail("couldn't get Remotion's browser");
  const browserExecutable = chromeOutsideProtectedFolders(browser.path);
  const composition = await selectComposition({ serveUrl, id: "Main", browserExecutable });
  return { serveUrl, browserExecutable, composition };
}

async function still(seconds: number, name: string) {
  if (!Number.isFinite(seconds)) fail("usage: still <seconds> <name.png>");
  mkdirSync(P.checks, { recursive: true });
  const out = join(P.checks, safeName(name.endsWith(".png") ? name : `${name}.png`));
  if (engine() === "hyperframes") {
    const { stdout } = await hyperframes(["snapshot", "--at", String(seconds)]);
    const made = stdout.match(/(\S+frame-00[^\s]*\.png)/)?.[1];
    if (!made) fail(`HyperFrames made no frame:\n${stdout.slice(-400)}`);
    copyFileSync(made.startsWith("/") ? made : join(DIR!, "project", made), out);
    return console.log(`${relative(DIR!, out)}. Read it to look at it.`);
  }
  const { serveUrl, browserExecutable, composition } = await remotion();
  const frame = Math.min(Math.round(seconds * composition.fps), composition.durationInFrames - 1);
  await renderStill({ composition, serveUrl, frame, output: out, imageFormat: "png", browserExecutable, overwrite: true });
  console.log(`${relative(DIR!, out)} (frame ${frame}). Read it to look at it.`);
}

async function renderFinal(draft = false) {
  mkdirSync(P.exports, { recursive: true });
  const raw = join(P.internal, "raw.mp4");
  const final = finalFile(DIR!, config.name);
  mkdirSync(P.internal, { recursive: true });
  if (engine() === "hyperframes") {
    await hyperframes(["render", "--quality", draft ? "draft" : "delivery", "--output", raw]);
    console.log("rendered with HyperFrames");
  } else {
    const { serveUrl, browserExecutable, composition } = await remotion();
    const progress = join(DIR!, ".render-progress");
    let last = 0;
    await renderMedia({
      composition, serveUrl, codec: "h264", crf: draft ? 28 : 18, outputLocation: raw, browserExecutable, concurrency: cpus().length,
      audioBitrate: "256k", overwrite: true, ...(draft ? { scale: 0.5 } : {}),
      onProgress: ({ progress: p }) => {
        if (p - last >= 0.01 || p === 1) writeFileSync(progress, String((last = p)));
      },
    });
    rmSync(progress, { force: true });
    console.log(`rendered ${composition.width}x${composition.height}, ${round(composition.durationInFrames / composition.fps, 2)} s${draft ? " (draft: half size)" : ""}`);
  }
  // Levelling needs ffmpeg's loudness meter. Without it (the bundled backup ffmpeg has none) the
  // video is still exported, as mixed, and that is said in one line.
  await master(raw, final).catch((e) => {
    copyFileSync(raw, final);
    console.log(`audio NOT levelled (${String(e.message).split("\n")[0].slice(0, 120)}): exported as mixed. Keep speech clearly louder than music.`);
  });
  rmSync(raw, { force: true });
  await check(final);
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
  const problems = validateProject(DIR!);
  console.log(problems.length ? `EDITABLE: NO. Fix these (the result must stay hand-editable):\n${problems.map((p) => `- ${p}`).join("\n")}` : "EDITABLE: yes (source untouched, cuts and captions are values in project/timeline.json, all media local, README and render command present)");
  if (!existsSync(file)) fail(`${relative(DIR!, file)} doesn't exist yet`);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]);
  const info = JSON.parse(stdout);
  const duration = Number(info.format.duration);
  const v = info.streams.find((s: any) => s.codec_type === "video");
  // Each measurement on its own: a meter this ffmpeg doesn't have is skipped, not fatal.
  const quiet = <T>(p: Promise<T>, or: T) => p.catch(() => or);
  const l = await quiet(loudness(file), { lufs: NaN, peak: NaN });
  const { stderr } = await quiet(run("ffmpeg", ["-v", "info", "-nostats", "-i", file, "-vn", "-af", "astats=measure_overall=Peak_level+Number_of_samples:measure_perchannel=none", "-f", "null", "-"]), { stdout: "", stderr: "" });
  const peakDb = Number(stderr.match(/Peak level dB:\s*(-?[\d.]+|-inf)/)?.[1]);
  const { stderr: clipErr } = await quiet(run("ffmpeg", ["-v", "info", "-nostats", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"]), { stdout: "", stderr: "" });
  const atMax = Number(clipErr.match(/histogram_0db:\s*(\d+)/)?.[1] ?? 0);
  mkdirSync(P.checks, { recursive: true });
  const every = Math.max(1, duration / 12);
  await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-vf", `fps=1/${every.toFixed(3)},scale=-2:480,tile=6x2:padding=6:color=white`, "-frames:v", "1", join(P.checks, "sheet.jpg")]).catch((e) => console.log(`(no frame sheet: ${String(e.message).split("\n")[0]})`));
  console.log(
    [
      `${relative(DIR!, file)}: ${v ? `${v.width}x${v.height}, ` : ""}${round(duration, 2)} s`,
      Number.isFinite(l.lufs)
        ? `loudness ${l.lufs} LUFS (target ${TARGET_LUFS}), true peak ${l.peak} dBFS, sample peak ${peakDb} dB, samples at 0 dB (clipped): ${atMax}`
        : "loudness: could not be measured with the ffmpeg in use (see `tools`)",
      `notes/checks/sheet.jpg: 12 frames, one every ${round(every, 2)} s (left to right, top to bottom). Read it to look.`,
    ].join("\n"),
  );
}

/** B-roll search and download happen in Creatro itself (it has the keys); this just asks it. */
async function broker(what: string, rest: string[]) {
  const url = process.env.CREATRON_BROKER ?? fail("Creatro isn't listening for B-roll requests");
  const res = await fetch(`${url}/broll/${what}`, { method: "POST", body: JSON.stringify({ args: rest }) }).catch((e) => fail(`couldn't reach Creatro: ${e.message}`));
  const text = await res.text();
  if (!res.ok) fail(text);
  console.log(text);
}

/**
 * The speaker cut out of their background (Apple Vision, on this Mac), as a see-through video
 * in assets/cutouts/speaker.webm. It is made from the SOURCE, for every cut plus half a second
 * on each side, and timeline.json's "cutout" says which source seconds sit where in the file:
 * the Cutout component follows the cuts, so trimming a cut by hand keeps working. A cut moved
 * outside what was covered needs this command again (check says so).
 */
async function cutout() {
  if (!config.hasVideo) fail("the recording has no picture, so there is nobody to cut out");
  if (!find("swiftc") && !existsSync(join(homedir(), "Library", "Caches", "Creatron", "person-mask"))) fail(`The cutout tool isn't available (no Swift compiler). ${FALLBACK.swiftc.without}.`);
  const helper = join(homedir(), "Library", "Caches", "Creatron", "person-mask");
  if (!existsSync(helper)) {
    console.error("building the person-mask helper (once, about a minute)");
    mkdirSync(join(homedir(), "Library", "Caches", "Creatron"), { recursive: true });
    await run("swiftc", ["-O", join(ROOT, "tools", "person-mask.swift"), "-o", helper]);
  }
  const timeline = readTimeline(DIR!);
  const facts = existsSync(P.facts) ? JSON.parse(readFileSync(P.facts, "utf8")) : {};
  const length = Number(facts.duration) || Math.max(...timeline.cuts.map((c) => c.end));
  // Source ranges to cover: each cut with handles, overlapping ones merged.
  const padded = timeline.cuts.map((c) => [Math.max(0, c.start - 0.5), Math.min(length, c.end + 0.5)] as [number, number]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of padded) merged.length && r[0] <= merged.at(-1)![1] ? (merged.at(-1)![1] = Math.max(merged.at(-1)![1], r[1])) : merged.push([...r]);
  // Whole frames, so the file's own timing matches what timeline.json says.
  const fps = timeline.fps;
  const ranges = merged.map(([s, e]) => [Math.floor(s * fps) / fps, Math.ceil(e * fps) / fps] as [number, number]);
  const work = join(P.internal, "cutout");
  mkdirSync(work, { recursive: true });
  // Vision works at any size; 1920 tall is plenty and keeps it quick.
  const small = join(work, "in.mp4");
  const parts = ranges.map(([s, e], i) => `[0:v]trim=${s}:${e},setpts=PTS-STARTPTS,fps=${fps}[v${i}]`);
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", SOURCE,
    "-filter_complex", `${parts.join(";")};${ranges.map((_, i) => `[v${i}]`).join("")}concat=n=${ranges.length}:v=1:a=0,scale=-2:'min(1920,ih)'[v]`,
    "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-an", small,
  ]);
  const mask = join(work, "mask.mp4");
  await run(helper, [small, mask]);
  const file = join("assets", "cutouts", "speaker.webm");
  mkdirSync(join(DIR!, "assets", "cutouts"), { recursive: true });
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", small, "-i", mask,
    "-filter_complex", "[1:v]format=gray[m];[0:v][m]alphamerge,format=yuva420p",
    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-b:v", "6M", "-an", join(DIR!, file),
  ]);
  rmSync(work, { recursive: true, force: true });
  let at = 0;
  timeline.cutout = { file, ranges: ranges.map(([s, e]) => [round(s, 3), round(e, 3), round((at += e - s) - (e - s), 3)]) };
  writeTimeline(DIR!, timeline);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "csv=p=0", join(DIR!, file)]);
  console.log(`${file} (${stdout.trim().replace(/\n/g, ", ")}): the speaker with a see-through background, for every cut plus 0.5 s each side.`);
  console.log('Use <Cutout /> from "./creatron/Footage" (it follows the cuts) and keep the sound on <Footage />. Layer it over a designed background.');
}
