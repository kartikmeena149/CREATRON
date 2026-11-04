// Left panel: hands-on controls for the selected clip, the frame, captions and the voice.
// Sliders save one undo step per drag (checkpoint on press, live updates while moving).
import { useEffect, useState } from "react";
import type { EditPlan } from "../src/schema.ts";
import { isAudio, mediaUrl, shortTime, timecode } from "./format.ts";
import { Icon } from "./icons.tsx";
import { CaptionStyle } from "./CaptionStyle.tsx";
import { MotionEditor } from "./MotionEditor.tsx";
import { PositionSize } from "./PositionSize.tsx";
import { useEditor } from "./store.ts";

const TITLES = { media: "Library", clip: "Clip & frame", audio: "Audio", captions: "Captions", text: "Text" };

export function Inspector({ onOpen, onLink, onOpenMain }: { onOpen: () => void; onLink: () => void; onOpenMain: (path: string) => void }) {
  const { project, plan, selected, selectedCue, selectedMotion, leftView: view, set, commit, checkpoint, live, updateSegment } = useEditor();

  // Selecting something on the timeline opens the page that edits it.
  useEffect(() => void (selected !== null && set({ leftView: "clip" })), [selected]);
  useEffect(() => void (selectedCue !== null && set({ leftView: "captions" })), [selectedCue]);
  useEffect(() => void (selectedMotion !== null && set({ leftView: "text" })), [selectedMotion]);

  if (!view) return null;
  const head = (
    <header className="side-head">
      <h2>{TITLES[view]}</h2>
      <button className="icon-btn" title="Hide panel" onClick={() => set({ leftView: null })}><Icon name="panel" /></button>
    </header>
  );
  if (view === "media") return (
    <aside className="panel inspector">
      {head}
      <Library onAdd={onOpen} onLink={onLink} onOpenMain={onOpenMain} />
    </aside>
  );
  if (!project) return <aside className="panel inspector">{head}<p className="hint pad">Import a video first.</p></aside>;

  const seg = selected !== null ? plan.segments[selected] : undefined;
  const setPlan = (patch: Partial<EditPlan>) => commit({ ...plan, ...patch });
  const liveAudio = (patch: Partial<EditPlan["audio"]>) => live({ ...plan, audio: { ...plan.audio, ...patch } });

  return (
    <aside className="panel inspector">
      {head}
      {view === "text" && <>
        <MotionEditor />
        {!plan.motion.find((m) => m.id === selectedMotion) && (
          <section>
            <p className="hint">Animated titles sit on the Text track. Add one at the playhead, or ask the AI for "a title at the start".</p>
            <button className="wide-btn" onClick={() => useEditor.getState().addMotion("title")}>＋ Add title</button>
          </section>
        )}
      </>}

      {view === "clip" && <>
      <section>
        <h3>Clip {seg ? selected! + 1 : ""}</h3>
        {seg ? (
          <>
            <div className="meta">
              <span>In {timecode(seg.start)}</span>
              <span>Out {timecode(seg.end)}</span>
            </div>
            <Slider label="Speed" unit="×" min={0.5} max={2} step={0.05} value={seg.speed}
              onStart={checkpoint} onChange={(v) => updateSegment(selected!, { speed: v }, false)} />
            <Slider label="Punch-in zoom" unit="%" min={1} max={2} step={0.01} value={seg.zoom} display={(v) => Math.round(v * 100)}
              onStart={checkpoint} onChange={(v) => updateSegment(selected!, { zoom: v }, false)} />
            <Slider label="Volume" unit="%" min={0} max={2} step={0.01} value={seg.volume ?? 1} display={(v) => Math.round(v * 100)}
              onStart={checkpoint} onChange={(v) => updateSegment(selected!, { volume: v }, false)} />
          </>
        ) : (
          <p className="hint">Click a clip on the timeline to adjust its speed, zoom and volume. ⇧-click more clips, then tell the AI what to do with them.</p>
        )}
      </section>

      <section>
        <h3>Frame</h3>
        <Segmented
          value={plan.aspect}
          options={[["source", "Original"], ["9:16", "9:16"], ["1:1", "1:1"], ["16:9", "16:9"]]}
          onChange={(aspect) => setPlan({ aspect: aspect as EditPlan["aspect"] })}
        />
      </section>

      <PositionSize />
      </>}

      {view === "captions" && <CaptionStyle />}

      {view === "audio" && (
      <section>
        <h3>Voice</h3>
        <Row label="Clean up noise" hint="removes hiss and hum">
          <Toggle value={plan.audio.denoise} onChange={(denoise) => commit({ ...plan, audio: { ...plan.audio, denoise } })} />
        </Row>
        <Slider label="Clarity" unit=" dB" min={0} max={6} step={0.5} value={plan.audio.clarity}
          onStart={checkpoint} onChange={(v) => liveAudio({ clarity: v })} />
        <Row label="Reels loudness" hint="levels to -14 LUFS on export">
          <Toggle value={plan.audio.normalize} onChange={(normalize) => commit({ ...plan, audio: { ...plan.audio, normalize } })} />
        </Row>
        {!plan.audio.normalize && (
          <Slider label="Volume" unit=" dB" min={-12} max={12} step={0.5} value={plan.audio.volumeDb}
            onStart={checkpoint} onChange={(v) => liveAudio({ volumeDb: v })} />
        )}
        {plan.audio.denoise && <p className="hint">Noise cleanup is applied in full on export.</p>}
      </section>
      )}
    </aside>
  );
}

