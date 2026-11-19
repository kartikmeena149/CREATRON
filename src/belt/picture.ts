// The pictures: frames to look at (stills) and the whole video (render), from the project's
// Remotion code, or its HyperFrames page when that is the engine.
//
// Fast where the old belt was slow:
// - The webpack bundle of the project is kept (.creatron/bundle) and reused until the code or the
//   timeline changes. The old belt bundled the whole project again for every single still.
// - Remotion and webpack are loaded only by the commands that draw, and only when needed.
// - Several stills come from one browser and one bundle (`still 2 5 9`), not one each.
// Never stuck: every render piece has a watchdog. A piece whose frames stop moving is stopped and
// tried again in safe mode; if that stalls too, the render ends with a clear message and keeps every
// finished piece (the next render continues from there). The old belt could wait forever.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { chromeOutsideProtectedFolders, freeMemory, renderBudget } from "../machine.ts";
import { FALLBACK, find } from "../toolchain.ts";
import { ROOT, round, run } from "../tools.ts";
import { DIR, P, fail, firstLine, rel, safeName } from "./context.ts";
import { progressBar } from "./progress.ts";

type Renderer = typeof import("@remotion/renderer");
type Composition = Awaited<ReturnType<Renderer["selectComposition"]>>;
type Browser = Awaited<ReturnType<Renderer["openBrowser"]>>;

/** A piece's frames must move at least this often, or it is stopped (fast try / safe try). */
const STALL_MS = { fast: 120_000, safe: 300_000 };
const PIECE_SECONDS = 20;

/** Which engine the project is built with: Remotion code, or (the fallback) a HyperFrames page. */
export function engine(): "remotion" | "hyperframes" {
  return existsSync(P.entry) ? "remotion" : existsSync(P.html) ? "hyperframes" : fail("there is no video to render yet: write project/src/index.ts (Remotion) or project/index.html (HyperFrames)");
}

/** The HyperFrames CLI on this project, through the wall. */
function hyperframes(args: string[]) {
  const hf = find("hyperframes") ?? fail(`HyperFrames isn't working on this Mac. ${FALLBACK.hyperframes.without}.`);
  return run(hf.cmd, [...hf.pre, ...args, join(DIR, "project")]);
}

// ---- Remotion: one bundle, one browser ----

/**
 * The project, bundled and ready to draw. The bundle is reused while the code and the timeline are
 * the same; Chrome draws on the GPU (ANGLE on Metal, about 5x faster for blurs, shadows and video)
 * and falls back to the CPU when the GPU doesn't start.
 */
async function remotion() {
  if (!find("remotion")) fail(`Remotion isn't working. ${FALLBACK.remotion.without}.`);
  const r: Renderer = await import("@remotion/renderer");
  const serveUrl = await bundled();
  const got = await r.ensureBrowser();
  if (!("path" in got)) fail("couldn't get Remotion's browser");
  const browserExecutable = chromeOutsideProtectedFolders(got.path);
  let gpu = process.platform === "darwin";
  const chromiumOptions = () => (gpu ? { gl: "angle" as const } : {});
  let browser: Browser | undefined;
  const open = async () => (browser ??= await r.openBrowser("chrome", { browserExecutable, chromiumOptions: chromiumOptions() }));
  let composition: Composition;
  try {
    composition = await r.selectComposition({ serveUrl, id: "Main", browserExecutable, chromiumOptions: chromiumOptions(), puppeteerInstance: await open() });
  } catch (e) {
    if (!gpu) throw e;
    console.log(`note: GPU drawing didn't start (${firstLine(e, 100)}): drawing on the CPU, slower.`);
    gpu = false;
    await close();
    composition = await r.selectComposition({ serveUrl, id: "Main", browserExecutable, chromiumOptions: chromiumOptions(), puppeteerInstance: await open() });
  }
  async function close() {
    const b = browser;
    browser = undefined;
    await b?.close({ silent: true }).catch(() => {});
  }
  return { r, serveUrl, browserExecutable, composition, chromiumOptions, open, close };
}

