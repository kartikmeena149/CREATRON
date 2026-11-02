import "./env.ts";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { analyze } from "../src/analyze.ts";
import { freeFallbacks, listModels } from "../src/models.ts";
import { type Focus, makePlan } from "../src/plan.ts";
import { render } from "../src/render.ts";
import type { EditPlan } from "../src/schema.ts";
import { snapEdges } from "../src/snap.ts";
import { fetchBroll, searchStock, stockAvailable } from "../src/stock.ts";
import { run } from "../src/tools.ts";
import { downloadLink, linkInfo, searchWeb, ytdlpAvailable } from "../src/webvideo.ts";
import {
  cloneVoice,
  deleteVoice,
  generateVoiceover,
  importSkillVoice,
  listVoices,
  stopStaleVoiceEngine,
  stopVoiceEngine,
} from "../src/voice.ts";
import { handleMedia, mediaUrl, registerMediaScheme, thumbnails, waveform } from "./media.ts";

registerMediaScheme();
let win: BrowserWindow;

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0d0e11",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    // No background throttling: playback and export progress keep updating behind other windows.
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.cjs"),
      sandbox: false,
      backgroundThrottling: false,
      additionalArguments: process.argv.includes("--creatron-debug") ? ["--creatron-debug"] : [],
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  // A video passed on the command line (or via Open With) opens straight away.
  const video = process.argv.slice(1).find((a) => /\.(mp4|mov|m4v|mkv|webm)$/i.test(a) && existsSync(a));
  if (video) win.webContents.once("did-finish-load", () => win.webContents.send("open-path", video));
}

const status = (text: string) => win.webContents.send("status", text);
// Errors go back as values so the UI can show them instead of crashing the call.
const safe =
  <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
  async (_e: unknown, ...a: A) => {
    try {
      return { ok: true as const, value: await fn(...a) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  };

ipcMain.handle("pick-video", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "mkv", "webm"] }],
  });
  return r.canceled ? undefined : r.filePaths[0];
});

ipcMain.handle(
  "import-video",
  safe(async (path: string) => {
    const analysis = await analyze(path, (m) => status(m.replace(/^analyze: /, "")));
    status("building timeline");
    const thumbs = await thumbnails(analysis);
    status("");
    return { analysis, videoUrl: mediaUrl(analysis.source), thumbs, wave: waveform(analysis) };
  }),
);

ipcMain.handle(
  "ai-edit",
  safe(async (path: string, request: string, current: EditPlan, model?: string, focus?: Focus) => {
    const analysis = await analyze(path, () => {});
    const say = (m: string) => status(m.replace(/^plan: /, ""));
    // Free models share capacity and are often busy: fall through to the next free one.
    const tries = [model, ...(model?.endsWith(":free") ? freeFallbacks(model, (await listModels()).models).slice(0, 3) : [])];
    let lastError: unknown;
    for (const m of tries) {
      try {
        const result = await makePlan(
          analysis, request, m, say, current,
          stockAvailable() ? searchStock : undefined,
          ytdlpAvailable() ? searchWeb : undefined,
          focus?.clips.length || focus?.broll ? focus : undefined,
        );
        // Snapping moves cuts onto quiet spots. Only cuts the AI just made move: an edge that was
        // already on the timeline stays put (so "mute clip 2" changes the volume and nothing else).
        const starts = new Set(current.segments.map((s) => s.start));
        const ends = new Set(current.segments.map((s) => s.end));
        const snapped = snapEdges(result.plan, analysis);
        snapped.segments = snapped.segments.map((s, i) => {
          const orig = result.plan.segments[i];
          return { ...s, start: starts.has(orig.start) ? orig.start : s.start, end: ends.has(orig.end) ? orig.end : s.end };
        });
        const plan = await fetchBroll(snapped, result.clips, say);
        status("");
        return { ...result, clips: undefined, plan };
      } catch (e) {
        lastError = e;
        // Only "busy" is worth retrying elsewhere; the daily free cap covers every free model.
        if (!/OpenRouter (429|503)/.test(String(e)) || /per-day/.test(String(e))) break;
      }
    }
    status("");
    throw lastError;
  }),
);

ipcMain.handle("models", safe(async () => listModels()));

// ---- Video from links (yt-dlp) ----
ipcMain.handle(
  "link-info",
  safe(async (url: string) => {
    const { captions: _, chapters: __, ...info } = await linkInfo(url);
    return info;
  }),
);

/** Downloads a link (or a from-to part of it). "broll" files go with the other B-roll clips. */
ipcMain.handle(
  "link-download",
  safe(async (opts: { url: string; id: string; site: string; start?: number; end?: number; purpose: "main" | "broll" }) => {
    const file = await downloadLink(
      opts.url,
      { id: opts.id, site: opts.site.toLowerCase(), start: opts.start, end: opts.end, dir: opts.purpose === "broll" ? join(app.getAppPath(), "work", "broll") : undefined },
      (f) => win.webContents.send("link-progress", f),
    );
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    return { file, length: Number(stdout.trim()) || (opts.end ?? 0) - (opts.start ?? 0) };
  }),
);

ipcMain.handle(
  "export",
  safe(async (path: string, plan: EditPlan) => {
    // Automated tests (--creatron-debug) can't click the save dialog, so they name the file instead.
    const testPath = process.argv.includes("--creatron-debug") ? process.env.CREATRON_EXPORT_PATH : undefined;
    const r = testPath
      ? { canceled: false, filePath: testPath }
      : await dialog.showSaveDialog(win, {
          defaultPath: `${basename(path, extname(path))}-creatron.mp4`,
          filters: [{ name: "MP4 video", extensions: ["mp4"] }],
        });
    if (r.canceled || !r.filePath) return undefined;
    const analysis = await analyze(path, () => {});
    const out = await render(plan, analysis, r.filePath, (m) => status(m.replace(/^(render|loudness): /, "")), (f) =>
      win.webContents.send("export-progress", f),
    );
    status("");
    return out;
  }),
);

ipcMain.handle("reveal", (_e, path: string) => shell.showItemInFolder(path));

// ---- Voice Lab ----
ipcMain.handle("voices", safe(async () => listVoices().map((v) => ({ ...v, url: v.file ? mediaUrl(v.file) : undefined }))));

ipcMain.handle("pick-audio", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Audio or video", extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg", "mp4", "mov", "m4v", "webm"] }],
  });
  return r.canceled ? undefined : r.filePaths[0];
});

ipcMain.handle(
  "clone-voice",
  safe(async (opts: { source: string; start: number; duration: number; name: string; consent: boolean }) => cloneVoice(opts)),
);

ipcMain.handle("delete-voice", safe(async (id: string) => deleteVoice(id)));

ipcMain.handle(
  "generate-voiceover",
  safe(async (opts: { text: string; voiceId: string; speed: number }) => {
    const r = await generateVoiceover(opts, status);
    status("");
    return { ...r, url: mediaUrl(r.file) };
  }),
);

app.whenReady().then(() => {
  handleMedia();
  importSkillVoice(); // your voice from the my-voiceover skill shows up in the Voice Lab
  stopStaleVoiceEngine(); // one left behind by a crash or force quit
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => app.quit());
// Never leave the voice engine running: stop it on every way the app can end.
app.on("before-quit", stopVoiceEngine);
app.on("will-quit", stopVoiceEngine);
process.on("exit", stopVoiceEngine);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => (stopVoiceEngine(), app.exit(0)));
