// Left panel: hands-on controls for the selected clip, the frame, captions and the voice.
// Sliders save one undo step per drag (checkpoint on press, live updates while moving).
import { useEffect, useState } from "react";
import type { EditPlan } from "../src/schema.ts";
import { isAudio, mediaUrl, shortTime, timecode } from "./format.ts";
import { Icon } from "./icons.tsx";
import * as act from "./clipActions.ts";
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
  const selectedVo = useEditor((s) => s.selectedVo);
  useEffect(() => void (selectedVo !== null && set({ leftView: "audio" })), [selectedVo]);

  // More than one clip selected: one panel for all of them.
  const group = useEditor((s) => s.picked.length + s.pickedIds.length);
  if (group > 1) return <aside className="panel inspector"><GroupPanel /></aside>;

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

      {view === "audio" && <AudioClip />}

      {view === "audio" && (
      <section>
        <h3>Main track sound</h3>
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
      {library.length > 0 && <p className="hint pad">Drag videos, music or sound effects onto any track. Double-click one to make it the main track (a voice recording makes a faceless video).</p>}
    </>
  );
}

/** Several clips selected (box-select or ⇧-click): changes apply to all of them. */
function GroupPanel() {
  useEditor((s) => s.plan); // follow changes
  const { checkpoint, setSelection, deleteSelection } = useEditor();
  const refs = act.groupRefs();
  const withLevel = refs.filter((r) => r.kind === "segment" || r.kind === "audio");
  const sound = refs.filter(act.canMute);
  const allMuted = sound.length > 0 && sound.every(act.isMuted);
  const first = withLevel[0];
  const plan = useEditor.getState().plan;
  const level = !first ? 100 : first.kind === "segment" ? (plan.segments[first.index]?.volume ?? 1) * 100
    : Math.round(10 ** ((plan.voiceovers.find((v) => v.id === first.id)?.volumeDb ?? 0) / 20) * 100);
  return (
    <>
      <header className="side-head">
        <h2>{refs.length} clips</h2>
        <button className="icon-btn" title="Clear the selection" onClick={() => setSelection([], [])}><Icon name="close" /></button>
      </header>
      <section>
        <p className="hint" style={{ marginTop: 0 }}>Multiple selection</p>
        {withLevel.length > 0 && (
          <Slider label="Volume" unit="%" min={0} max={200} step={1} value={level} display={(x) => Math.round(x)}
            onStart={checkpoint} onChange={(x) => act.setGroupVolume(x, refs)} />
        )}
        {sound.length > 0 && (
          <Row label="Mute">
            <Toggle value={allMuted} onChange={() => act.toggleMuteGroup(refs)} />
          </Row>
        )}
        <button className="wide-btn danger-btn" onClick={deleteSelection}><Icon name="trash" size={13} /> Delete {refs.length} clips</button>
        <p className="hint">Changes apply to all {refs.length} selected clips. Drag any selected B-roll, text or audio clip to move them together. ⇧-click adds or removes a clip.</p>
      </section>
    </>
  );
}

/** The selected music, sound effect or voiceover clip: level and fades. */
function AudioClip() {
  const { plan, selectedVo, checkpoint, updateVoiceover } = useEditor();
  const v = plan.voiceovers.find((x) => x.id === selectedVo);
  if (!v) return null;
  const kind = { voice: "Voiceover", music: "Music", sfx: "Sound effect" }[v.kind ?? "voice"];
  const max = Math.min(5, Math.floor(v.duration * 5) / 10);
  return (
    <section>
      <h3>{kind}<span className="dim small">{v.duration.toFixed(1)}s</span></h3>
      <div className="file-name" title={v.file}>{v.text || v.file.split("/").pop()}</div>
      <Row label="Mute">
        <Toggle value={Boolean(v.muted)} onChange={(muted) => updateVoiceover(v.id, { muted })} />
      </Row>
      <Slider label="Volume" unit=" dB" min={-24} max={12} step={0.5} value={v.volumeDb}
        onStart={checkpoint} onChange={(x) => updateVoiceover(v.id, { volumeDb: x }, false)} />
      <Slider label="Fade in" min={0} max={max} step={0.1} value={Math.min(v.fadeIn ?? 0, max)} display={(x) => (x ? `${x.toFixed(1)}s` : "off")}
        onStart={checkpoint} onChange={(x) => updateVoiceover(v.id, { fadeIn: x }, false)} />
      <Slider label="Fade out" min={0} max={max} step={0.1} value={Math.min(v.fadeOut ?? 0, max)} display={(x) => (x ? `${x.toFixed(1)}s` : "off")}
        onStart={checkpoint} onChange={(x) => updateVoiceover(v.id, { fadeOut: x }, false)} />
    </section>
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
      onDoubleClick={() => !main && onOpenMain(path)}
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