/** The bundle for the project as it is now: reused when nothing it is made from changed. */
async function bundled(): Promise<string> {
  const out = join(P.internal, "bundle");
  const stamp = join(out, ".creatro-key");
  const key = codeKey();
  if (existsSync(join(out, "index.html")) && existsSync(stamp) && readFileSync(stamp, "utf8") === key) return out;
  warnSlowPlayers();
  rmSync(out, { recursive: true, force: true });
  const { bundle } = await import("@remotion/bundler");
  const url = await bundle({
    entryPoint: P.entry,
    rootDir: join(DIR, "project"),
    publicDir: P.public,
    symlinkPublicDir: true, // source/ and assets/ are played where they are, never copied
    outDir: out,
    // The project uses Creatro's own Remotion and React, wherever the folder lives.
    webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, modules: [join(ROOT, "node_modules"), "node_modules"] } }),
  });
  writeFileSync(stamp, key);
  return url;
}

/** What the bundle is made from: the project's code, the timeline (imported by it), and Remotion's version. */
function codeKey(): string {
  const h = createHash("sha1");
  for (const f of codeFiles()) h.update(f).update(readFileSync(f));
  h.update(readFileSync(P.timeline));
  h.update(readFileSync(join(ROOT, "node_modules", "remotion", "package.json")));
  return h.digest("hex").slice(0, 16);
}

/** The project's own code files (project/src), in a stable order. */
function codeFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/\.(tsx?|jsx?|json|css)$/.test(e.name)) out.push(join(d, e.name));
    }
  };
  walk(join(DIR, "project", "src"));
  return out;
}

function warnSlowPlayers() {
  const slow = codeFiles().filter((f) => !f.endsWith(join("creatron", "Video.tsx")) && /\.(tsx?|jsx?)$/.test(f) &&
    /<OffthreadVideo\b|import\s*\{[^}]*\b(OffthreadVideo|Video)\b[^}]*\}\s*from\s*"remotion"/.test(readFileSync(f, "utf8")));
  if (slow.length) console.log(`note: ${slow.map(rel).join(", ")} play video with Remotion's own player, which renders 3-5x slower. Use <Video> from ./creatron/Video instead (same props).`);
}

// ---- stills ----

/** Frames of the finished video at these seconds -> notes/checks/<name>.png, all from one browser. */
export async function stills(shots: { seconds: number; name: string }[]) {
  mkdirSync(P.checks, { recursive: true });
  const outs = shots.map((s) => ({ ...s, file: join(P.checks, safeName(s.name.endsWith(".png") ? s.name : `${s.name}.png`)) }));
  if (engine() === "hyperframes") {
    for (const s of outs) {
      const { stdout } = await hyperframes(["snapshot", "--at", String(s.seconds)]);
      const made = stdout.match(/(\S+frame-00[^\s]*\.png)/)?.[1] ?? fail(`HyperFrames made no frame:\n${stdout.slice(-400)}`);
      copyFileSync(made.startsWith("/") ? made : join(DIR, "project", made), s.file);
      console.log(`${rel(s.file)}. Read it to look at it.`);
    }
    return;
  }
  const rm = await remotion();
  try {
    for (const s of outs) {
      const frame = Math.max(0, Math.min(Math.round(s.seconds * rm.composition.fps), rm.composition.durationInFrames - 1));
      await rm.r.renderStill({
        composition: rm.composition, serveUrl: rm.serveUrl, frame, output: s.file, imageFormat: "png", overwrite: true,
        browserExecutable: rm.browserExecutable, chromiumOptions: rm.chromiumOptions(), puppeteerInstance: await rm.open(),
      });
      console.log(`${rel(s.file)} (frame ${frame}). Read it to look at it.`);
    }
  } finally {
    await rm.close();
  }
}

// ---- the whole video ----

/** The rendered pictures (in order) and the sound (a WAV, or none when it's inside the pictures). */
export type Rendered = { pictures: string[]; sound?: string; done: () => void; summary: string };

