import type { Analysis, EditPlan } from "../src/schema.ts";
import type { Detail, Scene } from "../src/scene.ts";
import type { AutoEditEvent, AutoEditResult as Result_ } from "../src/autoedit.ts";
import type { LinkInfo } from "../src/webvideo.ts";
import type { Sfx } from "../src/sfx.ts";
import type { ChatEvent } from "../src/chat.ts";
import type { AgentId, Connections } from "../src/chatTypes.ts";
import type { ExportOptions } from "../src/exportOptions.ts";

export type AutoEditResult = Result_ & { url: string };
/** The Auto Edit job the app is running or last ran (kept by the main process). */
export type AutoJob = { running: boolean; fixing: boolean; video: string; model: string; log: AutoEditEvent[]; progress?: AutoEditEvent; result?: AutoEditResult; error?: string };
import type { Thumbs, Wave } from "./store.ts";

export type ModelInfo = { id: string; name: string; free: boolean; inPerM: number; outPerM: number };
export type VoiceInfo = { id: string; name: string; kind: "cloned" | "builtin"; file?: string; url?: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

declare global {
  interface Window {
    creatron: {
      pickVideo(): Promise<string | undefined>;
      pickLibrary(): Promise<string[]>;
      pickAttachments(): Promise<string[]>;
      importVideo(path: string): Promise<Result<{ analysis: Analysis; videoUrl: string; thumbs: Thumbs; wave: Wave }>>;
      aiEdit(path: string, request: string, current: EditPlan, model?: string, focus?: { clips: number[]; broll?: string; markers?: { n: number; time: number; x: number; y: number; context: string }[]; attachments?: { path: string }[] }): Promise<Result<{ plan: EditPlan; model: string; cost?: number }>>;
      enhancePrompt(request: string, model: string, path?: string): Promise<Result<string>>;
      personCutout(path: string): Promise<Result<{ cutoutUrl: string }>>;
      linkInfo(url: string, audio?: boolean): Promise<Result<Omit<LinkInfo, "captions" | "chapters">>>;
      linkAudio(opts: { url: string; id: string; site: string; start?: number; end?: number }): Promise<Result<{ file: string; length: number }>>;
      linkDownload(opts: { url: string; id: string; site: string; start?: number; end?: number; purpose: "main" | "broll" }): Promise<Result<{ file: string; length: number }>>;
      onLinkProgress(fn: (f: number) => void): () => void;
      sfxSearch(query: string, page?: number, short?: boolean): Promise<Result<{ results: Sfx[]; more: boolean }>>;
      sfxDownload(sfx: Sfx): Promise<Result<{ file: string; length: number }>>;
      onVoiceProgress(fn: (p: { stage: "starting" | "speaking" | "finishing"; done: number; total: number }) => void): () => void;
      customCode(path: string): Promise<Result<{ version: string; code: Record<string, string>; errors: string[] }>>;
      pickScene(): Promise<string | undefined>;
      /** What kind of Claude edit a path is (null: not one). */
      isScene(path: string): Promise<"hyperframes" | "remotion" | null>;
      importScene(path: string, detail: Detail): Promise<Result<{ file: string; scene: Scene }>>;
      loadScene(file: string): Promise<Result<Scene>>;
      sceneBase(file: string): Promise<Result<string>>;
      /** Creatro's font library (fonts edits brought in), with a URL for each file. */
      fontLibrary(): Promise<{ family: string; weight: string; style: string; unicodeRange?: string; file: string; url: string }[]>;
      chatSend(path: string, message: string, current: EditPlan, model: string, focus?: unknown, answer?: boolean): Promise<Result<void>>;
      chatStop(path: string): Promise<void>;
      onChatEvent(fn: (e: { path: string; event: ChatEvent }) => void): () => void;
      models(): Promise<Result<{ models: ModelInfo[]; credits: number | null; recommended: string }>>;
      exportVideo(path: string, plan: EditPlan, options?: ExportOptions & { dir: string; name: string }): Promise<Result<string | undefined>>;
      openFile(path: string): Promise<string>;
      fileSize(path: string): Promise<number>;
      exportDir(): Promise<string>;
      pickFolder(start?: string): Promise<string | undefined>;
      reveal(path: string): Promise<void>;
      fileThumbs(path: string): Promise<Result<Thumbs>>;
      trashMedia(path: string): Promise<Result<void>>;
      madeByCreatron(path: string): Promise<boolean>;
      pickMedia(kind: "video" | "any"): Promise<string | undefined>;
      autoEditStart(opts: { video: string; brief: string; reference?: string; model: string }): Promise<Result<void>>;
      autoEditFix(opts: { video: string; session: string; model: string; message: string; markers: { n: number; time: number; x: number; y: number }[] }): Promise<Result<void>>;
      autoEditState(): Promise<AutoJob | undefined>;
      onAutoEditState(fn: (job: AutoJob) => void): () => void;
      autoEditCancel(): Promise<void>;
      onAutoEdit(fn: (e: AutoEditEvent) => void): () => void;
      voices(): Promise<Result<VoiceInfo[]>>;
      pickAudio(): Promise<string | undefined>;
      cloneVoice(opts: { source: string; start: number; duration: number; name: string; consent: boolean }): Promise<Result<VoiceInfo>>;
      deleteVoice(id: string): Promise<Result<void>>;
      deleteVoiceoverFile(file: string): Promise<Result<void>>;
      voicePreview(id: string, language?: string): Promise<Result<string>>;
      generateVoiceover(opts: { text: string; voiceId: string; speed: number; language?: string }): Promise<Result<{ file: string; duration: number; url: string }>>;
      pathForFile(file: File): string;
      /** Only in the browser demo: the URL of a file (the desktop app serves files over media://). */
      mediaUrl?(path: string): string;
      onStatus(fn: (s: string) => void): () => void;
      onExportProgress(fn: (f: number) => void): () => void;
      onOpenPath(fn: (path: string) => void): () => void;
      /** The window entered (true) or left (false) full screen, where the Mac's window buttons are hidden. */
      onFullScreen(fn: (on: boolean) => void): () => void;
      /** Connectors: Claude (Claude Code), ChatGPT (Codex) and an OpenRouter key. */
      connections(): Promise<Connections>;
      agentSignIn(id: AgentId): Promise<Connections>;
      agentSignOut(id: AgentId): Promise<Connections>;
      agentInstall(id: AgentId): Promise<Connections>;
      agentCancel(id: AgentId): Promise<Connections>;
      agentEnable(id: AgentId, on: boolean): Promise<Connections>;
      setOpenRouterKey(key: string): Promise<Connections>;
      onConnections(fn: (c: Connections) => void): () => void;
      debug: boolean;
    };
  }
}

