// Renders the Remotion layer (motion/) as see-through PNG frames for the export to lay on top.
// PNG frames on every core are ~45x faster than encoding a see-through video. The templates
// are bundled once per run; Remotion fetches its own headless Chrome the first time (about
// 140 MB), which Creatron keeps in ~/Library/Caches/Creatron (see chromeOutsideProtectedFolders).
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderFrames, selectComposition } from "@remotion/renderer";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import type { OverlayProps } from "./motion.ts";
import { ROOT } from "./tools.ts";

let served: Promise<string> | undefined;

/** Writes frames as dir/element-NNN.png (one per output frame) and returns the glob ffmpeg reads them with. */
export async function renderOverlay(props: OverlayProps, dir: string, onProgress: (fraction: number) => void = () => {}): Promise<string> {
  served ??= bundle({ entryPoint: join(ROOT, "motion", "index.ts") }).catch((e) => {
    served = undefined; // try bundling again next time
    throw e;
  });
  const serveUrl = await served;
  const browser = await ensureBrowser();
  if (!("path" in browser)) throw new Error("Couldn't download the browser Remotion draws animations with. Check your internet connection and export again.");
  const browserExecutable = chromeOutsideProtectedFolders(browser.path);
  const composition = await selectComposition({ serveUrl, id: "Overlay", inputProps: props, browserExecutable });
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
