import "./env.ts";
import { BrowserWindow, app, dialog, ipcMain, shell, systemPreferences } from "electron";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { type StoryboardReview, autoEditDir, cancelAutoEdit, planDir, planStoryboard, readPlanInfo, renamePlan, reopenPlan } from "../src/autoedit.ts";
import { Storyboard, scenesOf } from "../src/storyboard.ts";
import { withDrawings } from "../src/storyboardFiles.ts";
import { basename, extname, join, relative, resolve } from "node:path";
import { runAgent } from "../src/agent.ts";
import { isDocument, readDocument } from "../src/documents.ts";
import { type ChatEvent, chat, stop as stopChat } from "../src/chat.ts";
import { analyze } from "../src/analyze.ts";
import { runFullEdit, stopFullEdit } from "../src/fulledit.ts";
import { compileCustom, customDir } from "../src/customcode.ts";
import { freeFallbacks, listModels } from "../src/models.ts";
import { type AgentId, INSTALL_COMMAND, agentState, cancel, enabled, install, openRouterKey, setEnabled, setOpenRouterKey, signIn, signOut } from "../src/agents.ts";
import type { Connections, FullEditAsk } from "../src/chatTypes.ts";
import { type Attachment, type Focus, enhancePrompt, makePlan } from "../src/plan.ts";
import { render } from "../src/render.ts";
import type { EditPlan } from "../src/schema.ts";
import type { ExportOptions } from "../src/exportOptions.ts";
import { snapEdges } from "../src/snap.ts";
import { fetchBroll, searchStock, stockAvailable } from "../src/stock.ts";
import { type Sfx, downloadSfx, searchSfx } from "../src/sfx.ts";
import { ROOT, run } from "../src/tools.ts";
import { dictate } from "../src/dictation.ts";
import { personCutout } from "../src/person.ts";
import { downloadAudio, downloadLink, linkInfo, searchWeb, ytdlpAvailable } from "../src/webvideo.ts";
import {
  cloneVoice,
  deleteVoice,
  generateVoiceover,
  importSkillVoice,
  listVoices,
  previewVoice,
  deleteVoiceoverFile,
  type VoiceLanguage,
  stopStaleVoiceEngine,
  stopVoiceEngine,
} from "../src/voice.ts";
import { importScene, loadScene, sceneBase, sceneEntry } from "./sceneImport.ts";
import { remotionProject } from "./remotionBundle.ts";
import { libraryFonts } from "../src/fontLibrary.ts";
import { addEffectsFrom, libraryEffects } from "../src/effectLibrary.ts";
import type { Detail } from "../src/scene.ts";
import { fileThumbnails, handleMedia, mediaUrl, registerMediaScheme, thumbnails, waveform } from "./media.ts";

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
    trafficLightPosition: { x: 14, y: 17 }, // the buttons centred on the 48 pt top bar (.app in styles.css)
    // No background throttling: playback and export progress keep updating behind other windows.
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.cjs"),
      sandbox: false,
      backgroundThrottling: false,
      additionalArguments: process.argv.includes("--creatron-debug") ? ["--creatron-debug"] : [],
    },
  });
  // In full screen macOS hides the window buttons: the top bar gives their space back to the logo.
  win.on("enter-full-screen", () => send("full-screen", true));
  win.on("leave-full-screen", () => send("full-screen", false));
  win.webContents.on("did-finish-load", () => send("full-screen", win.isFullScreen()));
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  // A video passed on the command line (or via Open With) opens straight away.
  const video = process.argv.slice(1).find((a) => /\.(mp4|mov|m4v|mkv|webm)$/i.test(a) && existsSync(a));
  if (video) win.webContents.once("did-finish-load", () => send("open-path", video));
  // Closing the window quits Creatro: while an export runs, ask first (it would stop the export).
  win.on("close", (e) => {
    if (!exportsRunning) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Keep exporting", "Quit and stop the export"],
      defaultId: 0,
      cancelId: 0,
      message: "Your video is still exporting",
      detail: "Quitting now stops the export and the video won't be saved.",
    });
    if (choice === 0) e.preventDefault();
  });
}

