import { useEffect, useState } from "react";
import { ExportDialog } from "./ExportDialog.tsx";
import { FramePicker } from "./FramePicker.tsx";
import { Dashboard, closeHome, openHome, useHome } from "./Dashboard.tsx";
import { Orb } from "./Orb.tsx";
import { CreatorQuote } from "./Quotes.tsx";
import { AIPanel } from "./AIPanel.tsx";
import { Inspector } from "./Inspector.tsx";
import { LinkImport } from "./LinkImport.tsx";
import { useMagnet } from "./magnet.ts";
import { Timeline } from "./Timeline.tsx";
import { Viewer } from "./Viewer.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { type LeftView, useEditor } from "./store.ts";
import { useTabs } from "./tabs.ts";
import { ClipMenu } from "./ClipMenu.tsx";
import { TransitionPicker } from "./TransitionPicker.tsx";
import * as act from "./clipActions.ts";
import { isAudio, isImage } from "./format.ts";
import { MIN, Splitter, defaultSize, fitLayout, useLayoutRoom, useLayoutSizes } from "./Splitter.tsx";
import { SceneImport, pickClaudeEdit } from "./SceneImport.tsx";
import { clipsOf, deleteSceneClip } from "./SceneClips.tsx";

export function App() {
  const { project, status, set, load } = useEditor();
  const sceneImport = useEditor((s) => s.sceneImport);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [linkOpen, setLinkOpen] = useState<false | "video" | "audio">(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [sizes, setSizes] = useLayoutSizes();
  // A multi-selection shows its own panel even when the left panel was hidden.
  const leftOpen = useEditor((s) => s.leftView !== null || s.picked.length + s.pickedIds.length > 1);
  // The sizes as drawn: the viewer always keeps its room, whatever the window or the saved sizes.
  const [win, editorRef] = useLayoutRoom();
  const fit = fitLayout(sizes, { left: leftOpen, ai: aiOpen }, win);
  const home = useHome((h) => h.view);

  useEffect(() => window.creatron.onStatus((s: string) => set({ status: s })), []);
  // Fonts edits brought into Creatro, ready for captions and the preview.
  useEffect(() => void useEditor.getState().loadFontLibrary(), []);
  useEffect(() => void useEditor.getState().loadEffectLibrary(), []);
  useEffect(() => window.creatron.onExportProgress((f: number) => set({ exporting: f })), []);
  useShortcuts();
  useEffect(() => window.creatron.onOpenPath((p: string) => open(p)), []);
  // No window buttons in full screen: the top bar drops the space it keeps for them.
  useEffect(() => window.creatron.onFullScreen((on) => document.documentElement.classList.toggle("no-window-buttons", on)), []);

  /**
   * Adds videos, music or sound effects to the library. An empty tab takes the first video as its
   * main track, or with no video the first recording (a faceless video made over your voice).
   */
  // All files of one drop or pick go in together: added one by one, each would race to become the main video.
  const addMedia = async (given?: string[]) => {
    let paths = given ?? (await window.creatron.pickLibrary());
    // A Claude edit (HyperFrames folder or .html) goes to its import dialog instead.
    const edits = await Promise.all(paths.map((p) => window.creatron.isScene(p)));
    const edit = paths.find((_, i) => edits[i]);
    if (edit) set({ sceneImport: edit });
    paths = paths.filter((_, i) => !edits[i]);
    const s = useEditor.getState();
    // Photos can't be a main track: the first video, else the first recording (a faceless video).
    const main = s.project ? undefined : (paths.find((p) => !isAudio(p) && !isImage(p)) ?? paths.find((p) => isAudio(p)));
    for (const p of paths) if (p !== main) s.addToLibrary(p);
    if (paths.length) s.set({ leftView: "media" });
    if (main) await open(main);
  };

  /**
   * Opens a video as the main video (V1): here if the tab is empty (or `here`, a clip dropped on an
   * empty timeline), otherwise in a new tab.
   */
  const open = async (path?: string, here = false): Promise<boolean> => {
    path ??= await window.creatron.pickVideo();
    if (!path) return false;
    setImporting(true);
    setError("");
    const r = await window.creatron.importVideo(path);
    setImporting(false);
    if (!r.ok) return setError(r.error), false;
    // A tab that already has a video keeps it: the new one opens in its own tab.
    if (useEditor.getState().project && !here) useTabs.getState().add();
    load({ path, ...r.value });
    closeHome();
    return true;
  };

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const paths = [...e.dataTransfer.files].map((f) => window.creatron.pathForFile(f));
        if (paths.length) addMedia(paths);
      }}
    >
      <TopBar
        aiOpen={aiOpen} onToggleAi={() => setAiOpen(!aiOpen)} />
      {home && <Dashboard onOpenVideo={(p) => open(p)} />}
      <div className="body" hidden={Boolean(home)} style={{ gridTemplateColumns: aiOpen ? `minmax(0, 1fr) 0 ${fit.sizes.ai}px` : "minmax(0, 1fr)" }}>
        <div className="editor" ref={editorRef} style={{ gridTemplateRows: `minmax(0, 1fr) 0 ${fit.sizes.timeline}px` }}>
          <div className="workspace">
            <Rail />
            {leftOpen && <>
              <div className="inspector-wrap" style={{ width: fit.sizes.left }}>
                <Inspector onOpen={() => addMedia()} onLink={(kind) => setLinkOpen(kind)} onOpenMain={open} />
              </div>
              <Splitter dir="x" value={fit.sizes.left} min={MIN.left} max={fit.max.left} sign={1} reset={defaultSize("left")} onChange={(left) => setSizes({ left })} />
            </>}
            <main className="center">
              {project ? <Viewer /> : <Welcome onOpen={() => addMedia()} error={error} />}
            </main>
          </div>
          <Splitter dir="y" value={fit.sizes.timeline} min={MIN.timeline} max={fit.max.timeline} sign={-1} reset={defaultSize("timeline")} onChange={(timeline) => setSizes({ timeline })} />
          <Timeline onOpenMain={(p) => open(p, true)} />
        </div>
        {aiOpen && <>
          <Splitter dir="x" value={fit.sizes.ai} min={MIN.ai} max={fit.max.ai} sign={-1} reset={defaultSize("ai")} onChange={(ai) => setSizes({ ai })} />
          <AIPanel />
        </>}
      </div>
      <ClipMenu />
      <TransitionPicker />
      {sceneImport && <SceneImport key={sceneImport} path={sceneImport} onClose={() => set({ sceneImport: null })} onOpenMain={open} />}
      {linkOpen && <LinkImport key={linkOpen} audio={linkOpen === "audio"} onClose={() => setLinkOpen(false)} onOpenMain={(p) => open(p)} />}
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

