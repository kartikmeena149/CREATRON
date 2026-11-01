import "./env.ts";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { analyze } from "../src/analyze.ts";
import { makePlan } from "../src/plan.ts";
import { render } from "../src/render.ts";
import type { EditPlan } from "../src/schema.ts";
import { snapEdges } from "../src/snap.ts";
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
    webPreferences: { preload: join(import.meta.dirname, "../preload/preload.cjs"), sandbox: false, backgroundThrottling: false },
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
  safe(async (path: string, request: string, current: EditPlan) => {
    const analysis = await analyze(path, () => {});
    const result = await makePlan(analysis, request, undefined, (m) => status(m.replace(/^plan: /, "")), current);
    status("");
    return { ...result, plan: snapEdges(result.plan, analysis) };
  }),
);

ipcMain.handle(
  "export",
  safe(async (path: string, plan: EditPlan) => {
    const r = await dialog.showSaveDialog(win, {
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

app.whenReady().then(() => {
  handleMedia();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => app.quit());
