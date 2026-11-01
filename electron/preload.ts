// The only door between the editor UI and the machine. Each call maps to one handler in main.ts.
import { contextBridge, ipcRenderer, webUtils } from "electron";

const on = (channel: string) => (fn: (value: any) => void) => {
  const listener = (_e: unknown, value: unknown) => fn(value);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.off(channel, listener);
};

const api = {
  pickVideo: (): Promise<string | undefined> => ipcRenderer.invoke("pick-video"),
  importVideo: (path: string) => ipcRenderer.invoke("import-video", path),
  aiEdit: (path: string, request: string, current: unknown) => ipcRenderer.invoke("ai-edit", path, request, current),
  exportVideo: (path: string, plan: unknown) => ipcRenderer.invoke("export", path, plan),
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
