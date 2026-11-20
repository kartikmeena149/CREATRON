// Renders the Remotion layer (motion/) as see-through PNG frames for the export to lay on top.
// PNG frames on every core are ~45x faster than encoding a see-through video. The templates
// are bundled once per run; Remotion fetches its own headless Chrome the first time (about
// 140 MB), which Creatro keeps in ~/Library/Caches/Creatron (see chromeOutsideProtectedFolders).
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderFrames, renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync, rmSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { customFiles, customVersion, writeCustomEntry } from "./customcode.ts";
import type { OverlayProps } from "./motion.ts";
import { ROOT } from "./tools.ts";
import { chromeOutsideProtectedFolders, renderBudget } from "./machine.ts";

// The machine helpers live in machine.ts (no Remotion there, so the tool belt can load them cheaply).
export { chromeOutsideProtectedFolders, freeMemory, renderBudget } from "./machine.ts";

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
