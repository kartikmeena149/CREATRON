// Brings a Claude edit (a HyperFrames project: index.html + compositions + assets) into Creatro
// as layers with keyframes. The page is opened in a hidden window with the HyperFrames runtime,
// stepped through frame by frame (scenePage.ts), and written down as a scene (src/scene.ts) with
// its own copies of every picture, video, font and sound in work/scenes/<name>/.
import { BrowserWindow } from "electron";
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { inFolder, serveFiles } from "../src/fileServer.ts";
import { addFonts } from "../src/fontLibrary.ts";
import { type Detail, type Scene, toScene, voiceOf } from "../src/scene.ts";
import { ROOT, run } from "../src/tools.ts";
import { type CaptureOptions, type PageCapture, capturePage } from "./scenePage.ts";
import { type RemotionProject, remotionBundle, remotionProject } from "./remotionBundle.ts";

const RUNTIME_VERSION = "0.9.6";
const FPS = 30;

/** The page a path points at: a project folder's index.html, or an .html file itself. */
export function sceneEntry(path: string): string | undefined {
  if (remotionProject(path)) return path;
  if (existsSync(path) && statSync(path).isDirectory()) return existsSync(join(path, "index.html")) ? join(path, "index.html") : undefined;
  return /\.html?$/i.test(path) && existsSync(path) ? path : undefined;
}

/** The HyperFrames runtime the project was made with (from its package.json), else a known one. */
function runtimeVersion(folder: string): string {
  try {
    const pkg = readFileSync(join(folder, "package.json"), "utf8");
    return /hyperframes@(\d+\.\d+\.\d+)/.exec(pkg)?.[1] ?? RUNTIME_VERSION;
  } catch {
    return RUNTIME_VERSION;
  }
}

/** The runtime's code, downloaded once per version and kept in ~/Library/Caches/Creatron. */
async function runtimeCode(version: string): Promise<string> {
  const dir = join(homedir(), "Library", "Caches", "Creatron");
  const file = join(dir, `hyperframes-runtime-${version}.js`);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const res = await fetch(`https://cdn.jsdelivr.net/npm/@hyperframes/core@${version}/dist/hyperframe.runtime.iife.js`);
  if (!res.ok) throw new Error(`Couldn't download the HyperFrames runtime ${version} (${res.status}). Check your internet connection.`);
  const code = await res.text();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, code);
  return code;
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "claude-edit";

export type ImportedScene = { file: string; scene: Scene };

/** A page loaded and recorded: where its URLs point (origin → files) and what it recorded. */
type Captured = { cap: PageCapture; name: string; source: string; files: (url: URL) => string | undefined; origin: string };

const hiddenWindow = (width = 1080, height = 1920) => {
  const win = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true } });
  win.webContents.setAudioMuted(true);
  return win;
};

/** Steps the page through every frame, telling `status` how far it is. */
async function record(win: BrowserWindow, opts: CaptureOptions, status: (s: string) => void): Promise<PageCapture> {
  status("recording every frame");
  const timer = setInterval(async () => {
    const f = await win.webContents.executeJavaScript("window.__captureProgress || 0").catch(() => 0);
    status(`recording every frame ${Math.round(f * 100)}%`);
  }, 1000);
  try {
    return await win.webContents.executeJavaScript(`(${capturePage.toString()})(${JSON.stringify(opts)})`);
  } finally {
    clearInterval(timer);
  }
}

async function captureHyperFrames(path: string, entry: string, status: (s: string) => void): Promise<Captured> {
  const folder = dirname(entry);
  const name = existsSync(path) && statSync(path).isDirectory() ? basename(path) : basename(entry, extname(entry));
  status("opening the edit");
  const files = inFolder(folder);
  const server = await serveFiles(files);
  const win = hiddenWindow();
  try {
    await win.loadURL(`${server.origin}/${encodeURIComponent(basename(entry))}`);
    const size = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector("[data-composition-id]"); return r ? [Number(r.dataset.width) || 0, Number(r.dataset.height) || 0] : null; })()`);
    if (!size) throw new Error("No HyperFrames composition in that page (nothing has data-composition-id).");
    if (size[0] && size[1]) win.setContentSize(size[0], size[1]);
    status("loading its animation");
    await win.webContents.executeJavaScript(await runtimeCode(runtimeVersion(folder)));
    const ready = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 300 && !window.__renderReady; i++) await new Promise((r) => setTimeout(r, 100));
      await document.fonts.ready;
      return Boolean(window.__renderReady && window.__player);
    })()`);
    if (!ready) throw new Error("The edit didn't finish loading (the HyperFrames runtime never became ready).");
    return { cap: await record(win, { fps: FPS, maxLayers: 3000 }, status), name, source: folder, files, origin: server.origin };
  } finally {
    win.destroy();
    server.close();
  }
}

