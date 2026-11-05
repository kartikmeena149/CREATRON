import type { Analysis, EditPlan } from "../src/schema.ts";
import type { AutoEditEvent, AutoEditResult as Result_ } from "../src/autoedit.ts";
import type { LinkInfo } from "../src/webvideo.ts";

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
      importVideo(path: string): Promise<Result<{ analysis: Analysis; videoUrl: string; thumbs: Thumbs; wave: Wave }>>;
      aiEdit(path: string, request: string, current: EditPlan, model?: string, focus?: { clips: number[]; broll?: string; markers?: { n: number; time: number; x: number; y: number; context: string }[]; attachments?: { path: string }[] }): Promise<Result<{ plan: EditPlan; model: string; cost?: number }>>;
      enhancePrompt(request: string, model: string, path?: string): Promise<Result<string>>;
      personCutout(path: string): Promise<Result<{ cutoutUrl: string }>>;
      linkInfo(url: string): Promise<Result<Omit<LinkInfo, "captions" | "chapters">>>;
      linkDownload(opts: { url: string; id: string; site: string; start?: number; end?: number; purpose: "main" | "broll" }): Promise<Result<{ file: string; length: number }>>;
      onLinkProgress(fn: (f: number) => void): () => void;
      onVoiceProgress(fn: (p: { stage: "starting" | "speaking" | "finishing"; done: number; total: number }) => void): () => void;
      customCode(path: string): Promise<Result<{ version: string; code: Record<string, string>; errors: string[] }>>;
      models(): Promise<Result<{ models: ModelInfo[]; credits: number | null; recommended: string }>>;
      exportVideo(path: string, plan: EditPlan): Promise<Result<string | undefined>>;
      reveal(path: string): Promise<void>;
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
      generateVoiceover(opts: { text: string; voiceId: string; speed: number }): Promise<Result<{ file: string; duration: number; url: string }>>;
      pathForFile(file: File): string;
      onStatus(fn: (s: string) => void): () => void;
      onExportProgress(fn: (f: number) => void): () => void;
      onOpenPath(fn: (path: string) => void): () => void;
      debug: boolean;
    };
  }
}

