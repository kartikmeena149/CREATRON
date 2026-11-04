import { Component, type ReactNode, useEffect, useState } from "react";
import { AIPanel } from "./AIPanel.tsx";
import { AutoEdit } from "./AutoEdit.tsx";
import { Inspector } from "./Inspector.tsx";
import { LinkImport } from "./LinkImport.tsx";
import { Timeline } from "./Timeline.tsx";
import { Viewer } from "./Viewer.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { type LeftView, useEditor } from "./store.ts";
import { useTabs } from "./tabs.ts";
import { isAudio } from "./format.ts";
import { Splitter, defaultSize, useLayoutSizes } from "./Splitter.tsx";

export function App() {
  const { project, status, set, load } = useEditor();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [sizes, setSizes] = useLayoutSizes();
  const leftOpen = useEditor((s) => s.leftView !== null);

  useEffect(() => window.creatron.onStatus((s: string) => set({ status: s })), []);
  useEffect(() => window.creatron.onExportProgress((f: number) => set({ exporting: f })), []);
  useShortcuts();
  useEffect(() => window.creatron.onOpenPath((p: string) => open(p)), []);

  /** Adds videos, music or sound effects to the library. An empty tab takes the first video as its main video. */
  const addMedia = async (path?: string) => {
    const paths = path ? [path] : await window.creatron.pickLibrary();
    const s = useEditor.getState();
    const main = s.project ? undefined : paths.find((p) => !isAudio(p));
    for (const p of paths) if (p !== main) s.addToLibrary(p);
    if (paths.length) s.set({ leftView: "media" });
    if (main) await open(main);
  };

  /** Opens a video as the main video (V1): here if the tab is empty, otherwise in a new tab. */
  const open = async (path?: string) => {
    path ??= await window.creatron.pickVideo();
    if (!path) return;
    setImporting(true);
    setError("");
    const r = await window.creatron.importVideo(path);
    setImporting(false);
    if (!r.ok) return setError(r.error);
    // A tab that already has a video keeps it: the new one opens in its own tab.
    if (useEditor.getState().project) useTabs.getState().add();
    load({ path, ...r.value });
  };

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        for (const file of e.dataTransfer.files) addMedia(window.creatron.pathForFile(file));
      }}
    >
      <TopBar onLink={() => setLinkOpen(true)} onAuto={() => setAutoOpen(true)}
        aiOpen={aiOpen} onToggleAi={() => setAiOpen(!aiOpen)} />
      <div className="body" style={{ gridTemplateColumns: aiOpen ? `minmax(0, 1fr) 0 ${sizes.ai}px` : "minmax(0, 1fr)" }}>
        <div className="editor" style={{ gridTemplateRows: `minmax(0, 1fr) 0 ${sizes.timeline}px` }}>
          <div className="workspace">
            <Rail />
            {leftOpen && <>
              <div className="inspector-wrap" style={{ width: sizes.left }}>
                <Inspector onOpen={() => addMedia()} onLink={() => setLinkOpen(true)} onOpenMain={open} />
              </div>
              <Splitter dir="x" value={sizes.left} min={220} max={560} sign={1} reset={defaultSize("left")} onChange={(left) => setSizes({ left })} />
            </>}
            <main className="center">
              {project ? <Viewer /> : <Welcome onOpen={() => addMedia()} onAuto={() => setAutoOpen(true)} error={error} />}
            </main>
          </div>
          <Splitter dir="y" value={sizes.timeline} min={150} max={Math.max(200, window.innerHeight - 260)} sign={-1} reset={defaultSize("timeline")} onChange={(timeline) => setSizes({ timeline })} />
          <Timeline onOpenMain={open} />
        </div>
        {aiOpen && <>
          <Splitter dir="x" value={sizes.ai} min={300} max={680} sign={-1} reset={defaultSize("ai")} onChange={(ai) => setSizes({ ai })} />
          <AIPanel />
        </>}
      </div>
      {autoOpen && (
        <Catch onClose={() => setAutoOpen(false)}>
          <AutoEdit initialVideo={project?.path} onClose={() => setAutoOpen(false)} />
        </Catch>
      )}
      {linkOpen && <LinkImport onClose={() => setLinkOpen(false)} onOpenMain={(p) => open(p)} />}
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