/** Exports in progress (closing the window asks first while one runs). */
let exportsRunning = 0;
/** A message to the window. Work that outlives it (an export, Claude) mustn't crash when it's gone. */
function send(channel: string, value: unknown) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, value);
}
const status = (text: string) => send("status", text);
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
/** Files for the AI: media to use, or a storyboard, script or notes to follow. */
ipcMain.handle("pick-attachments", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Media, storyboards and notes", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "mp3", "wav", "m4a", "aac", "flac", "ogg", "png", "jpg", "jpeg", "webp", "gif", "xlsx", "csv", "tsv", "txt", "md", "json", "docx", "doc", "rtf", "pages", "pdf"] },
    ],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle("pick-library", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Video, audio or photo", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "mp3", "wav", "m4a", "aac", "flac", "ogg", "png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
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

/** A file attached to an AI request: video or sound, and its length. */
async function describeAttachment(path: string): Promise<Attachment> {
  // Storyboards, scripts and notes go to the AI as text.
  if (isDocument(path)) return { path, name: path.split("/").pop() ?? path, kind: "document", seconds: 0, text: await readDocument(path) };
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path]);
  const info = JSON.parse(stdout);
  const video = (info.streams ?? []).some((s: { codec_type: string }) => s.codec_type === "video") && !/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(path);
  return { path, name: path.split("/").pop() ?? path, kind: video ? "video" : "audio", seconds: Number(info.format?.duration) || 0 };
}

ipcMain.handle(
  "person-cutout",
  safe(async (path: string) => {
    const { cutout } = await personCutout(path, (m) => status(m));
    status("");
    return { cutoutUrl: mediaUrl(cutout) };
  }),
);

ipcMain.handle(
  "enhance-prompt",
  safe(async (request: string, model: string, path?: string) => enhancePrompt(request, model, path ? await analyze(path, () => {}) : undefined)),
);

