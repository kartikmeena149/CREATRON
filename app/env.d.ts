import type { Analysis, EditPlan } from "../src/schema.ts";
import type { Thumbs, Wave } from "./store.ts";

export type VoiceInfo = { id: string; name: string; kind: "cloned" | "builtin"; file?: string; url?: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

declare global {
  interface Window {
    creatron: {
      pickVideo(): Promise<string | undefined>;
      importVideo(path: string): Promise<Result<{ analysis: Analysis; videoUrl: string; thumbs: Thumbs; wave: Wave }>>;
      aiEdit(path: string, request: string, current: EditPlan): Promise<Result<{ plan: EditPlan; model: string; cost?: number }>>;
      exportVideo(path: string, plan: EditPlan): Promise<Result<string | undefined>>;
      reveal(path: string): Promise<void>;
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

