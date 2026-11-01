import type { Analysis, EditPlan } from "../src/schema.ts";
import type { Thumbs, Wave } from "./store.ts";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

declare global {
  interface Window {
    creatron: {
      pickVideo(): Promise<string | undefined>;
      importVideo(path: string): Promise<Result<{ analysis: Analysis; videoUrl: string; thumbs: Thumbs; wave: Wave }>>;
      aiEdit(path: string, request: string, current: EditPlan): Promise<Result<{ plan: EditPlan; model: string; cost?: number }>>;
      exportVideo(path: string, plan: EditPlan): Promise<Result<string | undefined>>;
      reveal(path: string): Promise<void>;
      pathForFile(file: File): string;
      onStatus(fn: (s: string) => void): () => void;
      onExportProgress(fn: (f: number) => void): () => void;
      onOpenPath(fn: (path: string) => void): () => void;
    };
  }
}

