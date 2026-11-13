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
  pickAttachments: (): Promise<string[]> => ipcRenderer.invoke("pick-attachments"),
  importVideo: (path: string) => ipcRenderer.invoke("import-video", path),
  personCutout: (path: string) => ipcRenderer.invoke("person-cutout", path),
  enhancePrompt: (request: string, model: string, path?: string) => ipcRenderer.invoke("enhance-prompt", request, model, path),
  aiEdit: (path: string, request: string, current: unknown, model?: string, focus?: unknown) =>
    ipcRenderer.invoke("ai-edit", path, request, current, model, focus),
  models: () => ipcRenderer.invoke("models"),
  chatSend: (path: string, message: string, current: unknown, model: string, focus?: unknown, answer?: boolean) => ipcRenderer.invoke("chat-send", path, message, current, model, focus, answer),
  chatStop: (path: string) => ipcRenderer.invoke("chat-stop", path),
  onChatEvent: on("chat-event"),
  customCode: (path: string) => ipcRenderer.invoke("custom-code", path),
  pickScene: (): Promise<string | undefined> => ipcRenderer.invoke("pick-scene"),
  isScene: (path: string): Promise<"hyperframes" | "remotion" | null> => ipcRenderer.invoke("is-scene", path),
  importScene: (path: string, detail: string) => ipcRenderer.invoke("import-scene", path, detail),
  loadScene: (file: string) => ipcRenderer.invoke("load-scene", file),
  sceneBase: (file: string) => ipcRenderer.invoke("scene-base", file),
  fontLibrary: () => ipcRenderer.invoke("font-library"),
  linkInfo: (url: string, audio?: boolean) => ipcRenderer.invoke("link-info", url, audio),
  linkAudio: (opts: unknown) => ipcRenderer.invoke("link-audio", opts),
  linkDownload: (opts: unknown) => ipcRenderer.invoke("link-download", opts),
  onLinkProgress: on("link-progress"),
  sfxSearch: (query: string, page?: number, short?: boolean) => ipcRenderer.invoke("sfx-search", query, page, short),
  sfxDownload: (sfx: unknown) => ipcRenderer.invoke("sfx-download", sfx),
  onVoiceProgress: on("voice-progress"),
  exportVideo: (path: string, plan: unknown, options?: unknown) => ipcRenderer.invoke("export", path, plan, options),
  openFile: (path: string) => ipcRenderer.invoke("open-file", path),
  fileSize: (path: string): Promise<number> => ipcRenderer.invoke("file-size", path),
  exportDir: (): Promise<string> => ipcRenderer.invoke("export-dir"),
  pickFolder: (start?: string): Promise<string | undefined> => ipcRenderer.invoke("pick-folder", start),
  pickMedia: (kind: "video" | "any"): Promise<string | undefined> => ipcRenderer.invoke("pick-media", kind),
  autoEditStart: (opts: { video: string; brief: string; reference?: string; model: string }) => ipcRenderer.invoke("autoedit-start", opts),
  autoEditFix: (opts: { video: string; session: string; model: string; message: string; markers: unknown[] }) => ipcRenderer.invoke("autoedit-fix", opts),
  autoEditCancel: () => ipcRenderer.invoke("autoedit-cancel"),
  onAutoEdit: on("autoedit-event"),
  autoEditState: () => ipcRenderer.invoke("autoedit-state"),
  onAutoEditState: on("autoedit-state"),
  reveal: (path: string) => ipcRenderer.invoke("reveal", path),
  fileThumbs: (path: string) => ipcRenderer.invoke("file-thumbs", path),
  trashMedia: (path: string) => ipcRenderer.invoke("trash-media", path),
  madeByCreatron: (path: string) => ipcRenderer.invoke("made-by-creatron", path),
  voices: () => ipcRenderer.invoke("voices"),
  pickAudio: (): Promise<string | undefined> => ipcRenderer.invoke("pick-audio"),
  cloneVoice: (opts: unknown) => ipcRenderer.invoke("clone-voice", opts),
  deleteVoice: (id: string) => ipcRenderer.invoke("delete-voice", id),
  deleteVoiceoverFile: (file: string) => ipcRenderer.invoke("delete-voiceover-file", file),
  voicePreview: (id: string, language?: string) => ipcRenderer.invoke("voice-preview", id, language),
  generateVoiceover: (opts: unknown) => ipcRenderer.invoke("generate-voiceover", opts),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onStatus: on("status"),
  onExportProgress: on("export-progress"),
  onOpenPath: on("open-path"),
  onFullScreen: on("full-screen"),
  // Launched with --creatron-debug (automated tests): the UI exposes its state for inspection.
  debug: process.argv.includes("--creatron-debug"),
};

contextBridge.exposeInMainWorld("creatron", api);
export type CreatronApi = typeof api;