/** The live chat with Claude (src/chat.ts): events stream to the window as "chat-event". */
ipcMain.handle(
  "chat-send",
  safe(async (path: string, message: string, current: EditPlan, model: string, focus?: Focus, answer?: boolean, library?: string[]) => {
    const analysis = await analyze(path, () => {});
    if (focus?.attachments?.length) focus.attachments = await Promise.all(focus.attachments.map((a) => describeAttachment(a.path)));
    let handoff: FullEditAsk | undefined;
    const emit = (event: ChatEvent) => {
      // Claude handed the request to the full edit: run it below, in the same chat turn.
      if (event.type === "handoff") return void (handoff = event.ask);
      // Like any AI edit, only cuts Claude just made snap onto quiet spots.
      if (event.type === "done" && event.plan) event = { ...event, plan: keepEdges(snapEdges(event.plan, analysis), event.plan, current) };
      send("chat-event", { path, event });
    };
    await chat(analysis, message, current, model, emit, { focus, answer });
    if (!handoff) return;
    try {
      // Storyboard first: shown in the window, the edit waits for the answer (storyboard-answer below).
      const review: StoryboardReview = (board, dir, round, drafts, said) =>
        new Promise((resolve) => {
          boardAnswers.set(path, { resolve, dir });
          emit({ type: "storyboard", board, dir, round, video: path, drafts, said });
        });
      const result = await runFullEdit(path, handoff, model.replace(/^claude-code\//, ""), emit, { clips: library, review });
      emit({ type: "result", result: { ...result, url: `${mediaUrl(result.final)}&v=${Date.now()}` } });
      emit({ type: "text", delta: plainNotes(result.notes) || "Done." });
      emit({ type: "done", changed: false });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // Stopped by the user: the chat already shows the turn as stopped, so nothing more to say.
      if (!/^Stopped/.test(error)) emit({ type: "error", error: `The full edit didn't finish: ${error}` });
    }
  }),
);
ipcMain.handle("chat-stop", (_e, path: string) => (boardAnswers.delete(path), stopFullEdit(path), stopChat(path)));

/** Storyboards waiting for the user, by video: their answer lets the full edit go on (or redraw). */
const boardAnswers = new Map<string, { resolve: (answer: Awaited<ReturnType<StoryboardReview>>) => void; dir: string }>();
ipcMain.handle("storyboard-answer", (_e, video: string, answer: { approve: boolean; board: unknown; changes?: string; drawings?: Record<string, string>; only?: string[] }) => {
  const waiting = boardAnswers.get(video);
  if (!waiting) return false;
  const parsed = Storyboard.safeParse(answer.board);
  if (!parsed.success) return false;
  boardAnswers.delete(video);
  const board = withDrawings(parsed.data, waiting.dir, answer.drawings ?? {});
  const only = Array.isArray(answer.only) ? answer.only.filter((id): id is string => typeof id === "string") : undefined;
  waiting.resolve(answer.approve ? { approve: true, board } : { approve: false, board, changes: answer.changes ?? "", only: only?.length ? only : undefined });
  return true;
});

/**
 * The Storyboard creator: a storyboard from a script (and the user's assets) before anything is
 * filmed. Events stream to the window as "plan-event"; the board waits for its answer like a full
 * edit's (storyboard-answer above), keyed "plan:<folder>".
 */
/** The storyboard being made or shown from the creator: its key, and whether Claude is working or it waits for the user. */
let planning: { key: string; phase: "drafting" | "waiting"; close?: () => void; quiet?: boolean } | undefined;

function runPlan(dir: string, job: (review: StoryboardReview, emit: (e: unknown) => void) => Promise<{ dir: string }>) {
  const key = `plan:${dir}`;
  if (planning?.phase === "drafting") throw new Error("Claude is still working on a storyboard: wait for it, or stop it first.");
  // One waiting for an answer is simply put away (it stays saved), and goes quiet: the same
  // storyboard may be opened again right now, and its old "stopped" mustn't reach the new one.
  if (planning) (planning.quiet = true), planning.close?.();
  const me: NonNullable<typeof planning> = { key, phase: "drafting" };
  planning = me;
  const emit = (event: unknown) => !me.quiet && send("plan-event", { key, event });
  const review: StoryboardReview = (board, dir, round, drafts, said) =>
    new Promise((resolve, reject) => {
      me.phase = "waiting";
      me.close = () => reject(new Error("Stopped."));
      boardAnswers.set(key, { resolve: (a) => ((me.phase = "drafting"), (me.close = undefined), resolve(a)), dir });
      emit({ type: "storyboard", board, dir, round, video: key, drafts, said });
    });
  void job(review, emit)
    .then(({ dir }) => emit({ type: "done", dir }))
    .catch((e) => emit({ type: "error", error: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      boardAnswers.delete(key);
      if (planning === me) planning = undefined;
    });
  return { key, dir };
}
const planModel = (m: string) => (m.startsWith("claude-code/") ? m.slice("claude-code/".length) : "sonnet");

ipcMain.handle("plan-start", safe(async (req: { title?: string; script: string; direction?: string; format: Storyboard["format"]; assets: string[]; model: string }) => {
  if (!req.script.trim()) throw new Error("Write or paste the script first.");
  const scenes = scenesOf(req.script).length;
  if (scenes < 3) throw new Error(`The script has ${scenes} scene${scenes === 1 ? "" : "s"}: put each scene on its own line (at least 3).`);
  const dir = planDir(req.title || req.script.split(/\s+/).slice(0, 6).join(" "));
  return runPlan(dir, (review, emit) => planStoryboard({ ...req, model: planModel(req.model), review }, emit, dir));
}));
/** A saved storyboard opened again: drawing, Redraw and Approve, with Claude where it left off. */
ipcMain.handle("plan-open", safe(async (dir: string, model: string) => {
  if (!dir.startsWith(join(ROOT, "work", "storyboards"))) throw new Error("That isn't a storyboard from the Storyboard creator.");
  return runPlan(dir, (review, emit) => reopenPlan(dir, planModel(readPlanInfo(dir).model ?? model), review, emit));
}));
ipcMain.handle("plan-stop", () => {
  if (!planning) return;
  boardAnswers.delete(planning.key);
  if (planning.phase === "waiting") planning.close?.();
  else cancelAutoEdit();
});
/** Only folders the creator made: work/storyboards/<one folder>. */
const isPlanDir = (dir: string) => {
  const root = join(ROOT, "work", "storyboards");
  const rel = relative(root, resolve(dir));
  return Boolean(rel) && !rel.startsWith("..") && !rel.includes("/") && existsSync(join(root, rel, "notes"));
};
ipcMain.handle("plan-rename", safe(async (dir: string, title: string) => {
  if (!isPlanDir(dir)) throw new Error("That isn't a storyboard from the Storyboard Creator.");
  if (!title.trim()) throw new Error("Give it a name.");
  renamePlan(dir, title);
}));
/** A storyboard to the Trash (it can be put back from there). One that's open is put away first. */
ipcMain.handle("plan-delete", safe(async (dir: string) => {
  if (!isPlanDir(dir)) throw new Error("That isn't a storyboard from the Storyboard Creator.");
  if (planning?.key === `plan:${dir}`) {
    if (planning.phase === "drafting") throw new Error("Claude is working on this storyboard: stop it first.");
    planning.quiet = true;
    planning.close?.();
    boardAnswers.delete(planning.key);
  }
  await shell.trashItem(dir);
}));

/** Every storyboard made from a script, newest first: what the creator's list shows. */
ipcMain.handle("plans-list", () => {
  const root = join(ROOT, "work", "storyboards");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((dir) => existsSync(join(dir, "notes", "storyboard.json")))
    .flatMap((dir) => {
      const parsed = Storyboard.safeParse(JSON.parse(readFileSync(join(dir, "notes", "storyboard.json"), "utf8")));
      if (!parsed.success) return [];
      const board = parsed.data;
      const info = readPlanInfo(dir);
      const pdf = existsSync(join(dir, "Export")) ? readdirSync(join(dir, "Export")).find((f) => f.endsWith(".pdf")) : undefined;
      const seconds = board.shots.reduce((a, x) => Math.max(a, x.to), 0);
      return [{
        dir, title: info.title || board.title, format: board.format, shots: board.shots.length, seconds,
        updated: statSync(join(dir, "notes", "storyboard.json")).mtimeMs, approved: Boolean(info.approved),
        pdf: pdf ? join(dir, "Export", pdf) : undefined, open: planning?.key === `plan:${dir}`, board,
      }];
    })
    .sort((a, b) => b.updated - a.updated);
});
/** A script file (Word, PDF, text…) as plain text, for the Storyboard creator. */
ipcMain.handle("read-script", safe(async (path: string) => (isDocument(path) ? readDocument(path) : readFileSync(path, "utf8"))));

/** Whether a storyboard is waiting for this video's answer (after a reload of the window, say). */
ipcMain.handle("storyboard-waiting", (_e, video: string) => boardAnswers.has(video));

/**
 * The mic for dictation: asks macOS once (the system's own prompt). "denied" means it was turned
 * off in System Settings, which only the user can turn back on: the app says where.
 */
ipcMain.handle("mic-access", async () => {
  if (process.platform !== "darwin") return "granted";
  const now = systemPreferences.getMediaAccessStatus("microphone");
  if (now === "granted" || now === "denied" || now === "restricted") return now;
  return (await systemPreferences.askForMediaAccess("microphone")) ? "granted" : "denied";
});
ipcMain.handle("open-mic-settings", () => shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"));
/** What was said into the mic (a 16 kHz mono WAV), as text: transcribed on this Mac. */
ipcMain.handle("dictate", safe(async (wav: Uint8Array) => dictate(wav)));

/** One frame of a video (or a picture) as a small JPEG data URL, for the storyboard's sketches. Null without a picture. */
const frameCache = new Map<string, string | null>();
let frameCount = 0;
ipcMain.handle("frame-at", async (_e, file: string, seconds: number, width = 360) => {
  const key = `${file}|${seconds.toFixed(2)}|${width}`;
  if (frameCache.has(key)) return frameCache.get(key);
  // Its own file: many frames load at once, and a shared name let them delete each other's.
  const out = join(app.getPath("temp"), `creatro-frame-${process.pid}-${++frameCount}.jpg`);
  let url: string | null = null;
  try {
    const still = /\.(png|jpe?g|webp|gif|avif)$/i.test(file);
    await run("ffmpeg", ["-y", "-v", "error", ...(still ? [] : ["-ss", Math.max(0, seconds).toFixed(2)]), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", out]);
    url = `data:image/jpeg;base64,${readFileSync(out).toString("base64")}`;
    rmSync(out, { force: true });
  } catch {
    url = null; // audio only, or no such moment: the sketch draws without a picture
  }
  frameCache.set(key, url);
  return url;
});

/** The storyboard as a PDF in the project's Export/ folder: the page HTML is made by the app. */
ipcMain.handle("storyboard-pdf", safe(async (dir: string, html: string, name: string) => {
  const page = new BrowserWindow({ show: false, width: 1400, height: 990, webPreferences: { offscreen: true } });
  // From a file: with its sketches the page is several MB, past what a data: URL may hold.
  const file = join(app.getPath("temp"), `creatro-storyboard-${process.pid}-${Date.now()}.html`);
  writeFileSync(file, html);
  try {
    await page.loadFile(file);
    await new Promise((r) => setTimeout(r, 400)); // fonts and images settle
    const pdf = await page.webContents.printToPDF({ pageSize: "A4", landscape: true, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    const out = join(dir, "Export", `${name.replace(/[^\w .-]+/g, "").trim() || "Storyboard"} - Storyboard.pdf`);
    mkdirSync(join(dir, "Export"), { recursive: true });
    writeFileSync(out, pdf);
    return out;
  } finally {
    page.destroy();
    rmSync(file, { force: true });
  }
}));

/** Claude's summary without markdown marks (**bold**, `code`, # headings, bullets). */
const plainNotes = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^#+\s*/gm, "").replace(/^\s*[-*] /gm, "• ").trim();

/** Snapped cuts, except edges that were already on the timeline before (they stay put). */
function keepEdges(snapped: EditPlan, raw: EditPlan, before: EditPlan): EditPlan {
  const starts = new Set(before.segments.map((s) => s.start));
  const ends = new Set(before.segments.map((s) => s.end));
  return { ...snapped, segments: snapped.segments.map((s, i) => ({ ...s, start: starts.has(raw.segments[i].start) ? raw.segments[i].start : s.start, end: ends.has(raw.segments[i].end) ? raw.segments[i].end : s.end })) };
}

ipcMain.handle(
  "ai-edit",
  safe(async (path: string, request: string, current: EditPlan, model?: string, focus?: Focus) => {
    const analysis = await analyze(path, () => {});
    const say = (m: string) => status(m.replace(/^plan: /, ""));
    // Attached files arrive as paths; the model needs to know what each is and how long.
    if (focus?.attachments?.length) focus.attachments = await Promise.all(focus.attachments.map((a) => describeAttachment(a.path)));
    // Free models share capacity and are often busy: fall through to the next free one.
    const tries = [model, ...(model?.endsWith(":free") ? freeFallbacks(model, (await listModels()).models).slice(0, 3) : [])];
    let lastError: unknown;
    for (const m of tries) {
      try {
        const picked = focus?.clips.length || focus?.broll || focus?.markers?.length || focus?.attachments?.length ? focus : undefined;
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

// Connectors (the Dashboard): which AI accounts are installed and signed in on this Mac, and the
// buttons that sign in (in the browser), sign out, install and switch each one on for the chat.
const connectionsNow = (): Connections => ({
  claude: agentState("claude"),
  codex: agentState("codex"),
  openrouter: Boolean(openRouterKey()),
  enabled: enabled(),
  install: { claude: INSTALL_COMMAND("claude"), codex: INSTALL_COMMAND("codex") },
});
const pushConnections = () => send("connections", connectionsNow());
ipcMain.handle("connections", () => connectionsNow());
ipcMain.handle("agent-sign-in", (_e, id: AgentId) => (void signIn(id, pushConnections), connectionsNow()));
ipcMain.handle("agent-sign-out", (_e, id: AgentId) => (signOut(id), connectionsNow()));
ipcMain.handle("agent-install", (_e, id: AgentId) => (void install(id, pushConnections), connectionsNow()));
ipcMain.handle("agent-cancel", (_e, id: AgentId) => (cancel(id), connectionsNow()));
ipcMain.handle("agent-enable", (_e, id: AgentId, on: boolean) => (setEnabled(id, on), connectionsNow()));
ipcMain.handle("openrouter-key", (_e, key: string) => (setOpenRouterKey(key), connectionsNow()));

// Claude edits (HyperFrames projects) brought in as layers with keyframes.
ipcMain.handle("pick-scene", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Import a Claude edit",
    message: "Pick the project folder Claude made the video in (HyperFrames or Remotion)",
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Claude edit", extensions: ["html", "htm", "tsx", "ts", "jsx", "js", "json"] }],
  });
  return r.canceled ? undefined : r.filePaths[0];
});
ipcMain.handle("is-scene", (_e, path: string) => (remotionProject(path) ? "remotion" : sceneEntry(path) ? "hyperframes" : null));
ipcMain.handle("import-scene", safe(async (path: string, detail: Detail) => importScene(path, detail, status)));
ipcMain.handle("load-scene", safe(async (file: string) => loadScene(file)));
ipcMain.handle("scene-base", safe(async (file: string) => sceneBase(file)));
ipcMain.handle("font-library", () => libraryFonts().map((f) => ({ ...f, url: mediaUrl(f.file) })));
ipcMain.handle("effect-library", () => libraryEffects());
// A Claude edit's effects into the library (the ones it doesn't have yet).
ipcMain.handle("extract-effects", safe(async (file: string) => addEffectsFrom(loadScene(file)).map((p) => p.name)));

// The project's AI-written animations, compiled for the live preview.
ipcMain.handle("custom-code", safe(async (path: string) => compileCustom(customDir(path))));

// ---- Video from links (yt-dlp) ----
ipcMain.handle(
  "link-info",
  safe(async (url: string, audio?: boolean) => {
    const { captions: _, chapters: __, ...info } = await linkInfo(url, audio);
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
      (f) => send("link-progress", f),
    );
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    return { file, length: Number(stdout.trim()) || (opts.end ?? 0) - (opts.start ?? 0) };
  }),
);

/** Just the sound of a link, as an mp3 in work/music (music for the Music tracks). */
ipcMain.handle(
  "link-audio",
  safe(async (opts: { url: string; id: string; site: string; start?: number; end?: number }) => {
    const file = await downloadAudio(
      opts.url,
      { id: opts.id, site: opts.site.toLowerCase(), start: opts.start, end: opts.end, dir: join(app.getAppPath(), "work", "music") },
      (f) => send("link-progress", f),
    );
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    return { file, length: Number(stdout.trim()) || (opts.end ?? 0) - (opts.start ?? 0) };
  }),
);

/** Sound effects from Openverse: search, then download the chosen one to work/sfx. */
ipcMain.handle("sfx-search", safe(async (query: string, page?: number, short?: boolean) => searchSfx(query, page, short)));
ipcMain.handle(
  "sfx-download",
  safe(async (s: Sfx) => {
    const file = await downloadSfx(s);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    return { file, length: Number(stdout.trim()) || s.duration };
  }),
);

ipcMain.handle(
  "export",
  safe(async (path: string, plan: EditPlan, options?: ExportOptions & { dir: string; name: string }) => {
    // Automated tests (--creatron-debug) can't click the save dialog, so they name the file instead.
    const testPath = process.argv.includes("--creatron-debug") ? process.env.CREATRON_EXPORT_PATH : undefined;
    // The export window names the file and folder; without it, ask with a save dialog.
    const r = testPath
      ? { canceled: false, filePath: testPath }
      : options
        ? { canceled: false, filePath: freeName(options.dir, options.name) }
        : await dialog.showSaveDialog(win, {
            defaultPath: `${basename(path, extname(path))}-creatron.mp4`,
            filters: [{ name: "MP4 video", extensions: ["mp4"] }],
          });
    if (r.canceled || !r.filePath) return undefined;
    exportsRunning++;
    try {
      const analysis = await analyze(path, () => {});
      const out = await render(plan, analysis, r.filePath, (m) => status(m.replace(/^(render|loudness): /, "")), (f) =>
        send("export-progress", f),
        options,
      );
      status("");
      return out;
    } finally {
      exportsRunning--;
    }
  }),
);

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
/** What the AI has downloaded or made for this video so far (assets/ of its project), newest first. */
ipcMain.handle("project-assets", (_e, video: string) => projectAssets(video));
ipcMain.handle("open-file", (_e, path: string) => shell.openPath(path));
ipcMain.handle("file-size", (_e, path: string) => (existsSync(path) ? statSync(path).size : 0));
/** Where exports go until a folder is picked: the Mac's Movies folder ("videos" to Electron). */
ipcMain.handle("export-dir", () => app.getPath("videos"));
ipcMain.handle("pick-folder", async (_e, start?: string) => {
  const r = await dialog.showOpenDialog(win, { defaultPath: start, properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? undefined : r.filePaths[0];
});

/** dir/name.mp4, or name 2.mp4, name 3.mp4… so an export never overwrites an earlier one. */
function freeName(dir: string, name: string): string {
  const clean = name.replace(/[/:]/g, "-").replace(/\.mp4$/i, "").trim() || "Creatro export";
  let file = join(dir, `${clean}.mp4`);
  for (let n = 2; existsSync(file); n++) file = join(dir, `${clean} ${n}.mp4`);
  return file;
}

// The frame strip for a video on an upper track (made once per file).
ipcMain.handle("file-thumbs", safe(async (path: string) => fileThumbnails(path)));

const ASSET_FILE = /\.(mp4|mov|m4v|webm|mkv|png|jpe?g|gif|webp|avif|svg|wav|mp3|m4a|aac|ogg|flac)$/i;

/** Files under the AI project's assets/, one entry per file, with the folder it sits in. A file still
 *  being written (empty, or changed in the last second) waits for the next look. */
function projectAssets(video: string): { dir: string; files: { path: string; folder: string; at: number }[] } {
  const dir = join(autoEditDir(video), "assets");
  const files: { path: string; folder: string; at: number }[] = [];
  const walk = (d: string) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const path = join(d, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(path);
      else if (ASSET_FILE.test(name) && st.size > 0 && Date.now() - st.mtimeMs > 1000)
        files.push({ path, folder: relative(dir, d).split("/")[0] || "other", at: st.mtimeMs });
    }
  };
  walk(dir);
  return { dir, files: files.sort((a, b) => b.at - a.at) };
}

/** True for a file Creatro made itself (downloads, voiceovers, music in work/), never your own files. */
const madeByCreatron = (path: string) => !relative(join(app.getAppPath(), "work"), resolve(path)).startsWith("..");

// Moves a library file to the Trash (so it can be put back), only one Creatro made itself.
ipcMain.handle(
  "trash-media",
  safe(async (path: string) => {
    if (!madeByCreatron(path)) throw new Error("Only files Creatro downloaded or made can be moved to the Trash from here.");
    await shell.trashItem(path);
  }),
);
ipcMain.handle("made-by-creatron", (_e, path: string) => madeByCreatron(path));

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
ipcMain.handle("delete-voiceover-file", safe(async (file: string) => deleteVoiceoverFile(file)));

// A few seconds of a voice to listen to before choosing it (built-in ones are made once, then kept).
ipcMain.handle("voice-preview", safe(async (id: string, language?: VoiceLanguage) => mediaUrl(await previewVoice(id, language))));

ipcMain.handle(
  "generate-voiceover",
  safe(async (opts: { text: string; voiceId: string; speed: number; language?: VoiceLanguage }) => {
    const r = await generateVoiceover(opts, status, (p) => send("voice-progress", p));
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
