// The timeline: one row per layer (video, captions, voice), on the OUTPUT clock.
// Drag clip edges to trim, click to select, S to split, Delete to ripple-delete.
import { useEffect, useMemo, useRef, useState } from "react";
import { roughCut } from "../src/autocut.ts";
import { type Cue, buildCues, captionsOf, outputDuration, toSourceTime } from "../src/timeline.ts";
import type { Broll, EditPlan, Motion, Segment, Voiceover } from "../src/schema.ts";
import { type TrackKind, addTrack, freeTrack, removeTrack, setTrack, trackCount, trackEmpty, trackKey, trackName, trackSetting } from "../src/tracks.ts";
import { mediaUrl, shortTime } from "./format.ts";
import { Icon, type IconName } from "./icons.tsx";
import { MEDIA_DRAG } from "./Inspector.tsx";
import { type Thumbs, type Wave, useEditor } from "./store.ts";

const LABEL_W = 150;

export function Timeline({ onOpenMain }: { onOpenMain: (path: string) => void }) {
  const { project, plan, time, pxPerSec, selected, picked, past, future, markers, playing, pointing } = useEditor();
  const { seek, select, selectCue, setZoom, split, deleteSelected, undo, redo, commit, say, setPlaying, setCaptionStyle } = useEditor();
  const scroller = useRef<HTMLDivElement>(null);
  const total = outputDuration(plan);
  // The timeline never ends: there is always at least a screen of empty time past what you
  // can see, so scrolling right keeps going, like an infinite canvas.
  const [view, setView] = useState({ left: 0, w: 1000 });
  const width = Math.max(total * pxPerSec + view.w, view.left + 2 * view.w);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ left: el.scrollLeft, w: el.clientWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => (ro.disconnect(), el.removeEventListener("scroll", measure));
  }, [project]);

  // Fit the whole edit in view when a video is loaded.
  const fit = () => {
    const el = scroller.current;
    if (el && project) setZoom((el.clientWidth - 80) / Math.max(1, outputDuration(useEditor.getState().plan)));
  };
  useEffect(fit, [project]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = time * pxPerSec;
    if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  }, [Math.floor((time * pxPerSec) / 200)]);

  const segs = useMemo(() => {
    let at = 0;
    return plan.segments.map((s) => {
      const len = (s.end - s.start) / s.speed;
      const r = { s, x: at * pxPerSec, w: len * pxPerSec };
      at += len;
      return r;
    });
  }, [plan.segments, pxPerSec]);

  const cues = useMemo(() => (project ? buildCues(plan, project.analysis.words) : []), [project, plan]);
  const lanes = useMemo(() => buildLanes(plan), [plan]);

  // Scrub: click or drag on the ruler or empty track space moves the playhead.
  const scrub = (e: React.PointerEvent) => {
    const el = scroller.current!;
    const rect = el.getBoundingClientRect();
    const move = (x: number) => seek((x - rect.left + el.scrollLeft) / pxPerSec);
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const up = () => (window.removeEventListener("pointermove", onMove), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  // First pass of an edit: keep only spoken lines, drop retakes, outtakes and pauses.
  const doRoughCut = () => {
    if (!project) return;
    const r = roughCut(plan, project.analysis);
    const before = outputDuration(plan);
    const now = outputDuration(r.plan);
    if (before - now < 0.05) {
      say({ role: "assistant", text: "Rough cut: nothing left to cut. Every part of this edit is speech." });
      return;
    }
    commit(r.plan);
    const lines = ["• dead air and pauses"];
    for (const t of r.retakes) lines.push(`• retake: “${t}”`);
    for (const t of r.outtakes) lines.push(`• outtake: “${t}”`);
    say({
      role: "assistant",
      text: `Rough cut removed ${(before - now).toFixed(1)}s:\n${lines.join("\n")}`,
      before: plan,
      meta: `instant · ${before.toFixed(1)}s → ${now.toFixed(1)}s`,
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  };

  // A library video dropped on the timeline: the main video when there is none yet, else B-roll on V2 where it lands.
  const [dropping, setDropping] = useState(false);
  const dragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(MEDIA_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const drop = (e: React.DragEvent) => {
    setDropping(false);
    const data = e.dataTransfer.getData(MEDIA_DRAG);
    if (!data) return;
    e.preventDefault();
    e.stopPropagation();
    const { path, length, audio } = JSON.parse(data) as { path: string; length?: number; audio?: boolean };
    const s = useEditor.getState();
    if (!s.project) return audio ? undefined : onOpenMain(path);
    const el = scroller.current!;
    const at = (e.clientX - el.getBoundingClientRect().left + el.scrollLeft) / s.pxPerSec;
    const len = length && Number.isFinite(length) ? length : 5;
    const name = path.split("/").pop();
    // It lands on the track under the pointer when that track takes it, else the first free one.
    const lane = laneAt(e.clientX, e.clientY);
    if (audio) {
      const kind = lane && (lane.kind === "voice" || lane.kind === "music" || lane.kind === "sfx") ? lane.kind : "music";
      const track = lane?.kind === kind ? lane.n : freeTrack(s.plan, kind, at, len);
      s.addVoiceover({ file: path, duration: len, text: name ?? "", voice: "", kind, track, at, volumeDb: kind === "music" ? -12 : kind === "sfx" ? -4 : 0 });
    } else {
      const track = lane?.kind === "video" && lane.n > 1 ? lane.n : freeTrack(s.plan, "video", at, len);
      s.addBroll({ file: path, length: len, duration: len, at, source: `library:${path}`, query: name, track });
    }
  };
  const dropProps = { onDragOver: dragOver, onDragLeave: () => setDropping(false), onDrop: drop };

  if (!project) return (
    <div className={`timeline empty ${dropping ? "dropping" : ""}`} {...dropProps}>
      <div className="tl-empty">Drop media to start</div>
    </div>
  );
  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <div className="tl-left">
          <span className="tc"><b>{shortTime(time)}</b> / {shortTime(total)}</span>
          <span className="sep" />
          <button className="icon-btn" title="Undo (⌘Z)" disabled={!past.length} onClick={undo}><Icon name="undo" /></button>
          <button className="icon-btn" title="Redo (⇧⌘Z)" disabled={!future.length} onClick={redo}><Icon name="redo" /></button>
          <span className="sep" />
          <button className="icon-btn" title="Split at playhead (S)" onClick={split}><Icon name="scissors" /></button>
          <button className="icon-btn" title="Delete clip (⌫)" disabled={selected === null || plan.segments.length < 2} onClick={deleteSelected}>
            <Icon name="trash" />
          </button>
          <button className="icon-btn" title="Add an animated title at the playhead" onClick={() => useEditor.getState().addMotion("title")}><Icon name="type" /></button>
          <button className="icon-btn rough-cut" title="Rough cut: keep only what you say. Cuts dead air, pauses, retakes and outtakes (instant, undoable)" onClick={doRoughCut}>
            <Icon name="bolt" />
          </button>
        </div>
        <div className="tl-transport">
          <button className="icon-btn" title="Back to start" onClick={() => seek(0)}><Icon name="skipBack" /></button>
          <button className="icon-btn play" title="Play / pause (Space)" onClick={() => setPlaying(!playing)}>
            <Icon name={playing ? "pause" : "play"} size={18} fill />
          </button>
          <button className="icon-btn" title="Go to end" onClick={() => seek(total)}><Icon name="skipFwd" /></button>
        </div>
        <div className="tl-right">
          <span className="dim small">{plan.segments.length} {plan.segments.length === 1 ? "clip" : "clips"}</span>
          <div className="zoom">
            <button className="icon-btn" onClick={() => setZoom(pxPerSec / 1.4)} title="Zoom out"><Icon name="zoomOut" /></button>
            <input
              type="range"
              min={Math.log(2)}
              max={Math.log(400)}
              step={0.01}
              value={Math.log(pxPerSec)}
              onChange={(e) => setZoom(Math.exp(Number(e.target.value)))}
            />
            <button className="icon-btn" onClick={() => setZoom(pxPerSec * 1.4)} title="Zoom in"><Icon name="zoomIn" /></button>
          </div>
          <button
            className={`icon-btn ${pointing ? "on point" : ""}`}
            title="Point at a problem: click on the video to drop a marker (at this moment and spot) for the AI"
            onClick={() => useEditor.getState().set({ pointing: !pointing })}
          >
            <Icon name="pin" />
          </button>
          <button className="icon-btn" title="Fit the whole edit" onClick={fit}><Icon name="expand" /></button>
        </div>
      </div>

      <div className="tl-body">
        <div className="tl-labels" style={{ width: LABEL_W }}>
          <div className="tl-ruler-spacer"><AddTrackMenu /></div>
          {lanes.map((l) => <TrackLabel key={l.key} lane={l} />)}
        </div>

        <div className={`tl-scroll ${dropping ? "dropping" : ""}`} ref={scroller} onWheel={onWheel} {...dropProps}>
          <div className="tl-content" style={{ width }}>
            <Ruler from={(view.left - view.w) / pxPerSec} to={width / pxPerSec} pxPerSec={pxPerSec} onPointerDown={scrub} />
            {markers.map((m) => (
              <div
                key={m.n}
                className="ruler-marker"
                style={{ left: m.time * pxPerSec }}
                title={`Marker ${m.n}: click to go there`}
                onPointerDown={(e) => (e.stopPropagation(), useEditor.getState().seek(m.time))}
              >
                {m.n}
              </div>
            ))}

            {lanes.map((l) => {
              const off = laneOff(plan, l);
              const clear = (e: React.PointerEvent) => {
                if (e.target !== e.currentTarget) return;
                const st = useEditor.getState();
                st.select(null), st.selectCue(null), st.selectBroll(null), st.selectMotion(null), st.selectVo(null);
                scrub(e);
              };
              return (
                <div key={l.key} className={`track ${l.kind} ${off ? "off" : ""}`} data-lane={l.key} style={{ height: l.height }} onPointerDown={clear}>
                  {l.kind === "text" && plan.motion.filter((m) => (m.track ?? 1) === l.n).map((m) => <MotionBlock key={m.id} m={m} />)}
                  {l.kind === "video" && l.n! > 1 && plan.broll.filter((b) => (b.track ?? 2) === l.n).map((b) => <BrollBlock key={b.id} b={b} />)}
                  {l.kind === "video" && l.n === 1 && segs.map(({ s, x, w }, i) => (
                    <Clip key={i} index={i} seg={s} x={x} w={w} selected={picked.includes(i)} thumbs={project.thumbs} />
                  ))}
                  {l.kind === "captions" && cues.map((c) => <CueBlock key={c.index} cue={c} />)}
                  {l.kind === "audio" && segs.map(({ s, x, w }, i) => (
                    <WaveClip key={i} seg={s} x={x} w={w} wave={project.wave} selected={picked.includes(i)} />
                  ))}
                  {(l.kind === "voice" || l.kind === "music" || l.kind === "sfx") &&
                    plan.voiceovers.filter((v) => (v.kind ?? "voice") === l.kind && (v.track ?? 1) === l.n).map((v) => <VoiceoverBlock key={v.id} vo={v} />)}
                  {l.n !== undefined && trackEmpty(plan, l.kind as TrackKind, l.n) && l.n === 1 + Number(l.kind === "video") && (
                    <span className="track-empty">{EMPTY_HINT[l.kind as TrackKind]}</span>
                  )}
                </div>
              );
            })}

            <div className="playhead" style={{ left: time * pxPerSec }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The track lane under a point on screen, e.g. { kind: "music", n: 2 }. */
function laneAt(x: number, y: number): { kind: string; n: number } | null {
  const el = document.elementsFromPoint(x, y).find((e) => e instanceof HTMLElement && e.dataset.lane) as HTMLElement | undefined;
  if (!el) return null;
  const [kind, n] = el.dataset.lane!.split(":");
  return { kind, n: Number(n || 0) };
}

type Lane = { key: string; kind: TrackKind | "captions" | "audio"; n?: number; height: number };

/** Top to bottom: Text N…1, Track N…1, Captions, the main audio, Voiceover / Music / SFX 1…N. */
function buildLanes(plan: EditPlan): Lane[] {
  const lanes: Lane[] = [];
  const range = (kind: TrackKind, from: number, down: boolean) => {
    const n = trackCount(plan, kind);
    const list = Array.from({ length: n - from + 1 }, (_, i) => from + i);
    return down ? list.reverse() : list;
  };
  for (const n of range("text", 1, true)) lanes.push({ key: trackKey("text", n), kind: "text", n, height: 40 });
  for (const n of range("video", 1, true)) lanes.push({ key: trackKey("video", n), kind: "video", n, height: 58 });
  lanes.push({ key: "captions", kind: "captions", height: 46 });
  lanes.push({ key: "audio", kind: "audio", height: 52 });
  for (const kind of ["voice", "music", "sfx"] as const) for (const n of range(kind, 1, false)) lanes.push({ key: trackKey(kind, n), kind, n, height: 46 });
  return lanes;
}

/** Whether a lane is switched off (hidden or muted), so it shows dimmed. */
function laneOff(plan: EditPlan, l: Lane): boolean {
  if (l.kind === "captions") return !plan.captions.enabled;
  if (l.kind === "audio") return Boolean(trackSetting(plan, "video:1").muted);
  const t = trackSetting(plan, l.key);
  return Boolean(t.hidden || t.muted);
}

const EMPTY_HINT: Record<TrackKind, string> = {
  text: "Animated titles: Aa above, or ask the AI \"add a title at the start\"",
  video: "Drop a video from the library, or ask the AI for B-roll",
  voice: "Make a voiceover in the Voice tab",
  music: "Drop music from the library",
  sfx: "Drop sound effects from the library",
};
const LANE_ICON: Record<Lane["kind"], IconName> = { text: "type", video: "video", captions: "cc", audio: "mic", voice: "mic", music: "music", sfx: "bolt" };

function TrackLabel({ lane }: { lane: Lane }) {
  const plan = useEditor((s) => s.plan);
  const commit = useEditor((s) => s.commit);
  const setCaptionStyle = useEditor((s) => s.setCaptionStyle);
  const [editing, setEditing] = useState(false);
  const kind = lane.kind;
  const name = kind === "audio" ? "Audio" : trackName(plan, kind as TrackKind | "captions", lane.n);
  const t = trackSetting(plan, kind === "audio" ? "video:1" : lane.key);
  const canMute = kind === "audio" || kind === "voice" || kind === "music" || kind === "sfx";
  const canHide = kind === "text" || kind === "captions" || (kind === "video" && lane.n! > 1);
  const canRename = kind !== "audio";
  const canDelete = lane.n !== undefined && (kind === "video" ? lane.n > 1 : true) && trackCount(plan, kind as TrackKind) > (kind === "video" ? 2 : 1) && trackEmpty(plan, kind as TrackKind, lane.n);
  return (
    <div className={`track-label ${kind} ${laneOff(plan, lane) ? "off" : ""}`} style={{ height: lane.height }}>
      <Icon name={LANE_ICON[kind]} size={13} />
      {editing ? (
        <input
          className="track-name-input"
          autoFocus
          defaultValue={name}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={(e) => {
            setEditing(false);
            const value = e.currentTarget.value.trim();
            if (value !== name) commit(setTrack(plan, lane.key, { name: value || undefined }));
          }}
        />
      ) : (
        <span className="track-name" title={canRename ? "Double-click to rename" : undefined} onDoubleClick={() => canRename && setEditing(true)}>{name}</span>
      )}
      <span className="track-tools">
        {canDelete && (
          <button className="track-btn del" title="Remove this empty track" onClick={() => commit(removeTrack(plan, kind as TrackKind, lane.n!))}>
            <Icon name="close" size={12} />
          </button>
        )}
        {canMute && (
          <button className={`track-btn m ${t.muted ? "on" : ""}`} title={t.muted ? "Unmute" : "Mute"}
            onClick={() => commit(setTrack(plan, kind === "audio" ? "video:1" : lane.key, { muted: !t.muted }))}>M</button>
        )}
        {canHide && (
          <button className="track-btn" title={laneOff(plan, lane) ? "Show" : "Hide"}
            onClick={() => kind === "captions" ? setCaptionStyle({ enabled: !plan.captions.enabled }) : commit(setTrack(plan, lane.key, { hidden: !t.hidden }))}>
            <Icon name={laneOff(plan, lane) ? "eyeOff" : "eye"} size={14} />
          </button>
        )}
      </span>
    </div>
  );
}

function AddTrackMenu() {
  const [open, setOpen] = useState(false);
  const plan = useEditor((s) => s.plan);
  const commit = useEditor((s) => s.commit);
  const add = (kind: TrackKind) => (commit(addTrack(plan, kind)), setOpen(false));
  return (
    <div className="add-track">
      <button className="add-track-btn" onClick={() => setOpen(!open)} title="Add a track"><Icon name="plus" size={13} /> Track</button>
      {open && (
        <>
          <div className="menu-catcher" onPointerDown={() => setOpen(false)} />
          <div className="menu">
            <button onClick={() => add("video")}><Icon name="video" size={13} /> Video track</button>
            <button onClick={() => add("text")}><Icon name="type" size={13} /> Text track</button>
            <button onClick={() => add("music")}><Icon name="music" size={13} /> Music track</button>
            <button onClick={() => add("sfx")}><Icon name="bolt" size={13} /> SFX track</button>
            <button onClick={() => add("voice")}><Icon name="mic" size={13} /> Voiceover track</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Ticks from `from` to `to` seconds (only around what's in view, since the timeline is endless). */
function Ruler({ from, to, pxPerSec, onPointerDown }: { from: number; to: number; pxPerSec: number; onPointerDown: (e: React.PointerEvent) => void }) {
  // Pick a label step that keeps labels ~80px apart.
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pxPerSec >= 80) ?? 600;
  const ticks = [];
  for (let t = Math.max(0, Math.floor(from / step) * step); t <= to; t += step / 5) {
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    ticks.push(
      <div key={t.toFixed(3)} className={`tick ${major ? "major" : ""}`} style={{ left: t * pxPerSec }}>
        {major && <span>{shortTime(t)}</span>}
      </div>,
    );
  }
  return <div className="tl-ruler" onPointerDown={onPointerDown}>{ticks}</div>;
}

function Clip({ index, seg, x, w, selected, thumbs }: { index: number; seg: Segment; x: number; w: number; selected: boolean; thumbs: Thumbs }) {
  const { select, togglePick, seek, checkpoint, updateSegment, project, pxPerSec } = useEditor();
  const duration = project!.analysis.duration;

  // Thumbnail tiles: each shows the source frame at its position in the clip.
  const tileW = thumbs.frameW * (40 / thumbs.frameH);
  const tiles = [];
  for (let tx = 0; tx < w; tx += tileW) {
    const srcT = seg.start + (tx / pxPerSec) * seg.speed;
    const n = Math.min(thumbs.count - 1, Math.floor(srcT / thumbs.interval));
    const col = n % thumbs.cols;
    const row = Math.floor(n / thumbs.cols);
    const scale = 40 / thumbs.frameH;
    tiles.push(
      <div
        key={tx}
        className="thumb"
        style={{
          left: tx,
          width: tileW,
          backgroundImage: `url("${thumbs.url}")`,
          backgroundSize: `${thumbs.cols * thumbs.frameW * scale}px auto`,
          backgroundPosition: `-${col * thumbs.frameW * scale}px -${row * thumbs.frameH * scale}px`,
        }}
      />,
    );
  }

  const trim = (edge: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    select(index);
    checkpoint();
    const x0 = e.clientX;
    const orig = { ...seg };
    const onMove = (ev: PointerEvent) => {
      const d = ((ev.clientX - x0) / pxPerSec) * orig.speed; // pixels -> source seconds
      if (edge === "start") updateSegment(index, { start: Math.max(0, Math.min(orig.end - 0.1, orig.start + d)) }, false);
      else updateSegment(index, { end: Math.min(duration, Math.max(orig.start + 0.1, orig.end + d)) }, false);
    };
    const up = () => (window.removeEventListener("pointermove", onMove), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  const volume = seg.volume ?? 1;
  const badges = [
    seg.speed !== 1 && `${seg.speed}×`,
    seg.zoom > 1 && `zoom ${Math.round(seg.zoom * 100)}%`,
    volume !== 1 && (volume === 0 ? "muted" : `vol ${Math.round(volume * 100)}%`),
  ].filter(Boolean);
  return (
    <div
      className={`clip ${selected ? "selected" : ""}`}
      style={{ left: x, width: Math.max(4, w - 1) }}
      onPointerDown={(e) => {
        // ⇧/⌘-click picks several clips for one AI request.
        if (e.shiftKey || e.metaKey) return togglePick(index);
        select(index);
        const rect = e.currentTarget.getBoundingClientRect();
        seek((x + e.clientX - rect.left) / pxPerSec);
      }}
    >
      <div className="thumbs">{tiles}</div>
      <div className="clip-label">
        <span>Take {index + 1}</span>
        {badges.map((b) => <span key={String(b)} className="badge">{b}</span>)}
      </div>
      <div className="handle left" onPointerDown={trim("start")} />
      <div className="handle right" onPointerDown={trim("end")} />
    </div>
  );
}

function WaveClip({ seg, x, w, wave, selected }: { seg: Segment; x: number; w: number; wave: Wave; selected: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const width = Math.max(1, Math.floor(w));
    const height = 44;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = selected ? "#5eead4" : "#2dd4bf";
    const from = seg.start * wave.rate;
    const per = ((seg.end - seg.start) * wave.rate) / width;
    for (let px = 0; px < width; px += 2) {
      let peak = 0;
      for (let k = Math.floor(from + px * per); k < from + (px + 2) * per; k++) peak = Math.max(peak, wave.peaks[k] ?? 0);
      const h = Math.max(1, peak * (height - 6));
      ctx.fillRect(px, (height - h) / 2, 1.4, h);
    }
  }, [seg.start, seg.end, w, wave, selected]);
  return (
    <div className={`wave-clip ${selected ? "selected" : ""}`} style={{ left: x, width: Math.max(4, w - 1) }}>
      <canvas ref={canvas} style={{ width: Math.max(1, Math.floor(w)), height: 44 }} />
    </div>
  );
}

/** A caption on the T1 track: click to select and jump to it, drag an edge to change when it shows. */
function CueBlock({ cue }: { cue: Cue }) {
  const { pxPerSec, selectedCue, selectCue, seek, setPlaying } = useEditor();
  const selected = selectedCue === cue.index;

  const retime = (edge: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    selectCue(cue.index);
    const st = useEditor.getState();
    st.checkpoint();
    const x0 = e.clientX;
    const from = edge === "start" ? cue.start : cue.end;
    const caption = captionsOf(st.plan, st.project!.analysis.words)[cue.index];
    const onMove = (ev: PointerEvent) => {
      const s = useEditor.getState();
      const t = Math.max(0, from + (ev.clientX - x0) / pxPerSec);
      const src = toSourceTime(s.plan, t); // timeline position -> moment in the recording
      if (edge === "start") s.editCaption(cue.index, { start: Math.min(src, caption.end - 0.1) }, false);
      else s.editCaption(cue.index, { end: Math.max(src, caption.start + 0.1) }, false);
    };
    const up = () => (window.removeEventListener("pointermove", onMove), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={`cue ${selected ? "selected" : ""}`}
      style={{ left: cue.start * pxPerSec, width: Math.max(4, (cue.end - cue.start) * pxPerSec - 1) }}
      title={`${cue.text}\nClick to select · drag the edges to retime · ⌫ to delete`}
      onPointerDown={(e) => {
        e.stopPropagation();
        setPlaying(false);
        selectCue(cue.index);
        seek(cue.start + 0.01);
      }}
      onDoubleClick={() => useEditor.getState().set({ rightTab: "captions" })}
    >
      <span>{cue.text}</span>
      <div className="handle left" onPointerDown={retime("start")} />
      <div className="handle right" onPointerDown={retime("end")} />
    </div>
  );
}

/** A voiceover on A2: drag to move it in time, drag an edge to trim, click to select. */
function VoiceoverBlock({ vo }: { vo: Voiceover }) {
  const { pxPerSec, selectedVo, selectVo } = useEditor();
  const total = useEditor((s) => outputDuration(s.plan));
  const selected = selectedVo === vo.id;

  const drag = (mode: "move" | "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    selectVo(vo.id);
    const x0 = e.clientX;
    const orig = { ...vo };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) / pxPerSec;
      if (!moved) {
        if (Math.abs(ev.clientX - x0) < 3) return;
        moved = true;
        useEditor.getState().checkpoint();
      }
      const up = useEditor.getState().updateVoiceover;
      if (mode === "move") {
        // Dragging up or down moves it to another Voiceover / Music / SFX track.
        const lane = laneAt(ev.clientX, ev.clientY);
        const to = lane && (lane.kind === "voice" || lane.kind === "music" || lane.kind === "sfx") ? { kind: lane.kind as Voiceover["kind"], track: lane.n } : {};
        up(vo.id, { at: Math.max(0, Math.min(total - orig.duration, orig.at + d)), ...to }, false);
      }
      else if (mode === "start") {
        // Trim the front: start later in the file and later on the timeline.
        const dd = Math.max(-orig.offset, Math.min(orig.duration - 0.2, d));
        up(vo.id, { offset: orig.offset + dd, at: Math.max(0, orig.at + dd), duration: orig.duration - dd }, false);
      } else {
        const max = Math.min((orig.length ?? Infinity) - orig.offset, total - orig.at);
        up(vo.id, { duration: Math.max(0.2, Math.min(max, orig.duration + d)) }, false);
      }
    };
    const end = () => (window.removeEventListener("pointermove", onMove), window.removeEventListener("pointerup", end));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
  };

  return (
    <div
      className={`vo-clip ${vo.kind ?? "voice"} ${selected ? "selected" : ""}`}
      style={{ left: vo.at * pxPerSec, width: Math.max(6, vo.duration * pxPerSec - 1) }}
      onPointerDown={drag("move")}
      onDoubleClick={() => (vo.kind ?? "voice") === "voice" && useEditor.getState().set({ rightTab: "voice" })}
      title={`${vo.voice ? `${vo.voice}: ` : ""}${vo.text}\nDrag to move (up or down to change track) · drag edges to trim · ⌫ to delete`}
    >
      <span className="vo-label">{(vo.kind ?? "voice") === "voice" ? "🎙" : vo.kind === "music" ? "♪" : "✦"} {vo.text || vo.file.split("/").pop()}</span>
      <div className="handle left" onPointerDown={drag("start")} />
      <div className="handle right" onPointerDown={drag("end")} />
    </div>
  );
}

/** A title or lower third on M1: drag to move, drag edges to trim, click to edit it in the inspector. */
function MotionBlock({ m }: { m: Motion }) {
  const { pxPerSec, selectedMotion, selectMotion } = useEditor();
  const total = useEditor((s) => outputDuration(s.plan));
  const drag = (mode: "move" | "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    selectMotion(m.id);
    const x0 = e.clientX;
    const orig = { ...m };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) / pxPerSec;
      if (!moved) {
        if (Math.abs(ev.clientX - x0) < 3) return;
        moved = true;
        useEditor.getState().checkpoint();
      }
      const up = useEditor.getState().updateMotion;
      if (mode === "move") {
        const lane = laneAt(ev.clientX, ev.clientY);
        up(m.id, { at: Math.max(0, Math.min(total - orig.duration, orig.at + d)), ...(lane?.kind === "text" ? { track: lane.n } : {}) }, false);
      }
      else if (mode === "start") {
        const dd = Math.max(-orig.at, Math.min(orig.duration - 0.5, d));
        up(m.id, { at: orig.at + dd, duration: orig.duration - dd }, false);
      } else up(m.id, { duration: Math.max(0.5, Math.min(total - orig.at, orig.duration + d)) }, false);
    };
    const end = () => (window.removeEventListener("pointermove", onMove), window.removeEventListener("pointerup", end));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
  };
  return (
    <div
      className={`motion-clip ${selectedMotion === m.id ? "selected" : ""}`}
      style={{ left: m.at * pxPerSec, width: Math.max(6, m.duration * pxPerSec - 1), borderLeftColor: m.color }}
      onPointerDown={drag("move")}
      title={`${m.template === "custom" ? `Custom animation ${m.component}` : m.template === "title" ? "Title" : "Lower third"}: ${m.text}\nDrag to move · drag edges to trim · ⌫ to delete`}
    >
      <span>{m.template === "custom" ? `✦ ${m.component}` : m.template === "title" ? "T" : "▭"} {m.text}</span>
      <div className="handle left" onPointerDown={drag("start")} />
      <div className="handle right" onPointerDown={drag("end")} />
    </div>
  );
}

/** Where a B-roll clip came from, shown on its block (stock libraries and CC BY ask for credit). */
function brollSource(b: Broll): string {
  if (b.source.startsWith("pexels:")) return "Pexels";
  if (b.source.startsWith("pixabay:")) return "Pixabay";
  if (b.source.startsWith("library:")) return "Library";
  // Web and link clips: "Title by Channel (YouTube, CC BY) url" → "Channel · YouTube, CC BY"
  const m = b.credit?.match(/^.* by (.+?) \(([^)]+)\) \S+$/);
  return m ? `${m[1]} · ${m[2]}` : b.source.startsWith("link:") ? "Link" : "Web";
}

/** A B-roll clip on V2: drag to move, drag edges to trim, click to select, ⌫ to delete. */
function BrollBlock({ b }: { b: Broll }) {
  const { pxPerSec, selectedBroll, selectBroll } = useEditor();
  const total = useEditor((s) => outputDuration(s.plan));
  const selected = selectedBroll === b.id;
  const drag = (mode: "move" | "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    selectBroll(b.id);
    const x0 = e.clientX;
    const orig = { ...b };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) / pxPerSec;
      if (!moved) {
        if (Math.abs(ev.clientX - x0) < 3) return;
        moved = true;
        useEditor.getState().checkpoint();
      }
      const up = useEditor.getState().updateBroll;
      if (mode === "move") {
        const lane = laneAt(ev.clientX, ev.clientY);
        up(b.id, { at: Math.max(0, Math.min(total - orig.duration, orig.at + d)), ...(lane?.kind === "video" && lane.n > 1 ? { track: lane.n } : {}) }, false);
      }
      else if (mode === "start") {
        const dd = Math.max(-orig.offset, Math.min(orig.duration - 0.5, d));
        up(b.id, { offset: orig.offset + dd, at: Math.max(0, orig.at + dd), duration: orig.duration - dd }, false);
      } else {
        const max = Math.min((orig.length ?? Infinity) - orig.offset, total - orig.at);
        up(b.id, { duration: Math.max(0.5, Math.min(max, orig.duration + d)) }, false);
      }
    };
    const end = () => (window.removeEventListener("pointermove", onMove), window.removeEventListener("pointerup", end));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
  };
  return (
    <div
      className={`broll-clip ${selected ? "selected" : ""}`}
      style={{ left: b.at * pxPerSec, width: Math.max(6, b.duration * pxPerSec - 1) }}
      onPointerDown={drag("move")}
      title={`${b.query ?? b.source}${b.credit ? `\nVideo: ${b.credit}` : ""}\nDrag to move · drag edges to trim · ⌫ to delete`}
    >
      {b.file && <video className="broll-thumb" src={`${mediaUrl(b.file)}#t=${(b.offset + 0.5).toFixed(1)}`} muted preload="metadata" />}
      <span className="broll-label">{b.query ?? b.source}</span>
      {/* Stock libraries ask apps to show where their videos come from. */}
      <span className="broll-source">{brollSource(b)}</span>
      <div className="handle left" onPointerDown={drag("start")} />
      <div className="handle right" onPointerDown={drag("end")} />
    </div>
  );
}