/** MIME type for a library video being dragged onto the timeline. */
export const MEDIA_DRAG = "application/x-creatron-media";

function Library({ onAdd, onLink, onOpenMain }: { onAdd: () => void; onLink: () => void; onOpenMain: (path: string) => void }) {
  const library = useEditor((s) => s.library);
  const [query, setQuery] = useState("");
  const shown = library.filter((p) => baseName(p).toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <div className="lib-actions">
        <label className="lib-search">
          <Icon name="search" size={14} />
          <input value={query} placeholder="Search project media…" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <button className="lib-add" onClick={onAdd}><Icon name="plus" size={14} /> Add</button>
        <button className="lib-add icon" onClick={onLink} title="Import from link"><Icon name="link" size={14} /></button>
      </div>
      {!library.length && <p className="hint pad">Add a video, or drop one anywhere in the window.</p>}
      {library.length > 0 && !shown.length && <p className="hint pad">No media matches “{query}”.</p>}
      <div className="media-grid">
        {shown.map((p) => <MediaCard key={p} path={p} onOpenMain={onOpenMain} />)}
      </div>
      {library.length > 0 && <p className="hint pad">Drag videos, music or sound effects onto any track. Double-click a video to edit it as the main video.</p>}
    </>
  );
}

function MediaCard({ path, onOpenMain }: { path: string; onOpenMain: (path: string) => void }) {
  const main = useEditor((s) => s.project?.path === path);
  const mainUrl = useEditor((s) => s.project?.videoUrl);
  const [length, setLength] = useState<number>();
  const audio = isAudio(path);
  return (
    <div
      className={`media-card ${main ? "main" : ""} ${audio ? "audio" : ""}`}
      title={path}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MEDIA_DRAG, JSON.stringify({ path, length, audio }));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDoubleClick={() => !main && !audio && onOpenMain(path)}
    >
      <div className="media-thumb">
        {audio ? (
          <>
            <div className="audio-tile"><Icon name="music" size={28} /></div>
            <audio src={mediaUrl(path)} preload="metadata" onLoadedMetadata={(e) => setLength(e.currentTarget.duration)} />
          </>
        ) : (
          <video src={`${main ? mainUrl : mediaUrl(path)}#t=1`} muted preload="metadata" onLoadedMetadata={(e) => setLength(e.currentTarget.duration)} />
        )}
        {length !== undefined && <span className="pill left">{shortTime(length)}</span>}
        {main && <span className="pill right">Main</span>}
      </div>
      <div className="media-name"><Icon name="play" size={10} fill /> <span>{baseName(path)}</span></div>
    </div>
  );
}

const baseName = (p: string) => p.split("/").pop() ?? p;

function Slider(p: {
  label: string; min: number; max: number; step: number; value: number; unit?: string;
  display?: (v: number) => string | number; onStart: () => void; onChange: (v: number) => void;
}) {
  const shown = p.display ? p.display(p.value) : Number(p.value.toFixed(2));
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{p.label}</span>
        <span className="value">{shown}{p.unit ?? ""}</span>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value}
        onPointerDown={p.onStart} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? "on" : ""} onClick={() => v !== value && onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle ${value ? "on" : ""}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}><i /></button>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <div>
        <div>{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
