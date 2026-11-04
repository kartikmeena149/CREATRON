// The timeline: one row per layer (video, captions, voice), on the OUTPUT clock.
// Drag clip edges to trim, click to select, S to split, Delete to ripple-delete.
import { useEffect, useMemo, useRef, useState } from "react";
import { roughCut } from "../src/autocut.ts";
import { type Cue, buildCues, captionsOf, outputDuration, toSourceTime } from "../src/timeline.ts";
import type { Broll, EditPlan, Motion, Segment, Voiceover } from "../src/schema.ts";
import { type TrackKind, brollSound, freeTrack, setTrack, trackCount, trackKey, trackName, trackSetting } from "../src/tracks.ts";
import { wholeVideo } from "../src/autocut.ts";
import { mediaUrl, shortTime } from "./format.ts";
import { Icon, type IconName } from "./icons.tsx";
import { MEDIA_DRAG } from "./Inspector.tsx";
import { openClipMenu } from "./ClipMenu.tsx";
import { type Thumbs, type Wave, selectionOf, useEditor } from "./store.ts";

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
  const lanes = useMemo(() => buildLanes(plan, project?.analysis.hasAudio ?? false), [plan, project]);

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

  // Drag on empty track space: a box that selects every clip it touches, on any track (⇧ adds to
  // what's selected). A plain click moves the playhead and clears the selection.
  const content = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ box: React.CSSProperties; count: number } | null>(null);
  const boxSelect = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget || e.button !== 0 || !content.current) return;
    const el = content.current;
    const x0 = e.clientX, y0 = e.clientY;
    const keep = e.shiftKey || e.metaKey ? selectionOf(useEditor.getState()) : { segments: [], ids: [] };
    let boxing = false;
    const onMove = (ev: PointerEvent) => {
      if (!boxing && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      boxing = true;
      const l = Math.min(x0, ev.clientX), r = Math.max(x0, ev.clientX), t = Math.min(y0, ev.clientY), b = Math.max(y0, ev.clientY);
      const c = el.getBoundingClientRect();
      const segments = new Set(keep.segments), ids = new Set(keep.ids);
      for (const clip of el.querySelectorAll<HTMLElement>("[data-sel]")) {
        const k = clip.getBoundingClientRect();
        if (k.right < l || k.left > r || k.bottom < t || k.top > b) continue;
        const [kind, value] = clip.dataset.sel!.split(/:(.*)/);
        if (kind === "seg") segments.add(Number(value));
        else ids.add(value);
      }
      useEditor.getState().setSelection([...segments], [...ids]);
      setMarquee({ box: { left: l - c.left, top: t - c.top, width: r - l, height: b - t }, count: segments.size + ids.size });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (boxing) return;
      if (!(ev.shiftKey || ev.metaKey)) useEditor.getState().setSelection([], []), useEditor.getState().selectCue(null);
      const s = useEditor.getState();
      s.seek((ev.clientX - el.getBoundingClientRect().left) / s.pxPerSec);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
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
    // An empty tab takes it as the main track: a video, or a voice recording for a faceless video.
    if (!s.project) return onOpenMain(path);
    // An emptied timeline takes its main track back on Track 1; another video opens as its own project.
    if (!s.plan.segments.length && path === s.project.path) return s.commit({ ...s.plan, segments: wholeVideo(s.project.analysis).segments });
    if (!audio && !s.plan.segments.length) return onOpenMain(path);
    const el = scroller.current!;
    const at = (e.clientX - el.getBoundingClientRect().left + el.scrollLeft) / s.pxPerSec;
    const len = length && Number.isFinite(length) ? length : 5;
    const name = path.split("/").pop();
    // It lands on the track under the pointer when that track takes it, else the first free one.
    const lane = laneAt(e.clientX, e.clientY);
    if (audio) {
      const kind = lane && (lane.kind === "voice" || lane.kind === "music" || lane.kind === "sfx") ? lane.kind : "music";
      // Dropped in the space under the tracks: a new track of its own.
      const track = lane?.kind === kind ? lane.n : lane?.kind === "below" ? trackCount(s.plan, kind) + 1 : freeTrack(s.plan, kind, at, len);
      s.addVoiceover({ file: path, duration: len, text: name ?? "", voice: "", kind, track, at, volumeDb: kind === "music" ? -12 : kind === "sfx" ? -4 : 0 });
    } else {
      // On a video track it goes there; above all the tracks, onto a new top track.
      const track = lane?.kind === "video" && lane.n > 1 ? lane.n
        : lane?.kind === "above" || lane?.kind === "text" ? Math.max(2, trackCount(s.plan, "video") + 1)
        : freeTrack(s.plan, "video", at, len);
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
          <button className="icon-btn" title="Delete clip (⌫)" disabled={selected === null} onClick={deleteSelected}>
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
          <div className="tl-ruler-spacer" />
          {lanes.map((l) => <TrackLabel key={l.key} lane={l} />)}
        </div>

        <div className={`tl-scroll ${dropping ? "dropping" : ""}`} ref={scroller} onWheel={onWheel} {...dropProps}>
          <div className="tl-content" ref={content} style={{ width }}>
            {marquee && <div className="marquee" style={marquee.box}><span>{marquee.count} {marquee.count === 1 ? "clip" : "clips"} · ⇧ add or remove</span></div>}
            <Ruler lane="above" from={(view.left - view.w) / pxPerSec} to={width / pxPerSec} pxPerSec={pxPerSec} onPointerDown={scrub} />
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
              return (
                <div key={l.key} className={`track ${l.kind} ${off ? "off" : ""}`} data-lane={l.key} style={{ height: l.height }} onPointerDown={boxSelect}>
                  {l.kind === "text" && plan.motion.filter((m) => (m.track ?? 1) === l.n).map((m) => <MotionBlock key={m.id} m={m} />)}
                  {l.kind === "video" && l.n! > 1 && plan.broll.filter((b) => (b.track ?? 2) === l.n).map((b) => <BrollBlock key={b.id} b={b} />)}
                  {l.kind === "video" && l.n === 1 && segs.map(({ s, x, w }, i) => (
                    <Clip key={i} index={i} seg={s} x={x} w={w} selected={picked.includes(i)} thumbs={project.thumbs} />
                  ))}
                  {l.kind === "captions" && cues.map((c) => <CueBlock key={c.index} cue={c} />)}
                  {l.kind === "audio" && segs.map(({ s, x, w }, i) => (
                    <WaveClip key={i} index={i} seg={s} x={x} w={w} wave={project.wave} selected={picked.includes(i)} />
                  ))}
                  {(l.kind === "voice" || l.kind === "music" || l.kind === "sfx") &&
                    plan.voiceovers.filter((v) => (v.kind ?? "voice") === l.kind && (v.track ?? 1) === l.n).map((v) => <VoiceoverBlock key={v.id} vo={v} />)}
                </div>
              );
            })}

            {/* The space under the tracks: drop or drag a clip here to give it a new track. */}
            <div className="track below" data-lane="below" onPointerDown={boxSelect}>
              {!lanes.length && <span className="tl-empty-hint">Drop videos, music or sound effects here</span>}
            </div>

            <div className="playhead" style={{ left: time * pxPerSec }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Drags every selected B-roll, text and audio clip by the same amount (main-track clips stay put:
 * they play back to back). Returns false when the clip isn't part of a multi-selection.
 */
function moveGroup(id: string, x0: number): boolean {
  const st = useEditor.getState();
  if (!st.pickedIds.includes(id) || st.pickedIds.length + st.picked.length < 2) return false;
  const ids = new Set(st.pickedIds);
  const orig = new Map([...st.plan.broll, ...st.plan.motion, ...st.plan.voiceovers].filter((c) => ids.has(c.id)).map((c) => [c.id, c.at]));
  let moved = false;
  const onMove = (ev: PointerEvent) => {
    const s = useEditor.getState();
    if (!moved) {
      if (Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      s.checkpoint();
    }
    const d = (ev.clientX - x0) / s.pxPerSec;
    const total = outputDuration(s.plan);
    const shift = <T extends { id: string; at: number; duration: number }>(c: T): T =>
      orig.has(c.id) ? { ...c, at: Math.max(0, Math.min(total - c.duration, orig.get(c.id)! + d)) } : c;
    s.live({ ...s.plan, broll: s.plan.broll.map(shift), motion: s.plan.motion.map(shift), voiceovers: s.plan.voiceovers.map(shift) });
  };
  const end = () => (window.removeEventListener("pointermove", onMove), window.removeEventListener("pointerup", end));
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", end);
  return true;
}

/** The track lane under a point on screen, e.g. { kind: "music", n: 2 }. */
function laneAt(x: number, y: number): { kind: string; n: number } | null {
  const el = document.elementsFromPoint(x, y).find((e) => e instanceof HTMLElement && e.dataset.lane) as HTMLElement | undefined;
  if (!el) return null;
  const [kind, n] = el.dataset.lane!.split(":");
  return { kind, n: Number(n || 0) };
}

type Lane = { key: string; kind: TrackKind | "captions" | "audio"; n?: number; height: number };

/**
 * Top to bottom: Text N…1, Track N…1, Captions, the main audio, Voiceover / Music / SFX 1…N.
 * Only tracks with something on them are listed (captions while they're on).
 */
function buildLanes(plan: EditPlan, hasAudio: boolean): Lane[] {
  const lanes: Lane[] = [];
  const range = (kind: TrackKind, from: number, down: boolean) => {
    const n = trackCount(plan, kind);
    const list = Array.from({ length: n - from + 1 }, (_, i) => from + i);
    return down ? list.reverse() : list;
  };
  for (const n of range("text", 1, true)) lanes.push({ key: trackKey("text", n), kind: "text", n, height: 40 });
  for (const n of range("video", plan.segments.length ? 1 : 2, true)) lanes.push({ key: trackKey("video", n), kind: "video", n, height: 58 });
  if (plan.captions.enabled && plan.segments.length) lanes.push({ key: "captions", kind: "captions", height: 46 });
  if (hasAudio && plan.segments.length) lanes.push({ key: "audio", kind: "audio", height: 52 });
  for (const kind of ["voice", "music", "sfx"] as const) for (const n of range(kind, 1, false)) lanes.push({ key: trackKey(kind, n), kind, n, height: 46 });
  return lanes;
}

/** Whether a lane is switched off (hidden or muted), so it shows dimmed. */
function laneOff(plan: EditPlan, l: Lane): boolean {
  if (l.kind === "captions") return !plan.captions.enabled;
  if (l.kind === "audio") return Boolean(trackSetting(plan, "video:1").muted);
  const t = trackSetting(plan, l.key);
  // A video track with its sound off still shows its picture, so only hiding dims it.
  return Boolean(t.hidden || (l.kind !== "video" && t.muted));
}

const LANE_ICON: Record<Lane["kind"], IconName> = { text: "type", video: "video", captions: "cc", audio: "mic", voice: "mic", music: "music", sfx: "bolt" };

function TrackLabel({ lane }: { lane: Lane }) {
  const plan = useEditor((s) => s.plan);
  const commit = useEditor((s) => s.commit);
  const setCaptionStyle = useEditor((s) => s.setCaptionStyle);
  const [editing, setEditing] = useState(false);
  const kind = lane.kind;
  // A voice recording as the main track (faceless video) is called Voice unless renamed.
  const voiceOnly = useEditor((s) => s.project?.analysis.width === 0);
  const named = plan.tracks?.settings?.[lane.key]?.name;
  const name = kind === "audio" ? "Audio" : kind === "video" && lane.n === 1 && voiceOnly && !named ? "Voice" : trackName(plan, kind as TrackKind | "captions", lane.n);
  // Track 1's M and the Audio lane's M are the same switch: the main video's sound.
  const t = trackSetting(plan, kind === "audio" ? "video:1" : lane.key);
  const canMute = kind === "audio" || kind === "video" || kind === "voice" || kind === "music" || kind === "sfx";
  const canHide = kind === "text" || kind === "captions" || (kind === "video" && lane.n! > 1);
  const canRename = kind !== "audio";
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

/** Ticks from `from` to `to` seconds (only around what's in view, since the timeline is endless). */
function Ruler({ lane, from, to, pxPerSec, onPointerDown }: { lane: string; from: number; to: number; pxPerSec: number; onPointerDown: (e: React.PointerEvent) => void }) {
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
  return <div className="tl-ruler" data-lane={lane} onPointerDown={onPointerDown}>{ticks}</div>;
}

function Clip({ index, seg, x, w, selected, thumbs }: { index: number; seg: Segment; x: number; w: number; selected: boolean; thumbs: Thumbs }) {
  const { select, togglePick, seek, checkpoint, updateSegment, project, pxPerSec } = useEditor();
  const duration = project!.analysis.duration;

  // Thumbnail tiles: each shows the source frame at its position in the clip.
  const tileW = thumbs.frameW * (40 / thumbs.frameH);
  const tiles = [];
  // A voice recording as the main track has no picture, so no thumbnails.
  for (let tx = 0; thumbs.count > 0 && tx < w; tx += tileW) {
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
      data-sel={`seg:${index}`}
      className={`clip ${selected ? "selected" : ""} ${thumbs.count ? "" : "voice"} ${(seg.volume ?? 1) === 0 ? "muted" : ""}`}
      onContextMenu={(e) => openClipMenu(e, { kind: "segment", index })}
      onDoubleClick={(e) => openClipMenu(e, { kind: "segment", index })}
      style={{ left: x, width: Math.max(4, w - 1) }}
      onPointerDown={(e) => {
        // ⇧/⌘-click picks several clips for one AI request.
        if (e.shiftKey || e.metaKey) return useEditor.getState().toggleInSelection({ segment: index });
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

function WaveClip({ index, seg, x, w, wave, selected }: { index: number; seg: Segment; x: number; w: number; wave: Wave; selected: boolean }) {
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
    <div
      data-sel={`seg:${index}`}
      className={`wave-clip ${selected ? "selected" : ""}`}
      style={{ left: x, width: Math.max(4, w - 1) }}
      // The main track's sound is the same clip as on Track 1, so it has the same menu.
      onContextMenu={(e) => openClipMenu(e, { kind: "segment", index })}
      onDoubleClick={(e) => openClipMenu(e, { kind: "segment", index })}
    >
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
      onContextMenu={(e) => openClipMenu(e, { kind: "caption", index: cue.index })}
      onDoubleClick={(e) => openClipMenu(e, { kind: "caption", index: cue.index })}
    >
      <span>{cue.text}</span>
      <div className="handle left" onPointerDown={retime("start")} />
      <div className="handle right" onPointerDown={retime("end")} />
    </div>
  );
}

/** A voiceover on A2: drag to move it in time, drag an edge to trim, click to select. */
function VoiceoverBlock({ vo }: { vo: Voiceover }) {
  const { pxPerSec, selectedVo, selectVo, pickedIds } = useEditor();
  const total = useEditor((s) => outputDuration(s.plan));
  const selected = selectedVo === vo.id || pickedIds.includes(vo.id);

  const drag = (mode: "move" | "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return; // right-click opens the clip menu instead
    // ⇧ / ⌘-click adds it to the selection or takes it out; dragging a selected clip moves the whole group.
    if (e.shiftKey || e.metaKey) return useEditor.getState().toggleInSelection({ id: vo.id });
    if (mode === "move" && moveGroup(vo.id, e.clientX)) return;
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
        // Below the last track: a new track of the same kind.
        const kind = vo.kind ?? "voice";
        const to = lane && (lane.kind === "voice" || lane.kind === "music" || lane.kind === "sfx") ? { kind: lane.kind as Voiceover["kind"], track: lane.n }
          : lane?.kind === "below" ? { track: trackCount(useEditor.getState().plan, kind) + 1 } : {};
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
      data-sel={`id:${vo.id}`}
      className={`vo-clip ${vo.kind ?? "voice"} ${selected ? "selected" : ""} ${vo.muted ? "muted" : ""}`}
      onContextMenu={(e) => openClipMenu(e, { kind: "audio", id: vo.id })}
      style={{ left: vo.at * pxPerSec, width: Math.max(6, vo.duration * pxPerSec - 1) }}
      onPointerDown={drag("move")}
      onDoubleClick={(e) => openClipMenu(e, { kind: "audio", id: vo.id })}
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
  const { pxPerSec, selectedMotion, selectMotion, pickedIds } = useEditor();
  const total = useEditor((s) => outputDuration(s.plan));
  const drag = (mode: "move" | "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return; // right-click opens the clip menu instead
    // ⇧ / ⌘-click adds it to the selection or takes it out; dragging a selected clip moves the whole group.
    if (e.shiftKey || e.metaKey) return useEditor.getState().toggleInSelection({ id: m.id });
    if (mode === "move" && moveGroup(m.id, e.clientX)) return;
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
        // Above the top track (over the ruler): a new top text track.
        const track = lane?.kind === "text" ? lane.n : lane?.kind === "above" ? trackCount(useEditor.getState().plan, "text") + 1 : undefined;
        up(m.id, { at: Math.max(0, Math.min(total - orig.duration, orig.at + d)), ...(track ? { track } : {}) }, false);
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
      data-sel={`id:${m.id}`}
      className={`motion-clip ${selectedMotion === m.id || pickedIds.includes(m.id) ? "selected" : ""} ${m.hidden ? "hidden" : ""}`}
      onContextMenu={(e) => openClipMenu(e, { kind: "motion", id: m.id })}
      onDoubleClick={(e) => openClipMenu(e, { kind: "motion", id: m.id })}
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
  const { pxPerSec, selectedBroll, selectBroll, pickedIds } = useEditor();
  const total = useEditor((s) => outputDuration(s.plan));
  const selected = selectedBroll === b.id || pickedIds.includes(b.id);
  // A "muted" badge on your own videos (and any clip you muted); stock B-roll is silent anyway.
  const plan = useEditor((s) => s.plan);
  const showMuted = (b.source.startsWith("library:") || b.muted !== undefined) && !brollSound(plan, b);
  const drag = (mode: "move" | "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return; // right-click opens the clip menu instead
    // ⇧ / ⌘-click adds it to the selection or takes it out; dragging a selected clip moves the whole group.
    if (e.shiftKey || e.metaKey) return useEditor.getState().toggleInSelection({ id: b.id });
    if (mode === "move" && moveGroup(b.id, e.clientX)) return;
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
        // Over a Text track or the ruler: a new top video track.
        const track = lane?.kind === "video" && lane.n > 1 ? lane.n
          : lane?.kind === "above" || lane?.kind === "text" ? Math.max(2, trackCount(useEditor.getState().plan, "video") + 1) : undefined;
        up(b.id, { at: Math.max(0, Math.min(total - orig.duration, orig.at + d)), ...(track ? { track } : {}) }, false);
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
      data-sel={`id:${b.id}`}
      className={`broll-clip ${selected ? "selected" : ""} ${b.hidden ? "hidden" : ""} ${showMuted ? "muted" : ""}`}
      onContextMenu={(e) => openClipMenu(e, { kind: "broll", id: b.id })}
      onDoubleClick={(e) => openClipMenu(e, { kind: "broll", id: b.id })}
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