function TopBar(p: { aiOpen: boolean; onToggleAi: () => void }) {
  const { project, plan, exporting, exported, commit } = useEditor();
  // ⌘E or the Export button opens the export window (it shows the progress while one runs).
  const [exportOpen, setExportOpen] = useState(false);
  const doExport = () => {
    const s = useEditor.getState();
    if (s.project && (s.plan.segments.length || s.exporting !== null)) setExportOpen(true);
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
      <BrandHome />
      <ProjectTabs />
      <div className="grow" />
      {project && (
        <FramePicker />
      )}
      {exported && (
        <button className="icon-btn" title="Show export in Finder" onClick={() => window.creatron.reveal(exported)}><Icon name="download" /></button>
      )}
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      <button className="export-btn" disabled={!project || (!plan.segments.length && exporting === null)} onClick={doExport}
        title={project && !plan.segments.length ? "The timeline is empty" : undefined}>
        {exporting !== null ? `Exporting ${Math.round(exporting * 100)}%` : <>Export <kbd>⌘E</kbd></>}
        {exporting !== null && <i className="progress" style={{ width: `${exporting * 100}%` }} />}
      </button>
      <button className={`icon-btn ${p.aiOpen ? "on" : ""}`} title="Show / hide the AI panel" onClick={p.onToggleAi}><Icon name="panelRight" /></button>
    </header>
  );
}

/** The mark is Home: lit, with the red light blinking, while the dashboard is open. */
function BrandHome() {
  const home = useHome((h) => h.view);
  return (
    <button className={`brand ${home ? "on" : ""}`} title="Home: start a video, open projects, connect your AI" onClick={() => openHome()}>
      <Orb size={17} still={!home} calm /> Creatro
    </button>
  );
}

