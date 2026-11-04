import "./env.ts";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { runAgent } from "../src/agent.ts";
import { analyze } from "../src/analyze.ts";
import { type AutoEditEvent, type AutoEditMarker, autoEdit, autoEditFix, cancelAutoEdit } from "../src/autoedit.ts";
import { compileCustom, customDir } from "../src/customcode.ts";
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

// Library: videos, music and sound effects, several at once.
ipcMain.handle("pick-library", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Video or audio", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "mp3", "wav", "m4a", "aac", "flac", "ogg"] }],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle(
  "import-video",
  safe(async (path: string) => {
    const analysis = await analyze(path, (m) => status(m.replace(/^analyze: /, "")));
    status("building timeline");
    // A voice recording (faceless video) has no picture to make thumbnails from.
    const thumbs = analysis.width ? await thumbnails(analysis) : { url: "", cols: 1, frameW: 0, frameH: 0, interval: 1, count: 0 };
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
        const picked = focus?.clips.length || focus?.broll || focus?.markers?.length ? focus : undefined;
        // Claude through your subscription works as an agent (any change, its own Remotion code);
        // other models fill in the edit plan through tools.
        const result = m?.startsWith("claude-code/")
          ? { ...(await runAgent(analysis, request, current, m, say, picked)), clips: new Map(), cost: 0 }
          : await makePlan(
              analysis, request, m, say, current,
              stockAvailable() ? searchStock : undefined,
              ytdlpAvailable() ? searchWeb : undefined,
              picked,
            );
        if ("notes" in result && result.notes) result.plan.notes = result.notes;
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

// The project's AI-written animations, compiled for the live preview.
ipcMain.handle("custom-code", safe(async (path: string) => compileCustom(customDir(path))));

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

// ---- Auto Edit: Claude Code makes the whole video (src/autoedit.ts) ----
// The job lives here, not in the window: the view can close or reload and pick it up again.
type AutoJob = { running: boolean; fixing: boolean; video: string; model: string; log: AutoEditEvent[]; progress?: AutoEditEvent; result?: unknown; error?: string };
let autoJob: AutoJob | undefined;
const autoEvent = (e: AutoEditEvent) => {
  if (autoJob) e.type === "progress" ? (autoJob.progress = e) : (autoJob.log = [...autoJob.log.slice(-300), e]);
  win.webContents.send("autoedit-event", e);
};
const withUrl = <T extends { final: string }>(r: T) => ({ ...r, url: `${mediaUrl(r.final)}&v=${Date.now()}` });
async function runAutoJob(job: Omit<AutoJob, "running" | "log">, work: () => Promise<{ final: string }>) {
  if (autoJob?.running) throw new Error("An Auto Edit is already running.");
  autoJob = { ...job, result: job.fixing ? autoJob?.result : undefined, running: true, log: [], error: undefined };
  win.webContents.send("autoedit-state", autoJob);
  try {
    autoJob.result = withUrl(await work());
  } catch (e) {
    autoJob.error = e instanceof Error ? e.message : String(e);
  }
  autoJob.running = false;
  autoJob.progress = undefined;
  win.webContents.send("autoedit-state", autoJob);
}

ipcMain.handle("autoedit-state", () => autoJob);
ipcMain.handle(
  "autoedit-start",
  safe(async (opts: { video: string; brief: string; reference?: string; model: string }) => {
    void runAutoJob({ fixing: false, video: opts.video, model: opts.model }, () => autoEdit(opts, autoEvent));
  }),
);
ipcMain.handle(
  "autoedit-fix",
  safe(async (opts: { video: string; session: string; model: string; message: string; markers: AutoEditMarker[] }) => {
    void runAutoJob({ fixing: true, video: opts.video, model: opts.model }, () =>
      autoEditFix(opts.video, opts.session, opts.model, opts.message, opts.markers, autoEvent),
    );
  }),
);
ipcMain.handle("autoedit-cancel", () => cancelAutoEdit());
ipcMain.handle("pick-media", async (_e, kind: "video" | "any") => {
  // Automated tests can't click the open dialog either.
  if (process.argv.includes("--creatron-debug") && process.env.CREATRON_PICK_PATH) return process.env.CREATRON_PICK_PATH;
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: kind === "video" ? "Video" : "Video or audio", extensions: ["mp4", "mov", "m4v", "mkv", "webm", ...(kind === "any" ? ["wav", "mp3", "m4a", "aac", "flac"] : [])] }],
  });
  return r.canceled ? undefined : r.filePaths[0];
});

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
