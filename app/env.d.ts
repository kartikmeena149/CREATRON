import type { Analysis, EditPlan } from "../src/schema.ts";
import type { Detail, Scene } from "../src/scene.ts";
import type { LinkInfo } from "../src/webvideo.ts";
import type { Sfx } from "../src/sfx.ts";
import type { ChatEvent } from "../src/chat.ts";
import type { AgentId, Connections, PlanEvent, SavedPlan } from "../src/chatTypes.ts";
import type { ExportOptions } from "../src/exportOptions.ts";

/** The Auto Edit job the app is running or last ran (kept by the main process). */
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
      /** The effects taken out of imported Claude edits. */
      effectLibrary(): Promise<import("../src/sceneEffects.ts").EffectPreset[]>;
      /** Adds a Claude edit's effects to the library; the names of the new ones. */
      extractEffects(file: string): Promise<Result<string[]>>;
      chatSend(path: string, message: string, current: EditPlan, model: string, focus?: unknown, answer?: boolean, library?: string[]): Promise<Result<void>>;
      storyboardAnswer(video: string, answer: { approve: boolean; board: unknown; changes?: string; drawings?: Record<string, string>; only?: string[] }): Promise<boolean>;
      planStart(req: { title?: string; script: string; direction?: string; format: "9:16" | "16:9" | "1:1" | "4:5"; style?: "auto" | "explainer" | "editorial" | "3d"; assets: string[]; model: string }): Promise<Result<{ key: string; dir: string }>>;
      boardAddFile(dir: string, file: string): Promise<Result<string>>;
      findPicture(dir: string, name: string): Promise<Result<{ file: string; credit: string; cutout: boolean }>>;
      /** Each step of finding a picture, as it happens ("Searching the web…"). */
      onPictureProgress(fn: (p: { name: string; step: string }) => void): () => void;
      drawThing(name: string, model?: string): Promise<Result<{ d: string; shade?: number }[]>>;
      planMedia(dir: string): Promise<Result<{ path: string; name: string; kind: "video" | "audio"; seconds: number }[]>>;
      planBuild(path: string, plan: string, model: string, library?: string[]): Promise<Result<void>>;
      planStop(): Promise<void>;
      planOpen(dir: string, model: string): Promise<Result<{ key: string; dir: string }>>;
      plansList(): Promise<SavedPlan[]>;
      planRename(dir: string, title: string): Promise<Result<void>>;
      planDelete(dir: string): Promise<Result<void>>;
      onPlanEvent(fn: (e: { key: string; event: PlanEvent }) => void): () => void;
      readScript(path: string): Promise<Result<string>>;
      storyboardWaiting(video: string): Promise<boolean>;
      storyboardPdf(dir: string, html: string, name: string): Promise<Result<string>>;
      frameAt(file: string, seconds: number, width?: number): Promise<string | null>;
      micAccess(): Promise<"granted" | "denied" | "restricted" | "not-determined" | "unknown">;
      openMicSettings(): Promise<void>;
      dictate(wav: Uint8Array): Promise<Result<string>>;
      chatStop(path: string): Promise<void>;
      onChatEvent(fn: (e: { path: string; event: ChatEvent }) => void): () => void;
      models(): Promise<Result<{ models: ModelInfo[]; credits: number | null; recommended: string }>>;
      exportVideo(path: string, plan: EditPlan, options?: ExportOptions & { dir: string; name: string }): Promise<Result<string | undefined>>;
      openFile(path: string): Promise<string>;
      fileSize(path: string): Promise<number>;
      exportDir(): Promise<string>;
      pickFolder(start?: string): Promise<string | undefined>;
      reveal(path: string): Promise<void>;
      projectAssets(video: string): Promise<{ dir: string; files: { path: string; folder: string; at: number }[] }>;
      fileThumbs(path: string): Promise<Result<Thumbs>>;
      trashMedia(path: string): Promise<Result<void>>;
      madeByCreatron(path: string): Promise<boolean>;
      pickMedia(kind: "video" | "any"): Promise<string | undefined>;
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