// Set before the bundle's own code runs, as Remotion's renderer does; fonts made in code (Remotion's
// Google fonts load through FontFace) are noted so the scene can carry them.
const REMOTION_SETUP = `<script>
window.remotion_inputProps = "{}"; window.remotion_initialFrame = 0; window.remotion_attempt = 1;
window.remotion_audioEnabled = true; window.remotion_videoEnabled = true; window.remotion_logLevel = "error";
window.remotion_isMainTab = true; window.remotion_puppeteerTimeout = 120000;
window.remotion_broadcastChannel = new BroadcastChannel("remotion-video-frame-extraction");
window.process = window.process || { env: {} }; window.process.env.NODE_ENV = "production";
window.alert = () => {}; window.confirm = () => false;
(() => {
  // Fonts fetched as bytes (Remotion's Google fonts) are matched back to the URL they came from.
  const from = new WeakMap();
  const buffer = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = function () {
    return buffer.call(this).then((b) => (from.set(b, this.url), b));
  };
  const Face = window.FontFace; window.__fontFaces = [];
  window.FontFace = function (family, source, desc) {
    const face = new Face(family, source, desc);
    const url = typeof source === "string" ? source : from.get(source) ? 'url("' + from.get(source) + '")' : null;
    if (url) window.__fontFaces.push({ face, family, source: url, desc: desc || {} });
    return face;
  };
  window.FontFace.prototype = Face.prototype;
})();
</script>`;

async function captureRemotion(project: RemotionProject, status: (s: string) => void): Promise<Captured> {
  status("building the Remotion project");
  const out = await remotionBundle(project, REMOTION_SETUP);
  const pub = join(project.root, "public");
  // The bundle's own files, and the project's public/ folder as staticFile() asks for it.
  const files = (url: URL) => {
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith("/public/")) return inFolder(pub)(new URL(p.slice("/public".length), url));
    return inFolder(out)(url);
  };
  const server = await serveFiles(files);
  const win = hiddenWindow();
  try {
    status("opening the edit");
    await win.loadURL(`${server.origin}/index.html`);
    const comp = await win.webContents.executeJavaScript(`(async () => {
      const ready = async () => {
        for (let i = 0; i < 6000 && window.remotion_renderReady !== true; i++) {
          if (window.remotion_cancelledError) throw new Error(String(window.remotion_cancelledError).split("\\n")[0]);
          await new Promise((r) => setTimeout(r, 10));
        }
      };
      for (let i = 0; i < 300 && !window.remotion_setBundleMode; i++) await new Promise((r) => setTimeout(r, 50));
      if (!window.remotion_setBundleMode) throw new Error("This doesn't look like a Remotion project (no registerRoot).");
      window.remotion_setBundleMode({ type: "evaluation" });
      await ready();
      const all = await window.getStaticCompositions();
      const pick = all.filter((c) => c.durationInFrames > 1).sort((a, b) => b.durationInFrames - a.durationInFrames)[0];
      if (!pick) throw new Error("The project has no video composition (only stills).");
      const c = await window.remotion_calculateComposition(pick.id);
      window.remotion_setBundleMode({
        type: "composition", compositionName: c.id, serializedResolvedPropsWithSchema: c.serializedResolvedPropsWithCustomSchema,
        compositionDurationInFrames: c.durationInFrames, compositionFps: c.fps, compositionHeight: c.height, compositionWidth: c.width,
        compositionDefaultCodec: c.defaultCodec, compositionDefaultOutName: c.defaultOutName, compositionDefaultVideoImageFormat: c.defaultVideoImageFormat,
        compositionDefaultPixelFormat: c.defaultPixelFormat, compositionDefaultProResProfile: c.defaultProResProfile, compositionDefaultSampleRate: c.defaultSampleRate,
      });
      await ready();
      return { id: c.id, fps: c.fps, frames: c.durationInFrames, width: c.width, height: c.height };
    })()`);
    win.setContentSize(comp.width, comp.height);
    const cap = await record(win, { fps: comp.fps, maxLayers: 3000, remotion: comp }, status);
    return { cap, name: basename(project.root), source: project.root, files, origin: server.origin };
  } finally {
    win.destroy();
    server.close();
  }
}

/**
 * Imports the Claude edit at `path`: a HyperFrames project (folder or .html) or a Remotion project
 * (its folder, or any file in it). `detail` sets how closely keyframes follow the motion (light =
 * fewest keys, exact = every frame).
 */
