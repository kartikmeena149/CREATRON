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
import { type ChromiumOptions, ensureBrowser, makeCancelSignal, openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, homedir, totalmem } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { levelFilter, TARGET_LUFS } from "./loudness.ts";
import { APP_COMMANDS, EXIT_MARK, type Cut, captionPages, finalFile, projectPaths, readTimeline, validateProject, writeTimeline } from "./project.ts";
import { chromeOutsideProtectedFolders, freeMemory, renderBudget } from "./remotion.ts";
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

/**
 * Chrome draws the frames. On a Mac it draws with the GPU (ANGLE on Metal): blurs, shadows and
 * video layers are about 5x faster than Chrome's default software drawing.
 */
let gpu = process.platform === "darwin";
const chromium = (): ChromiumOptions => (gpu ? { gl: "angle" } : {});

const [cmd, ...args] = process.argv.slice(2);

// Inside an AI job, the commands that start Chrome or the Vision helper run in the app, not here:
// the agent's sandbox blocks them, and whether this process is inside that sandbox depends on how
// the agent wrote its command line. If the app can't be reached, the command runs here as before.
if (cmd && APP_COMMANDS.includes(cmd) && process.env.CREATRON_BROKER && !process.env.CREATRON_IN_APP) {
  const code = await inApp(process.env.CREATRON_BROKER, [cmd, ...args]);
  if (code !== undefined) process.exit(code);
  console.log("note: Creatro didn't answer, so this runs here instead.");
}

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
  const slow = projectFiles().filter((f) => !f.endsWith(join("creatron", "Video.tsx")) &&
    /<OffthreadVideo\b|import\s*\{[^}]*\b(OffthreadVideo|Video)\b[^}]*\}\s*from\s*"remotion"/.test(readFileSync(f, "utf8")));
  if (slow.length) console.log(`note: ${slow.map((f) => relative(DIR!, f)).join(", ")} play video with Remotion's own player, which renders 3-5x slower. Use <Video> from ./creatron/Video instead (same props).`);
  let composition;
  try {
    composition = await selectComposition({ serveUrl, id: "Main", browserExecutable, chromiumOptions: chromium() });
  } catch (e) {
    if (!chromium().gl) throw e;
    // The Mac's GPU drawing didn't start: draw on the CPU instead (slower, same picture).
    console.log(`note: GPU drawing didn't start (${String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 100)}): drawing on the CPU, slower.`);
    gpu = false;
    composition = await selectComposition({ serveUrl, id: "Main", browserExecutable, chromiumOptions: chromium() });
  }
  return { serveUrl, browserExecutable, composition };
}

/** The project's own code files (project/src). */
function projectFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(join(d, e.name));
    }
  };
  walk(join(DIR!, "project", "src"));
  return out;
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
  await renderStill({ composition, serveUrl, frame, output: out, imageFormat: "png", browserExecutable, chromiumOptions: chromium(), overwrite: true });
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
    await remotionChunks(raw, draft);
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
/**
 * The Remotion render, in pieces of about 20 seconds. One frame that fails (a decoder that stalls, a
 * file that loads slowly) used to throw away the whole render and the next try started at frame 0.
 * Now each finished piece is kept: a failed piece is tried again in a safe mode, and if it still
 * fails, running render again picks up at that piece. Pieces are keyed by the project's code,
 * timeline and media, so a changed project never reuses an old piece.
 *
 * Fast by default: GPU drawing, the Mac's hardware video encoder (the CPU stays free for drawing;
 * x264 on the CPU was the slowest part), one Chrome for all pieces, and as many workers as memory
 * allows (more than that is slower: 8 workers on an 8 GB Mac ran at half the speed of 3).
 * Safe mode for a failed piece: CPU drawing, x264, one worker, long timeouts.
 *
 * Memory: workers and caches are sized before every piece from what is free at that moment
 * (renderBudget), and a piece that is running when memory runs low is stopped and finished with
 * one worker. A full render with 3 workers and default caches once took a busy 8 GB Mac down.
 */
