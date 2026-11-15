// Renders the Remotion layer (motion/) as see-through PNG frames for the export to lay on top.
// PNG frames on every core are ~45x faster than encoding a see-through video. The templates
// are bundled once per run; Remotion fetches its own headless Chrome the first time (about
// 140 MB), which Creatro keeps in ~/Library/Caches/Creatron (see chromeOutsideProtectedFolders).
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderFrames, renderStill, selectComposition } from "@remotion/renderer";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { cpus, freemem, homedir, totalmem } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { customFiles, customVersion, writeCustomEntry } from "./customcode.ts";
import type { OverlayProps } from "./motion.ts";
import { ROOT } from "./tools.ts";

const served = new Map<string, Promise<string>>();

/** On a Mac, Chrome draws with the GPU (ANGLE on Metal): about 5x faster than its software drawing. */
const chromiumOptions = process.platform === "darwin" ? { gl: "angle" as const } : {};

/**
 * The bundled templates, plus this project's custom animations (custom/) when it has any.
 * Rebundled only when the custom code changes.
 */
function serveUrlFor(custom?: string): Promise<string> {
  const withCustom = custom && customFiles(custom).length > 0;
  const key = withCustom ? `${custom}|${customVersion(custom)}` : "templates";
  let url = served.get(key);
  if (!url) {
    const entryPoint = withCustom ? writeCustomEntry(custom) : join(ROOT, "motion", "index.ts");
    url = bundle({ entryPoint }).catch((e) => {
      served.delete(key); // try bundling again next time
      throw e;
    });
    served.set(key, url);
  }
  return url;
}

async function browserAndComposition(props: OverlayProps, custom?: string) {
  const serveUrl = await serveUrlFor(custom);
  const browser = await ensureBrowser();
  if (!("path" in browser)) throw new Error("Couldn't download the browser Remotion draws animations with. Check your internet connection and export again.");
  const browserExecutable = chromeOutsideProtectedFolders(browser.path);
  const composition = await selectComposition({ serveUrl, id: "Overlay", inputProps: props, browserExecutable, chromiumOptions });
  return { serveUrl, browserExecutable, composition };
}

/** One frame of the layer as a see-through PNG (the AI's own check of what it made). */
export async function renderOverlayStill(props: OverlayProps, frame: number, out: string, custom?: string): Promise<string> {
  const { serveUrl, browserExecutable, composition } = await browserAndComposition(props, custom);
  await renderStill({ composition, serveUrl, inputProps: props, frame, output: out, imageFormat: "png", browserExecutable, chromiumOptions, overwrite: true });
  return out;
}

/** Writes frames as dir/element-NNN.png (one per output frame) and returns the glob ffmpeg reads them with. */
export async function renderOverlay(
  props: OverlayProps,
  dir: string,
  onProgress: (fraction: number) => void = () => {},
  custom?: string,
): Promise<string> {
  const { serveUrl, browserExecutable, composition } = await browserAndComposition(props, custom);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await renderFrames({
    composition,
    serveUrl,
    inputProps: props,
    imageFormat: "png",
    outputDir: dir,
    concurrency: renderBudget(cpus().length, 0.4).workers, // these tabs draw shapes and text, no video
    browserExecutable,
    chromiumOptions,
    onStart: () => {},
    onFrameUpdate: (done) => onProgress(done / composition.durationInFrames),
  });
  return join(dir, "element-*.png");
}

const GB = 2 ** 30;

/**
 * The memory other work could take right now without the Mac running out. macOS keeps this as a
 * percentage (the number Activity Monitor's memory pressure is drawn from); Node's own freemem()
 * counts only untouched pages there and reads close to zero on a healthy Mac.
 */
export function freeMemory(): number {
  if (process.platform === "darwin") {
    const r = spawnSync("/usr/sbin/sysctl", ["-n", "kern.memorystatus_level"], { encoding: "utf8", timeout: 2000 });
    const percent = Number(r.stdout);
    if (r.status === 0 && percent > 0 && percent <= 100) return (percent / 100) * totalmem();
    return totalmem() / 4; // can't tell: assume little
  }
  return process.availableMemory?.() ?? freemem();
}

/**
 * What a render may use right now. Each worker is a Chrome tab with its own decoder and frame
 * cache, so workers and caches are sized from the memory that is free at this moment, not from
 * what the Mac has: a render started while Chrome and other apps are open slows down instead of
 * pushing the Mac out of memory. 1.5 GB always stays with the rest of the Mac.
 */
export function renderBudget(maxWorkers: number, workerGB = 1) {
  const free = freeMemory();
  const spare = Math.max(0, free - 1.5 * GB);
  const cap = Math.max(1, Math.min(maxWorkers, Math.floor((totalmem() / GB) * (3 / 8) / workerGB)));
  const workers = Math.max(1, Math.min(cap, Math.floor(spare / (workerGB * GB))));
  const within = (n: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, n)));
  return {
    workers,
    /** True when even one worker is more than what is spare: the render goes on, as lightly as it can. */
    tight: spare < workerGB * GB,
    freeGB: free / GB,
    /** Each tab's own cache of decoded frames (Remotion's default is half the memory, per tab). */
    mediaCache: within(spare / workers / 3, 96 * 2 ** 20, 512 * 2 ** 20),
    /** The shared decoder's cache, for the videos that fall back to it. */
    offthreadCache: within(spare / 6, 128 * 2 ** 20, 512 * 2 ** 20),
  };
}

/**
 * macOS guards Desktop, Documents and Downloads: when the app is the one asking, Chrome's helper
 * processes may not read their own files there and crash ("icudtl.dat not found", "Target closed").
 * So Creatro runs a copy of Remotion's Chrome from ~/Library/Caches/Creatron, made once.
 */
export function chromeOutsideProtectedFolders(exe: string): string {
  const cache = join(homedir(), "Library", "Caches", "Creatron");
  if (process.platform !== "darwin" || !relative(cache, exe).startsWith("..")) return exe;
  const folder = dirname(exe);
  // Named by the folder and the build's time, so a newer Remotion Chrome gets a fresh copy.
  const target = join(cache, `${basename(folder)}-${Math.round(statSync(exe).mtimeMs)}`);
  const copy = join(target, basename(exe));
  if (!existsSync(copy)) {
    mkdirSync(cache, { recursive: true });
    const part = `${target}.part`; // a half-finished copy never looks like a finished one
    rmSync(part, { recursive: true, force: true });
    cpSync(folder, part, { recursive: true, verbatimSymlinks: true });
    renameSync(part, target);
  }
  return copy;
}