function ProjectTabs() {
  const { tabs, active, add, switchTo, close } = useTabs();
  const home = useHome((h) => h.view);
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
            className={`doc-tab ${t.id === active && !home ? "on" : ""}`}
            title={locked && t.id !== active ? "Wait for the AI or export to finish" : project?.analysis.source}
            onClick={() => (switchTo(t.id), closeHome())}
          >
            {project ? <video className="doc-thumb" src={`${project.videoUrl}#t=1`} muted preload="metadata" /> : <Icon name="video" size={14} />}
            <span>{name}</span>
            <button className="doc-close" title="Close tab" onClick={(e) => (e.stopPropagation(), close(t.id))}><Icon name="close" size={12} /></button>
          </div>
        );
      })}
    </div>
    <button className="icon-btn" title="New tab (⌘T)" disabled={locked} onClick={() => (add(), closeHome())}><Icon name="plus" /></button>
    </>
  );
}

// An icon, or a short word where no icon says it clearly ("SFX").
const RAIL: [LeftView, IconName | "SFX", string][] = [
  ["media", "folder", "Library"],
  ["clip", "sliders", "Clip & frame"],
  ["audio", "music", "Audio"],
  ["sfx", "SFX", "Sound effects"],
  ["voice", "mic", "Voice Studio"],
  ["captions", "cc", "Captions"],
  ["text", "type", "Text"],
  ["effects", "sparkle", "Effects & transitions"],
];

function Rail() {
  const { leftView, set } = useEditor();
  return (
    <nav className="rail">
      {RAIL.map(([v, icon, label]) => (
        <button key={v} className={leftView === v ? "on" : ""} title={label} onClick={() => set({ leftView: leftView === v ? null : v })}>
          {icon === "SFX" ? <span className="rail-word">sfx</span> : <Icon name={icon} size={18} />}
        </button>
      ))}
    </nav>
  );
}

function Welcome({ onOpen, error }: { onOpen: () => void; error: string }) {
  return (
    <div className="welcome">
      <div className="drop">
        <div className="drop-icon"><Orb size={68} calm /></div>
        <h2>Drop a video here</h2>
        <p className="dim">Your footage stays on this Mac. Only the transcript goes to the AI.</p>
        <button className="primary" onClick={onOpen}>Choose video</button>
        <div className="drop-more">
          <button onClick={pickClaudeEdit} title="Open a HyperFrames video Claude made, with every layer and keyframe editable">
            <Icon name="layers" size={13} /> Open a Claude edit
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <CreatorQuote />
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
      else if ((e.metaKey || e.ctrlKey) && ["c", "v", "d"].includes(e.key.toLowerCase())) {
        const clip = act.selectedClip();
        const k = e.key.toLowerCase();
        if (k === "v") (e.preventDefault(), act.paste());
        else if (clip) (e.preventDefault(), k === "c" ? act.copy(clip) : act.duplicate(clip));
      } else if (e.metaKey || e.ctrlKey) return;
      else if (e.key === "S" && e.shiftKey) {
        const clip = act.selectedClip();
        if (clip) act.removeSilences(clip);
      } else if (e.key === "s") {
        const clip = act.selectedClip();
        if (clip && clip.kind !== "segment") act.split(clip);
        else s.split();
      } else if (e.key === "n" || e.key === "N") {
        useMagnet.getState().toggle();
      } else if (e.key === "m" || e.key === "M") {
        const clip = act.selectedClip();
        if (act.groupRefs().length) act.toggleMuteGroup();
        else if (clip && act.canMute(clip)) act.toggleMute(clip);
      } else if ((e.key === "Backspace" || e.key === "Delete") && act.groupRefs().length) s.deleteSelection();
      else if ((e.key === "Backspace" || e.key === "Delete") && s.selectedClip) {
        // A clip of a Claude edit: a shot's pictures (its titles stay), or the title or graphic.
        const m = s.plan.motion.find((x) => x.id === s.selectedClip!.scene);
        const scene = m?.scene ? s.scenes[m.scene] : undefined;
        const clip = m && scene ? clipsOf(m, scene).find((c) => c.id === s.selectedClip!.clip) : undefined;
        if (m && clip) deleteSceneClip(m, clip);
      }
      else if (e.key === "Backspace" || e.key === "Delete") s.selectedMotion !== null ? s.deleteMotion(s.selectedMotion) : s.selectedBroll !== null ? s.deleteBroll(s.selectedBroll) : s.selectedVo !== null ? s.deleteVoiceover(s.selectedVo) : s.selectedCue !== null ? s.deleteCaption(s.selectedCue) : s.deleteSelected();
      else if (e.key === "ArrowLeft") s.seek(s.time - (e.shiftKey ? 1 : frame));
      else if (e.key === "ArrowRight") s.seek(s.time + (e.shiftKey ? 1 : frame));
      else if (e.key === "Home") s.seek(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