async function remotionChunks(raw: string, draft: boolean) {
  const { serveUrl, browserExecutable, composition } = await remotion();
  const progress = join(DIR!, ".render-progress");
  const total = composition.durationInFrames;
  const size = Math.max(1, Math.round(composition.fps * 20));
  const key = projectKey(draft);
  const dir = join(P.internal, "render-pieces");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (!f.startsWith(key)) rmSync(join(dir, f), { force: true });
  const most = Math.max(2, Math.floor(cpus().length / 2));
  let said = 0;
  // Bits per second for the hardware encoder: about what x264 at CRF 18 gives for this size.
  const pixels = composition.width * composition.height * (draft ? 0.25 : 1);
  const bitrate = `${Math.max(4, Math.round((pixels / (1080 * 1920)) * 16))}M`;
  const pieces: string[] = [];
  let done = 0;
  const bar = progressBar(total, composition.fps);
  let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
  const shared = async () => (browser ??= await openBrowser("chrome", { browserExecutable, chromiumOptions: chromium() }));
  const drop = async () => {
    const b = browser;
    browser = undefined;
    await b?.close({ silent: true }).catch(() => {});
  };
  try {
    for (let start = 0; start < total; start += size) {
      const end = Math.min(total, start + size) - 1;
      const file = join(dir, `${key}-${String(start).padStart(6, "0")}.mp4`);
      pieces.push(file);
      if (existsSync(file)) {
        done += end - start + 1;
        bar.skip(done);
        continue;
      }
      const part = `${file}.part.mp4`;
      const budget = renderBudget(most, 1.5); // a tab that decodes video: measured, 3 of them left an 8 GB Mac 16% free
      if (budget.workers !== said && (budget.workers < most || said)) {
        bar.say(budget.tight
          ? `memory is low (${round(budget.freeGB, 1)} GB free): rendering with one worker and small caches. Closing other apps makes it faster.`
          : `${round(budget.freeGB, 1)} GB of memory free: rendering with ${budget.workers} worker${budget.workers > 1 ? "s" : ""}`);
      }
      said = budget.workers;
      // Memory can run out while a piece renders (another app grows): stop the piece before the Mac does.
      const { cancelSignal, cancel } = makeCancelSignal();
      let squeezed = false;
      const watch = setInterval(() => {
        if (squeezed || freeMemory() > 0.1 * totalmem()) return;
        squeezed = true;
        cancel();
      }, 3000);
      const common = {
        composition, serveUrl, browserExecutable, codec: "h264" as const, outputLocation: part, overwrite: true,
        frameRange: [start, end] as [number, number], muted: true,
        offthreadVideoCacheSizeInBytes: budget.offthreadCache, mediaCacheSizeInBytes: budget.mediaCache,
        ...(draft ? { scale: 0.5 } : {}),
        onProgress: ({ progress: p }: { progress: number }) => {
          const at = done + p * (end - start + 1);
          writeFileSync(progress, String(at / total));
          bar.show(at);
        },
      };
      try {
        await renderMedia({
          ...common, puppeteerInstance: await shared(), chromiumOptions: chromium(), concurrency: budget.workers, timeoutInMilliseconds: 90_000,
          hardwareAcceleration: "if-possible", videoBitrate: bitrate, cancelSignal,
        });
      } catch (e) {
        clearInterval(watch);
        bar.say(squeezed
          ? `memory ran low during frames ${start}-${end}: finishing them with one worker`
          : `frames ${start}-${end} failed (${String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 120)}): trying them again in safe mode`);
        await drop(); // a browser that failed once isn't trusted for the next pieces (and closing it gives its memory back)
        try {
          const small = { offthreadVideoCacheSizeInBytes: 128 * 2 ** 20, mediaCacheSizeInBytes: 96 * 2 ** 20 };
          await renderMedia({ ...common, ...small, concurrency: 1, timeoutInMilliseconds: 240_000, crf: draft ? 28 : 18 });
        } catch (e2) {
          rmSync(part, { force: true });
          bar.end();
          fail(`frames ${start}-${end} would not render: ${String(e2 instanceof Error ? e2.message : e2).split("\n")[0].slice(0, 200)}\n` +
            `The ${done} frames before them are kept: run render again and it continues from frame ${start}.`);
        }
      }
      clearInterval(watch);
      renameSync(part, file);
      done += end - start + 1;
      bar.show(done);
    }
    bar.end();
    // The sound, rendered once on its own (no pictures drawn), then joined to the pieces.
    const wav = join(dir, `${key}-sound.wav`);
    if (!existsSync(wav)) {
      console.log("render: mixing the sound");
      await renderMedia({
        composition, serveUrl, browserExecutable, puppeteerInstance: await shared(), chromiumOptions: chromium(), codec: "wav",
        outputLocation: `${wav}.part.wav`, overwrite: true, enforceAudioTrack: true, timeoutInMilliseconds: 90_000,
      });
      renameSync(`${wav}.part.wav`, wav);
    }
    const list = join(dir, "pieces.txt");
    writeFileSync(list, pieces.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-i", wav, "-map", "0:v", "-map", "1:a",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", raw]);
  } finally {
    await drop();
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(progress, { force: true });
  console.log(`rendered ${composition.width}x${composition.height}, ${round(total / composition.fps, 2)} s${draft ? " (draft: half size)" : ""}`);
}