export async function renderPictures(draft: boolean): Promise<Rendered> {
  warnLowDisk();
  if (engine() === "hyperframes") {
    const raw = join(P.internal, "raw.mp4");
    await hyperframes(["render", "--quality", draft ? "draft" : "delivery", "--output", raw]);
    return { pictures: [raw], done: () => rmSync(raw, { force: true }), summary: "rendered with HyperFrames" };
  }
  return remotionPieces(draft);
}

/**
 * The Remotion render, in pieces of about 20 seconds. A finished piece is kept (keyed by everything
 * the picture is made from), so a render that stops continues where it was. A piece that fails or
 * stalls is tried again in safe mode (CPU drawing, x264, one worker, long timeouts); if that fails
 * too, the render ends with what to do, never a hang.
 *
 * Fast by default: GPU drawing, the Mac's hardware video encoder, one browser for every piece, and
 * as many workers as free memory allows (sized before each piece; a piece that runs into low memory
 * is stopped and finished with one worker).
 */
async function remotionPieces(draft: boolean): Promise<Rendered> {
  const rm = await remotion();
  const { r, composition } = rm;
  const progress = join(DIR, ".render-progress");
  const total = composition.durationInFrames;
  const size = Math.max(1, Math.round(composition.fps * PIECE_SECONDS));
  const key = piecesKey(draft);
  const dir = join(P.internal, "render-pieces");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (!f.startsWith(key)) rmSync(join(dir, f), { force: true });
  const most = Math.max(2, Math.floor(cpus().length / 2));
  const pixels = composition.width * composition.height * (draft ? 0.25 : 1);
  const bitrate = `${Math.max(4, Math.round((pixels / (1080 * 1920)) * 16))}M`; // about x264 CRF 18 at this size
  const bar = progressBar(total, composition.fps);
  const pieces: string[] = [];
  let done = 0;
  let said = 0;
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
      const budget = renderBudget(most, 1.5); // a tab that decodes video: 3 of them left an 8 GB Mac 16% free
      if (budget.workers !== said && (budget.workers < most || said))
        bar.say(budget.tight
          ? `memory is low (${round(budget.freeGB, 1)} GB free): rendering with one worker and small caches. Closing other apps makes it faster.`
          : `${round(budget.freeGB, 1)} GB of memory free: rendering with ${budget.workers} worker${budget.workers > 1 ? "s" : ""}`);
      said = budget.workers;
      const part = `${file}.part.mp4`;
      const common = {
        composition, serveUrl: rm.serveUrl, browserExecutable: rm.browserExecutable, codec: "h264" as const,
        outputLocation: part, overwrite: true, frameRange: [start, end] as [number, number], muted: true,
        ...(draft ? { scale: 0.5 } : {}),
      };
      const report = (p: number) => {
        const at = done + p * (end - start + 1);
        writeFileSync(progress, String(at / total));
        bar.show(at);
      };
      // Fast try.
      let why = await guarded(r, "fast", report, async (cancelSignal, onProgress) => r.renderMedia({
        ...common, onProgress, cancelSignal, puppeteerInstance: await rm.open(), chromiumOptions: rm.chromiumOptions(),
        concurrency: budget.workers, timeoutInMilliseconds: 90_000, hardwareAcceleration: "if-possible", videoBitrate: bitrate,
        offthreadVideoCacheSizeInBytes: budget.offthreadCache, mediaCacheSizeInBytes: budget.mediaCache,
      }));
      if (why) {
        bar.say(why === "memory" ? `memory ran low during frames ${start}-${end}: finishing them with one worker`
          : why === "stall" ? `frames ${start}-${end} stopped moving for ${STALL_MS.fast / 1000} s: trying them again in safe mode`
          : `frames ${start}-${end} failed (${why}): trying them again in safe mode`);
        await rm.close(); // a browser that failed once isn't trusted for the next pieces (and closing it gives its memory back)
        // Safe try: its own browser, one worker, small caches, x264.
        why = await guarded(r, "safe", report, (cancelSignal, onProgress) => r.renderMedia({
          ...common, onProgress, cancelSignal, chromiumOptions: rm.chromiumOptions(), concurrency: 1, timeoutInMilliseconds: 240_000,
          crf: draft ? 28 : 18, offthreadVideoCacheSizeInBytes: 128 * 2 ** 20, mediaCacheSizeInBytes: 96 * 2 ** 20,
        }));
        if (why) {
          rmSync(part, { force: true });
          bar.end();
          fail(`frames ${start}-${end} would not render (${why === "stall" ? `stalled twice, ${STALL_MS.safe / 1000} s without a frame` : why}).\n` +
            `The ${done} frames before them are kept: run render again and it continues from frame ${start}.`);
        }
      }
      renameSync(part, file);
      done += end - start + 1;
      bar.show(done);
    }
    bar.end();
    // The sound, rendered once on its own (no pictures drawn), guarded the same way.
    const wav = join(dir, `${key}-sound.wav`);
    if (!existsSync(wav)) {
      console.log("render: mixing the sound");
      const why = await guarded(r, "safe", () => {}, async (cancelSignal, onProgress) => r.renderMedia({
        composition, serveUrl: rm.serveUrl, browserExecutable: rm.browserExecutable, puppeteerInstance: await rm.open(),
        chromiumOptions: rm.chromiumOptions(), codec: "wav", outputLocation: `${wav}.part.wav`, overwrite: true,
        enforceAudioTrack: true, timeoutInMilliseconds: 90_000, onProgress, cancelSignal,
      }));
      if (why) fail(`the sound would not render (${why}). The pictures are kept: run render again.`);
      renameSync(`${wav}.part.wav`, wav);
    }
    return {
      pictures: pieces,
      sound: wav,
      done: () => {
        rmSync(dir, { recursive: true, force: true });
        rmSync(progress, { force: true });
      },
      summary: `rendered ${composition.width}x${composition.height}, ${round(total / composition.fps, 2)} s${draft ? " (draft: half size)" : ""}`,
    };
  } finally {
    await rm.close();
  }
}