export async function importScene(path: string, detail: Detail, status: (s: string) => void): Promise<ImportedScene> {
  const remotion = remotionProject(path);
  const entry = remotion ? undefined : sceneEntry(path);
  if (!remotion && !entry) throw new Error("That isn't a Claude edit: pick a HyperFrames project (with index.html) or a Remotion project folder.");
  const { cap, name, source, files, origin } = remotion ? await captureRemotion(remotion, status) : await captureHyperFrames(path, entry!, status);

  status("copying pictures, videos and sounds");
  const dir = join(ROOT, "work", "scenes", `${slug(name)}-${Date.now().toString(36)}`);
  mkdirSync(join(dir, "assets"), { recursive: true });
  const names = new Map<string, string>();
  const taken = new Set<string>();
  const urls = new Set<string>();
  for (const l of cap.layers) {
    if (l.src) urls.add(l.src);
    for (const m of (l.style["background-image"] ?? "").matchAll(/url\("?([^")]+)"?\)/g)) urls.add(m[1]);
  }
  for (const f of cap.fonts) for (const m of f.matchAll(/url\("([^"]+)"\)/g)) urls.add(m[1]);
  for (const a of cap.audio) urls.add(a.src);
  for (const url of urls) {
    if (url.startsWith("data:")) continue;
    const first = basename(decodeURIComponent(new URL(url).pathname)) || "file";
    let base = first;
    for (let n = 2; taken.has(base); n++) base = first.replace(/(\.\w+)?$/, (ext) => `-${n}${ext}`);
    const out = join(dir, "assets", base);
    try {
      if (url.startsWith(origin)) {
        const src = files(new URL(url));
        if (!src || !existsSync(src)) continue;
        try {
          linkSync(src, out);
        } catch {
          copyFileSync(src, out);
        }
      } else if (/^https?:/.test(url)) {
        const res = await fetch(url);
        if (!res.ok) continue;
        writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      } else continue;
    } catch {
      continue;
    }
    taken.add(base);
    names.set(url, `assets/${base}`);
  }

  const scene: Scene = { ...toScene(cap, { name, source, detail, asset: (u) => names.get(u) }), kind: remotion ? "remotion" : "hyperframes", captionStyle: captionStyleOf(source) };
  // Sounds: their real length from the file (a clip can't run past its end).
  for (const a of cap.audio) {
    const file = names.get(a.src);
    if (!file) continue;
    const length = await mediaLength(join(dir, file));
    const duration = Math.min(a.duration, length ? length - a.offset : a.duration, cap.duration - a.start);
    if (duration > 0.05) scene.audio.push({ file, name: a.name, at: a.start, offset: a.offset, duration: Math.round(duration * 1000) / 1000, volume: a.volume });
  }
  const file = join(dir, "scene.json");
  writeFileSync(file, JSON.stringify(scene));
  // Fonts Creatro didn't have become Creatro fonts (font lists, captions, export).
  addFonts(scene.fonts, dir);
  status("");
  return { file, scene };
}

/** The caption style a project's code uses (Kartik's DocCaptions, SpecStack…), read from its source files. */
function captionStyleOf(root: string): Scene["captionStyle"] {
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 3 || !existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "public" || e.name === "assets") continue;
      if (e.isDirectory()) walk(join(d, e.name), depth + 1);
      else if (/\.(tsx?|jsx?|html)$/.test(e.name)) files.push(join(d, e.name));
    }
  };
  walk(root, 0);
  const code = files.slice(0, 200).map((f) => readFileSync(f, "utf8")).join("\n");
  if (/DocCaption/.test(code)) return "doc";
  if (/SpecStack|SpecCaption/.test(code)) return "spec";
  if (/Kinetic/.test(code)) return "kinetic";
  if (/GlowCaption|glow-caption/i.test(code)) return "glow";
  return undefined;
}

async function mediaLength(file: string): Promise<number> {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    return Number(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

export function loadScene(file: string): Scene {
  return JSON.parse(readFileSync(file, "utf8")) as Scene;
}

/**
 * A blank main track the length and size of the scene (black), for a tab that has no video yet:
 * the edit then sits on top of it like any other project. Its sound is the edit's voiceover (when
 * it has one), so Creatro transcribes it and its captions work as on any video.
 */
export async function sceneBase(file: string): Promise<string> {
  const scene = loadScene(file);
  const out = join(dirname(file), "base.mp4");
  if (existsSync(out)) return out;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const d = scene.duration.toFixed(3);
  const voice = voiceOf(scene);
  const sound = voice
    ? ["-ss", voice.offset.toFixed(3), "-t", voice.duration.toFixed(3), "-i", join(dirname(file), voice.file)]
    : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
  const delay = Math.round((voice?.at ?? 0) * 1000);
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `color=c=black:s=${even(scene.width)}x${even(scene.height)}:r=${scene.fps}:d=${d}`,
    ...sound,
    "-filter_complex", `[1:a]aresample=48000,${voice ? `volume=${voice.volume},adelay=${delay}:all=1,` : ""}apad[a]`,
    "-map", "0:v", "-map", "[a]",
    "-t", d, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", out,
  ]);
  return out;
}
