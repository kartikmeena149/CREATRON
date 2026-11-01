// The timeline: one row per layer (video, captions, voice), on the OUTPUT clock.
// Drag clip edges to trim, click to select, S to split, Delete to ripple-delete.
import { useEffect, useMemo, useRef } from "react";
import { roughCut } from "../src/autocut.ts";
import { buildCues, outputDuration } from "../src/timeline.ts";
import type { Segment } from "../src/schema.ts";
import { shortTime } from "./format.ts";
import { type Thumbs, type Wave, useEditor } from "./store.ts";

const LABEL_W = 132;

export function Timeline() {
  const { project, plan, time, pxPerSec, selected, past, future } = useEditor();
  const { seek, select, setZoom, split, deleteSelected, undo, redo, commit, say } = useEditor();
  const scroller = useRef<HTMLDivElement>(null);
  const total = outputDuration(plan);
  const width = Math.max(total * pxPerSec + 200, 400);

  // Fit the whole edit in view when a video is loaded.
  useEffect(() => {
    const el = scroller.current;
    if (el && project) setZoom((el.clientWidth - 80) / Math.max(1, project.analysis.duration));
  }, [project]);

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

  if (!project) return <div className="timeline empty" />;
  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <button title="Undo (⌘Z)" disabled={!past.length} onClick={undo}>↶ Undo</button>
        <button title="Redo (⇧⌘Z)" disabled={!future.length} onClick={redo}>↷ Redo</button>
        <span className="sep" />
        <button title="Split at playhead (S)" onClick={split}>✂ Split</button>
        <button title="Delete clip (⌫)" disabled={selected === null || plan.segments.length < 2} onClick={deleteSelected}>
          ⌫ Delete
        </button>
        <button className="rough-cut" title="Keep only what you say: cuts dead air, pauses, retakes and outtakes (instant, undoable)" onClick={doRoughCut}>
          ⚡ Rough Cut
        </button>
        <span className="grow" />
        <span className="dim small">{plan.segments.length} clips · {total.toFixed(1)}s</span>
        <span className="sep" />
        <button onClick={() => setZoom(pxPerSec / 1.4)} title="Zoom out">－</button>
        <input
          type="range"
          min={Math.log(2)}
          max={Math.log(400)}
          step={0.01}
          value={Math.log(pxPerSec)}
          onChange={(e) => setZoom(Math.exp(Number(e.target.value)))}
        />
        <button onClick={() => setZoom(pxPerSec * 1.4)} title="Zoom in">＋</button>
      </div>

      <div className="tl-body">
        <div className="tl-labels" style={{ width: LABEL_W }}>
          <div className="tl-ruler-spacer" />
          <div className="track-label video"><b>V1</b> Video</div>
          <div className="track-label captions"><b>T1</b> Captions{!plan.captions.enabled && <em> off</em>}</div>
          <div className="track-label voice"><b>A1</b> Voice</div>
        </div>

        <div className="tl-scroll" ref={scroller} onWheel={onWheel}>
          <div className="tl-content" style={{ width }}>
            <Ruler total={total} pxPerSec={pxPerSec} onPointerDown={scrub} />

            <div className="track video" onPointerDown={(e) => e.target === e.currentTarget && (select(null), scrub(e))}>
              {segs.map(({ s, x, w }, i) => (
                <Clip key={i} index={i} seg={s} x={x} w={w} selected={selected === i} thumbs={project.thumbs} />
              ))}
            </div>

            <div className={`track captions ${plan.captions.enabled ? "" : "off"}`} onPointerDown={scrub}>
              {cues.map((c, i) => (
                <div
                  key={i}
                  className="cue"
                  style={{ left: c.start * pxPerSec, width: Math.max(2, (c.end - c.start) * pxPerSec - 1) }}
                  title={c.text}
                >
                  {c.text}
                </div>
              ))}
            </div>

            <div className="track voice" onPointerDown={scrub}>
              {segs.map(({ s, x, w }, i) => (
                <WaveClip key={i} seg={s} x={x} w={w} wave={project.wave} selected={selected === i} />
              ))}
            </div>

            <div className="playhead" style={{ left: time * pxPerSec }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Ruler({ total, pxPerSec, onPointerDown }: { total: number; pxPerSec: number; onPointerDown: (e: React.PointerEvent) => void }) {
  // Pick a label step that keeps labels ~80px apart.
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pxPerSec >= 80) ?? 600;
  const ticks = [];
  for (let t = 0; t <= total + step; t += step / 5) {
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
  const { select, seek, checkpoint, updateSegment, project, pxPerSec } = useEditor();
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

  const badges = [seg.speed !== 1 && `${seg.speed}×`, seg.zoom > 1 && `zoom ${Math.round(seg.zoom * 100)}%`].filter(Boolean);
  return (
    <div
      className={`clip ${selected ? "selected" : ""}`}
      style={{ left: x, width: Math.max(4, w - 1) }}
      onPointerDown={(e) => {
        select(index);
        const rect = e.currentTarget.getBoundingClientRect();
        seek((x + e.clientX - rect.left) / pxPerSec);
      }}
    >
      <div className="thumbs">{tiles}</div>
      <div className="clip-label">
        <span>Clip {index + 1}</span>
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