type OnProgress = (p: { progress: number; renderedFrames: number; encodedFrames: number }) => void;

/**
 * Runs one render with a watchdog: it is stopped when its frames stop moving (a stall) or, on the
 * fast try, when the Mac runs low on memory. Returns nothing when it finished, or why it didn't.
 */
async function guarded(
  r: Renderer, mode: "fast" | "safe", report: (p: number) => void,
  go: (cancelSignal: ReturnType<Renderer["makeCancelSignal"]>["cancelSignal"], onProgress: OnProgress) => Promise<unknown>,
): Promise<string | undefined> {
  const { cancelSignal, cancel } = r.makeCancelSignal();
  let why: string | undefined;
  let last = Date.now();
  let moved = -1;
  const stop = (reason: string) => {
    if (why) return;
    why = reason;
    cancel();
  };
  const watch = setInterval(() => {
    if (Date.now() - last > STALL_MS[mode]) stop("stall");
    else if (mode === "fast" && freeMemory() < 0.1 * totalmem()) stop("memory");
  }, 2000);
  try {
    await go(cancelSignal, (p) => {
      const n = p.renderedFrames + p.encodedFrames;
      if (n !== moved) (moved = n), (last = Date.now());
      report(p.progress);
    });
    return undefined;
  } catch (e) {
    return why ?? firstLine(e);
  } finally {
    clearInterval(watch);
  }
}

/** A short fingerprint of everything the picture is made from: code, timeline, and media (by size and date). */
function piecesKey(draft: boolean): string {
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
  walk(join(DIR, "project", "src"));
  h.update(readFileSync(P.timeline));
  for (const d of ["source", "assets"]) walk(join(DIR, d));
  return h.digest("hex").slice(0, 12);
}

/** A nearly full disk makes the Mac swap and renders crawl or stall: said once, up front. */
function warnLowDisk() {
  try {
    const s = statfsSync(DIR);
    const freeGB = (s.bavail * s.bsize) / 2 ** 30;
    if (freeGB < 5) console.log(`note: the disk is nearly full (${round(freeGB, 1)} GB free). Renders need room for pieces and for the Mac's memory; free some space if this one is slow.`);
  } catch {}
}
