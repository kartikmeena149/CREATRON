// The browser demo's stand-in for electron/preload.ts: the same window.creatron the editor talks to,
// with no machine behind it. Videos are read in the page (browserMedia.ts), the AI is scripted
// (script.ts), and whatever needs the Mac (export, voices, downloads) says so instead of failing.
import type { ChatEvent } from "../../src/chatTypes.ts";
import type { Analysis } from "../../src/schema.ts";
import type { Thumbs, Wave } from "../../app/store.ts";
import { filmstrip, readVideo } from "./browserMedia.ts";
import { runScript, scriptedPlan, stopScript } from "./script.ts";

type Api = Window["creatron"];
const ok = <T>(value: T) => ({ ok: true as const, value });
const desktop = (what: string) => ({ ok: false as const, error: `${what} needs the desktop app. This is the browser demo.` });

function emitter<T>() {
  const fns = new Set<(v: T) => void>();
  return { on: (fn: (v: T) => void) => (fns.add(fn), () => void fns.delete(fn)), emit: (v: T) => fns.forEach((fn) => fn(v)) };
}
const status = emitter<string>();
const chat = emitter<{ path: string; event: ChatEvent }>();
const never = () => () => {};

// "Paths" here are only names: each one maps to a URL the page can load.
const urls = new Map<string, string>();
const files = new Map<string, File>();
const analyses = new Map<string, Analysis>();
const pathForFile = (file: File) => {
  const path = `/your-files/${file.name}`;
  if (!urls.has(path)) (urls.set(path, URL.createObjectURL(file)), files.set(path, file));
  return path;
};

/** The file picker, in place of the Mac's open dialog. */
const pick = (accept: string, multiple = false) =>
  new Promise<string[]>((done) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept, multiple });
    input.onchange = () => done([...(input.files ?? [])].map(pathForFile));
    input.oncancel = () => done([]);
    input.click();
  });

// The clip the demo opens with (made by website/make-sample.ts).
type Sample = { path: string; analysis: Analysis; videoUrl: string; thumbs: Thumbs; wave: Wave };
const sampleDir = new URL("../sample/", location.href).href;
const sample: Promise<Sample | undefined> = fetch(`${sampleDir}sample.json`)
  .then((r) => r.json())
  .then((s: { name: string; analysis: Analysis; thumbs: Omit<Thumbs, "url">; wave: Wave }) => {
    const path = `/demo/${s.name}`;
    urls.set(path, `${sampleDir}video.mp4`);
    return { path, analysis: s.analysis, videoUrl: `${sampleDir}video.mp4`, thumbs: { ...s.thumbs, url: `${sampleDir}thumbs.jpg` }, wave: s.wave };
  })
  .catch(() => undefined);

const inBrowser = "Connect it in the Mac app. The browser demo can't sign in apps on your computer.";
const demoConnections = {
  claude: { installed: false, signedIn: false, error: inBrowser },
  codex: { installed: false, signedIn: false, error: inBrowser },
  openrouter: false,
  enabled: { claude: true, codex: true },
  install: { claude: "npm install -g @anthropic-ai/claude-code", codex: "npm install -g @openai/codex" },
};