/**
 * The render's progress: in a terminal, one line that redraws (bar, percent, frames, time left);
 * when the output goes to a file or the AI, a plain line every 5%.
 */
function progressBar(total: number, fps: number) {
  const tty = process.stdout.isTTY;
  const began = Date.now();
  let from = 0; // frames already there from an earlier try: not counted for the speed
  let lastStep = -1;
  let lastDraw = 0;
  const clock = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const line = (at: number) => {
    const f = Math.min(1, at / total);
    const made = at - from;
    const spent = Date.now() - began;
    const left = f >= 1 ? "done" : made > fps ? `${clock((spent / made) * (total - at))} left` : "--:-- left";
    const speed = made > 0 ? (made / (spent / 1000)).toFixed(1) : "0.0";
    const tail = ` ${String(Math.floor(f * 100)).padStart(3)}%  ${Math.floor(at)}/${total}  ${speed} fps  ${left}`;
    // The bar takes what the window leaves: a line wider than the window wraps, and every redraw
    // then starts a new line instead of replacing the old one.
    const cols = process.stdout.columns || 80;
    const width = Math.max(0, Math.min(28, cols - tail.length - 4));
    const fill = Math.round(f * width);
    const out = width >= 5 ? `[${"█".repeat(fill)}${"░".repeat(width - fill)}]${tail}` : tail.trim();
    return out.slice(0, cols - 1);
  };
  const show = (at: number) => {
    if (tty) {
      if (Date.now() - lastDraw < 150 && at < total) return;
      lastDraw = Date.now();
      process.stdout.write(`\r\x1b[K${line(at)}`);
    } else {
      const step = Math.floor((at / total) * 20);
      if (step !== lastStep) {
        lastStep = step;
        console.log(line(at));
      }
    }
  };
  return {
    show,
    /** Pieces kept from an earlier try. */
    skip(at: number) {
      from = at;
      show(at);
    },
    /** A message, without breaking the bar. */
    say(text: string) {
      if (tty) process.stdout.write("\r\x1b[K");
      console.log(text);
    },
    end() {
      if (tty) process.stdout.write("\n");
    },
  };
}

/** A short fingerprint of everything the picture is made from: code, timeline, and media (by size and date). */
function projectKey(draft: boolean): string {
  const h = createHash("sha1").update(draft ? "draft" : "full");
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory() && e.name !== "node_modules") walk(p);
      else if (e.isFile()) {
        const s = statSync(p);
        h.update(p);
        h.update(/\.(tsx?|jsx?|json|css)$/.test(e.name) && s.size < 2 ** 20 ? readFileSync(p) : `${s.size}:${s.mtimeMs}`);
      }
    }
  };
  walk(join(DIR!, "project", "src"));
  h.update(readFileSync(P.timeline));
  for (const d of ["source", "assets"]) walk(join(DIR!, d));
  return h.digest("hex").slice(0, 12);
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

/**
 * Runs this command in the app and prints what it prints. Returns its exit code, or nothing when
 * the app couldn't be reached at all (then nothing has run yet).
 */
function inApp(url: string, argv: string[]): Promise<number | undefined> {
  return new Promise((ok) => {
    const req = request(`${url}/tool`, { method: "POST" }, (res) => {
      if (res.statusCode !== 200) return res.resume(), ok(undefined);
      let tail = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => {
        // Everything is printed as it comes, except a last piece that may be (part of) the exit line.
        tail += d;
        const at = tail.lastIndexOf(EXIT_MARK[0]!);
        const keep = at >= 0 ? at : tail.length;
        process.stdout.write(tail.slice(0, keep));
        tail = tail.slice(keep);
      });
      const finish = () => {
        const m = tail.startsWith(EXIT_MARK) ? Number(tail.slice(EXIT_MARK.length)) : NaN;
        if (Number.isNaN(m)) console.error("error: Creatro stopped answering before the command finished. Run it again: finished render pieces are kept.");
        ok(Number.isNaN(m) ? 1 : m);
      };
      res.on("end", finish);
      res.on("error", finish);
    });
    req.on("error", () => ok(undefined));
    req.end(JSON.stringify({ args: argv }));
  });
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
