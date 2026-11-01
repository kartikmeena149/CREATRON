import { useEffect, useState } from "react";
import { AIPanel } from "./AIPanel.tsx";
import { Inspector } from "./Inspector.tsx";
import { Timeline } from "./Timeline.tsx";
import { Viewer } from "./Viewer.tsx";
import { useEditor } from "./store.ts";

export function App() {
  const { project, status, set, load } = useEditor();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => window.creatron.onStatus((s: string) => set({ status: s })), []);
  useEffect(() => window.creatron.onExportProgress((f: number) => set({ exporting: f })), []);
  useShortcuts();
  useEffect(() => window.creatron.onOpenPath((p: string) => open(p)), []);

  const open = async (path?: string) => {
    path ??= await window.creatron.pickVideo();
    if (!path) return;
    setImporting(true);
    setError("");
    const r = await window.creatron.importVideo(path);
    setImporting(false);
    if (r.ok) load({ path, ...r.value });
    else setError(r.error);
  };

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) open(window.creatron.pathForFile(file));
      }}
    >
      <TopBar onOpen={() => open()} />
      <div className="workspace">
        <Inspector />
        <main className="center">
          {project ? <Viewer /> : <Welcome onOpen={() => open()} error={error} />}
        </main>
        <AIPanel />
      </div>
      <Timeline />
      {importing && (
        <div className="overlay">
          <div className="overlay-card">
            <div className="spinner" />
            <div>Preparing your video</div>
            <div className="dim small">{status || "starting"}…</div>
          </div>
        </div>
      )}
    </div>
  );
}

function TopBar({ onOpen }: { onOpen: () => void }) {
  const { project, plan, exporting, exported, set } = useEditor();
  const doExport = async () => {
    if (!project) return;
    set({ exporting: 0, exported: undefined });
    const r = await window.creatron.exportVideo(project.path, plan);
    set({ exporting: null, exported: r.ok ? r.value : undefined });
    if (!r.ok) alert(`Export failed:\n${r.error}`);
  };
  return (
    <header className="topbar">
      <div className="brand">CREATRON</div>
      <button className="ghost" onClick={onOpen}>Import video</button>
      <div className="title">{project ? project.analysis.source.split("/").pop() : "No video"}</div>
      <div className="grow" />
      {exported && (
        <button className="ghost" onClick={() => window.creatron.reveal(exported)}>Show in Finder</button>
      )}
      <button className="primary" disabled={!project || exporting !== null} onClick={doExport}>
        {exporting !== null ? `Exporting ${Math.round(exporting * 100)}%` : "Export"}
        {exporting !== null && <i className="progress" style={{ width: `${exporting * 100}%` }} />}
      </button>
    </header>
  );
}

function Welcome({ onOpen, error }: { onOpen: () => void; error: string }) {
  return (
    <div className="welcome">
      <div className="drop">
        <div className="drop-icon">⬆</div>
        <h2>Drop a video here</h2>
        <p className="dim">Your footage stays on this Mac. Only the transcript goes to the AI.</p>
        <button className="primary" onClick={onOpen}>Choose video</button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range")) return;
      const s = useEditor.getState();
      if (!s.project) return;
      const frame = 1 / s.project.analysis.fps;
      if (e.code === "Space") (e.preventDefault(), s.setPlaying(!s.playing));
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") (e.preventDefault(), e.shiftKey ? s.redo() : s.undo());
      else if (e.key === "s" || e.key === "S") s.split();
      else if (e.key === "Backspace" || e.key === "Delete") s.deleteSelected();
      else if (e.key === "ArrowLeft") s.seek(s.time - (e.shiftKey ? 1 : frame));
      else if (e.key === "ArrowRight") s.seek(s.time + (e.shiftKey ? 1 : frame));
      else if (e.key === "Home") s.seek(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