function TopBar(p: { onLink: () => void; onAuto: () => void; aiOpen: boolean; onToggleAi: () => void }) {
  const { project, plan, exporting, exported, set, commit } = useEditor();
  const doExport = async () => {
    const s = useEditor.getState();
    if (!s.project || s.exporting !== null) return;
    set({ exporting: 0, exported: undefined });
    const r = await window.creatron.exportVideo(s.project.path, s.plan);
    set({ exporting: null, exported: r.ok ? r.value : undefined });
    if (!r.ok) alert(`Export failed:\n${r.error}`);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") (e.preventDefault(), doExport());
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t") (e.preventDefault(), useTabs.getState().add());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <header className="topbar">
      <div className="brand" title="Creatron"><Icon name="grid" size={14} /> Creatron</div>
      <ProjectTabs />
      <div className="grow" />
      <button className="chip-btn" title="Import from link" onClick={p.onLink}><Icon name="link" size={14} /> Link</button>
      <button className="chip-btn auto" title="Auto Edit: Claude makes the whole finished video" onClick={p.onAuto}>
        <Icon name="sparkle" size={14} /> Auto Edit
      </button>
      {project && (
        <label className="aspect-pick" title="Frame">
          <Icon name="phone" size={14} />
          <select value={plan.aspect} onChange={(e) => commit({ ...plan, aspect: e.target.value as typeof plan.aspect })}>
            <option value="source">Original</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="16:9">16:9</option>
          </select>
          <Icon name="chevronDown" size={12} />
        </label>
      )}
      {exported && (
        <button className="icon-btn" title="Show export in Finder" onClick={() => window.creatron.reveal(exported)}><Icon name="download" /></button>
      )}
      <button className="export-btn" disabled={!project || exporting !== null} onClick={doExport}>
        {exporting !== null ? `Exporting ${Math.round(exporting * 100)}%` : <>Export <kbd>⌘E</kbd></>}
        {exporting !== null && <i className="progress" style={{ width: `${exporting * 100}%` }} />}
      </button>
      <button className={`icon-btn ${p.aiOpen ? "on" : ""}`} title="Show / hide the AI panel" onClick={p.onToggleAi}><Icon name="panelRight" /></button>
    </header>
  );
}

function ProjectTabs() {
  const { tabs, active, add, switchTo, close } = useTabs();
  const live = useEditor((s) => s.project);
  const locked = useEditor((s) => s.busy || s.exporting !== null);
  // Keep the open tab in view when there are more tabs than fit.
  useEffect(() => void document.querySelector(".doc-tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" }), [active, tabs.length]);
  return (
    <>
    <div className="doc-tabs">
      {tabs.map((t) => {
        const project = t.id === active ? live : t.snapshot?.project;
        const name = project ? project.analysis.source.split("/").pop() : "New project";
        return (
          <div
            key={t.id}
            className={`doc-tab ${t.id === active ? "on" : ""}`}
            title={locked && t.id !== active ? "Wait for the AI or export to finish" : project?.analysis.source}
            onClick={() => switchTo(t.id)}
          >
            {project ? <video className="doc-thumb" src={`${project.videoUrl}#t=1`} muted preload="metadata" /> : <Icon name="video" size={14} />}
            <span>{name}</span>
            <button className="doc-close" title="Close tab" onClick={(e) => (e.stopPropagation(), close(t.id))}><Icon name="close" size={12} /></button>
          </div>
        );
      })}
    </div>
    <button className="icon-btn" title="New tab (⌘T)" disabled={locked} onClick={add}><Icon name="plus" /></button>
    </>
  );
}

const RAIL: [LeftView, IconName, string][] = [
  ["media", "folder", "Library"],
  ["clip", "sliders", "Clip & frame"],
  ["audio", "music", "Audio"],
  ["captions", "cc", "Captions"],
  ["text", "type", "Text"],
];

function Rail() {
  const { leftView, set } = useEditor();
  return (
    <nav className="rail">
      {RAIL.map(([v, icon, label]) => (
        <button key={v} className={leftView === v ? "on" : ""} title={label} onClick={() => set({ leftView: leftView === v ? null : v })}>
          <Icon name={icon} size={18} />
        </button>
      ))}
    </nav>
  );
}

function Welcome({ onOpen, onAuto, error }: { onOpen: () => void; onAuto: () => void; error: string }) {
  return (
    <div className="welcome">
      <div className="drop">
        <div className="drop-icon">⬆</div>
        <h2>Drop a video here</h2>
        <p className="dim">Your footage stays on this Mac. Only the transcript goes to the AI.</p>
        <button className="primary" onClick={onOpen}>Choose video</button>
        <p className="dim small auto-hint">
          or <button className="link" onClick={onAuto}>✨ Auto Edit</button>: Claude makes the whole finished video for you
        </p>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range")) return;
      const s = useEditor.getState();
      if (!s.project) return;
      const frame = 1 / s.project.analysis.fps;
      if (e.code === "Space") (e.preventDefault(), s.setPlaying(!s.playing));
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") (e.preventDefault(), e.shiftKey ? s.redo() : s.undo());
      else if (e.key === "s" || e.key === "S") s.split();
      else if (e.key === "Backspace" || e.key === "Delete") s.selectedMotion !== null ? s.deleteMotion(s.selectedMotion) : s.selectedBroll !== null ? s.deleteBroll(s.selectedBroll) : s.selectedVo !== null ? s.deleteVoiceover(s.selectedVo) : s.selectedCue !== null ? s.deleteCaption(s.selectedCue) : s.deleteSelected();
      else if (e.key === "ArrowLeft") s.seek(s.time - (e.shiftKey ? 1 : frame));
      else if (e.key === "ArrowRight") s.seek(s.time + (e.shiftKey ? 1 : frame));
      else if (e.key === "Home") s.seek(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** A view that crashes shows its error instead of taking the whole window down. */
class Catch extends Component<{ children: ReactNode; onClose: () => void }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="overlay">
        <div className="overlay-card">
          <div className="error">Something went wrong: {this.state.error.message}</div>
          <button onClick={() => (this.setState({ error: undefined }), this.props.onClose())}>Close</button>
        </div>
      </div>
    );
  }
}