const api: Api = {
  mediaUrl: (path) => urls.get(path) ?? path,
  pathForFile,
  pickVideo: async () => (await pick("video/*"))[0],
  pickLibrary: () => pick("video/*,audio/*,image/*", true),
  pickAttachments: () => pick("video/*,audio/*,image/*", true),
  pickMedia: async (kind) => (await pick(kind === "video" ? "video/*" : "video/*,audio/*,image/*"))[0],
  pickAudio: async () => (await pick("audio/*,video/*"))[0],
  pickScene: async () => undefined,
  pickFolder: async () => undefined,

  importVideo: async (path) => {
    const s = await sample;
    if (s && path === s.path) return analyses.set(path, s.analysis), ok({ analysis: s.analysis, videoUrl: s.videoUrl, thumbs: s.thumbs, wave: s.wave });
    const file = files.get(path);
    if (!file) return { ok: false, error: "The browser demo can only open videos you choose or drop here." };
    if (!file.type.startsWith("video/")) return { ok: false, error: "The browser demo starts from a video. The desktop app also makes faceless videos from a recording." };
    try {
      const v = await readVideo(urls.get(path)!, file.name, file, status.emit);
      analyses.set(path, v.analysis);
      return ok({ ...v, videoUrl: urls.get(path)! });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
  fileThumbs: async (path) => {
    try {
      return ok(await filmstrip(urls.get(path) ?? path));
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  // The AI: one scripted "model" that edits live, like Claude does in the desktop app.
  models: async () => ok({ models: [{ id: "claude-code/demo", name: "Claude (scripted demo)", free: true, inPerM: 0, outPerM: 0 }], credits: null, recommended: "claude-code/demo" }),
  chatSend: async (path, message, current) => {
    const a = analyses.get(path);
    if (!a) return { ok: false, error: "Open a video first." };
    void runScript(path, message, current, a, (event) => chat.emit({ path, event }));
    return ok(undefined);
  },
  chatStop: async (path) => stopScript(path),
  onChatEvent: chat.on,
  aiEdit: async (path, request, current) => {
    const a = analyses.get(path);
    return a ? ok({ plan: scriptedPlan(request, current, a), model: "scripted demo" }) : { ok: false, error: "Open a video first." };
  },
  enhancePrompt: async () => desktop("Improving a prompt"),

  exportVideo: async () => desktop("Exporting renders on your Mac, so it"),
  exportDir: async () => "Movies",
  openFile: async () => "",
  fileSize: async () => 0,
  reveal: async () => {},
  storyboardAnswer: async () => false,
  storyboardWaiting: async () => false,
  storyboardPdf: async () => ({ ok: false as const, error: "Not in the web demo." }),
  frameAt: async () => null,
  projectAssets: async () => ({ dir: "", files: [] }),

  personCutout: async () => desktop("Putting text behind a person"),
  linkInfo: async () => desktop("Importing from a link"),
  linkAudio: async () => desktop("Importing from a link"),
  linkDownload: async () => desktop("Importing from a link"),
  sfxSearch: async () => desktop("The sound effect library"),
  sfxDownload: async () => desktop("The sound effect library"),
  voices: async () => ok([]),
  cloneVoice: async () => desktop("Cloning a voice"),
  deleteVoice: async () => ok(undefined),
  deleteVoiceoverFile: async () => ok(undefined),
  voicePreview: async () => desktop("Voice Studio"),
  generateVoiceover: async () => desktop("Voice Studio"),
  customCode: async () => ok({ version: "none", code: {}, errors: [] }),
  isScene: async () => null,
  importScene: async () => desktop("Opening a Claude edit"),
  loadScene: async () => desktop("Opening a Claude edit"),
  sceneBase: async () => desktop("Opening a Claude edit"),
  fontLibrary: async () => [],
  effectLibrary: async () => [],
  extractEffects: async () => ({ ok: true as const, value: [] }),
  trashMedia: async () => ok(undefined),
  madeByCreatron: async () => false,

  onStatus: status.on,
  onLinkProgress: never,
  onVoiceProgress: never,
  onExportProgress: never,
  // Connectors sign in apps on a Mac: the demo shows the page, with nothing to connect.
  connections: async () => demoConnections,
  agentSignIn: async () => demoConnections,
  agentSignOut: async () => demoConnections,
  agentInstall: async () => demoConnections,
  agentCancel: async () => demoConnections,
  agentEnable: async () => demoConnections,
  setOpenRouterKey: async () => demoConnections,
  onConnections: never,
  // A browser tab has no Mac window buttons: the top bar never keeps space for them.
  onFullScreen: (fn) => (fn(true), () => {}),
  // The editor listens here for "open this file": the demo uses it to open the sample once.
  onOpenPath: (fn) => {
    if (!new URLSearchParams(location.search).has("empty")) void sample.then((s) => s && fn(s.path));
    return () => {};
  },
  debug: new URLSearchParams(location.search).has("debug"),
};

window.creatron = api;
