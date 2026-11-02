// Renders the Remotion layer (motion/) as see-through PNG frames for the export to lay on top.
// PNG frames on every core are ~45x faster than encoding a see-through video. The templates
// are bundled once per run; Remotion fetches its own headless Chrome the first time (about
// 140 MB), which Creatron keeps in ~/Library/Caches/Creatron (see chromeOutsideProtectedFolders).
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderFrames, renderStill, selectComposition } from "@remotion/renderer";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { customFiles, customVersion, writeCustomEntry } from "./customcode.ts";
import type { OverlayProps } from "./motion.ts";
import { ROOT } from "./tools.ts";

const served = new Map<string, Promise<string>>();

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
  const composition = await selectComposition({ serveUrl, id: "Overlay", inputProps: props, browserExecutable });
  return { serveUrl, browserExecutable, composition };
}

/** One frame of the layer as a see-through PNG (the AI's own check of what it made). */
export async function renderOverlayStill(props: OverlayProps, frame: number, out: string, custom?: string): Promise<string> {
  const { serveUrl, browserExecutable, composition } = await browserAndComposition(props, custom);
  await renderStill({ composition, serveUrl, inputProps: props, frame, output: out, imageFormat: "png", browserExecutable, overwrite: true });
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
    concurrency: cpus().length,
    browserExecutable,
    onStart: () => {},
    onFrameUpdate: (done) => onProgress(done / composition.durationInFrames),
  });
  return join(dir, "element-*.png");
}

/**
 * macOS guards Desktop, Documents and Downloads: when the app is the one asking, Chrome's helper
 * processes may not read their own files there and crash ("icudtl.dat not found", "Target closed").
 * So Creatron runs a copy of Remotion's Chrome from ~/Library/Caches/Creatron, made once.
 */
function chromeOutsideProtectedFolders(exe: string): string {
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
