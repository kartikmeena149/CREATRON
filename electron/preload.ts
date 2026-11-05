// The only door between the editor UI and the machine. Each call maps to one handler in main.ts.
import { contextBridge, ipcRenderer, webUtils } from "electron";

const on = (channel: string) => (fn: (value: any) => void) => {
  const listener = (_e: unknown, value: unknown) => fn(value);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.off(channel, listener);
};

const api = {
  pickVideo: (): Promise<string | undefined> => ipcRenderer.invoke("pick-video"),
  pickLibrary: (): Promise<string[]> => ipcRenderer.invoke("pick-library"),
  importVideo: (path: string) => ipcRenderer.invoke("import-video", path),
  personCutout: (path: string) => ipcRenderer.invoke("person-cutout", path),
  enhancePrompt: (request: string, model: string, path?: string) => ipcRenderer.invoke("enhance-prompt", request, model, path),
  aiEdit: (path: string, request: string, current: unknown, model?: string, focus?: unknown) =>
    ipcRenderer.invoke("ai-edit", path, request, current, model, focus),
  models: () => ipcRenderer.invoke("models"),
  customCode: (path: string) => ipcRenderer.invoke("custom-code", path),
  linkInfo: (url: string) => ipcRenderer.invoke("link-info", url),
  linkDownload: (opts: unknown) => ipcRenderer.invoke("link-download", opts),
  onLinkProgress: on("link-progress"),
  onVoiceProgress: on("voice-progress"),
  exportVideo: (path: string, plan: unknown) => ipcRenderer.invoke("export", path, plan),
  pickMedia: (kind: "video" | "any"): Promise<string | undefined> => ipcRenderer.invoke("pick-media", kind),
  autoEditStart: (opts: { video: string; brief: string; reference?: string; model: string }) => ipcRenderer.invoke("autoedit-start", opts),
  autoEditFix: (opts: { video: string; session: string; model: string; message: string; markers: unknown[] }) => ipcRenderer.invoke("autoedit-fix", opts),
  autoEditCancel: () => ipcRenderer.invoke("autoedit-cancel"),
  onAutoEdit: on("autoedit-event"),
  autoEditState: () => ipcRenderer.invoke("autoedit-state"),
  onAutoEditState: on("autoedit-state"),
  reveal: (path: string) => ipcRenderer.invoke("reveal", path),
  voices: () => ipcRenderer.invoke("voices"),
  pickAudio: (): Promise<string | undefined> => ipcRenderer.invoke("pick-audio"),
  cloneVoice: (opts: unknown) => ipcRenderer.invoke("clone-voice", opts),
  deleteVoice: (id: string) => ipcRenderer.invoke("delete-voice", id),
  generateVoiceover: (opts: unknown) => ipcRenderer.invoke("generate-voiceover", opts),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onStatus: on("status"),
  onExportProgress: on("export-progress"),
  onOpenPath: on("open-path"),
  // Launched with --creatron-debug (automated tests): the UI exposes its state for inspection.
  debug: process.argv.includes("--creatron-debug"),
};

contextBridge.exposeInMainWorld("creatron", api);
export type CreatronApi = typeof api;
