// Transitions on the timeline: a mark on every cut of the main track, and the picker it opens.
// A transition belongs to the clip after the cut (`transition` on that segment in the plan).
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EditPlan } from "../src/schema.ts";
import type { Scene } from "../src/scene.ts";
import { sceneClips } from "../src/sceneClips.ts";
import { cutEffectStart, effectDef } from "../motion/Effects.tsx";
import { create } from "zustand";
import { TRANSITIONS, TRANSITION_TYPES, type TransitionType, placedTransitions } from "../src/transitions.ts";
import { clipLength } from "../src/timeline.ts";
import { useEditor } from "./store.ts";
import { pickCut, useFx } from "./EffectsPanel.tsx";

const usePicker = create<{ open: { index: number; x: number; y: number } | null }>(() => ({ open: null }));

/** Opens the picker for the cut before main-track clip `index`. */
export function openTransitionPicker(e: React.MouseEvent | React.PointerEvent, index: number) {
  e.preventDefault();
  e.stopPropagation();
  usePicker.setState({ open: { index, x: e.clientX, y: e.clientY } });
}

/** Sets (or with null, removes) the transition into clip `index`. One undo step. */
export function setTransition(index: number, t: { type: TransitionType; duration: number } | null, record = true) {
  const s = useEditor.getState();
  const segments = s.plan.segments.map((g, i) => {
    if (i !== index) return g;
    const { transition: _, ...rest } = g;
    return t ? { ...rest, transition: t } : rest;
  });
  (record ? s.commit : s.live)({ ...s.plan, segments });
}

/** The longest a transition into clip `index` can play: it can't run past either clip. */
export function maxTransition(index: number): number {
  const segs = useEditor.getState().plan.segments;
  return Math.min(3, clipLength(segs[index - 1]), clipLength(segs[index]));
}

/**
 * On the main track: each cut's transition as a band as long as it plays (half each side of the
 * cut) with its badge in the middle, transitions laid over cuts the same way, and a + on bare cuts.
 */
export function TransitionMarks({ starts }: { starts: number[] }) {
  const plan = useEditor((s) => s.plan);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const placed = new Map(placedTransitions(plan).map((t) => [t.index, t]));
  const picked = useFx((s) => (useEditor.getState().leftView === "effects" ? s.cut : null));
  const cutTimes = plan.segments.map((g, i) => (i > 0 && !g.gap ? starts[i] : -1)).filter((t) => t >= 0);
  // Transitions laid over cuts that are this track's (or over no cut at all) show here.
  const scenes = useEditor((s) => s.scenes);
  const sceneCuts = useMemo(() => sceneCutTimes(plan, scenes), [plan, scenes]);
  const fx = (plan.cutEffects ?? []).filter((c) => cutTimes.some((t) => Math.abs(t - c.at) < 0.02) || !sceneCuts.some((t) => Math.abs(t - c.at) < 0.02));
  return (
    <>
      {plan.segments.map((s, i) => {
        if (i === 0 || s.gap) return null;
        const t = placed.get(i);
        const x = starts[i] * pxPerSec;
        if (!t) return fx.some((c) => Math.abs(c.at - starts[i]) < 0.02) ? null : (
          <button key={i} className={`tr-add ${picked === i ? "on" : ""}`} style={{ left: x }} title="Add a transition on this cut"
            onPointerDown={(e) => e.stopPropagation()} onClick={() => pickCut(i)}>+</button>
        );
        return (
          <CutBand key={i} x={x} w={t.duration * pxPerSec} on={picked === i} label={`${TRANSITION_TYPES[t.type].label} · ${t.duration.toFixed(1)}s`}
            onPick={() => pickCut(i)}><TransitionGlyph type={t.type} /></CutBand>
        );
      })}
      {fx.map((c) => <CutEffectMark key={c.id} c={c} />)}
    </>
  );
}

/** A transition laid over a cut, as a band where it plays. */
export function CutEffectMark({ c }: { c: EditPlan["cutEffects"][number] }) {
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const on = useFx((s) => s.cutFx === c.id && useEditor.getState().leftView === "effects");
  const start = cutEffectStart(c.effect, c.at, c.duration);
  const def = effectDef(c.effect);
  return (
    <CutBand x={start * pxPerSec} w={c.duration * pxPerSec} from={start} on={on} kind="fx" label={`${def?.name ?? "Effect"} · ${c.duration.toFixed(1)}s`}
      onPick={() => (useFx.setState({ cutFx: c.id, cut: null }), useEditor.getState().set({ leftView: "effects", selectedMotion: null, selectedClip: null }))}>
      <i className={`tr-fx ${c.effect}`} />
    </CutBand>
  );
}

/**
 * A transition on the timeline: a see-through band where it plays (centred on x unless `from` is
 * given, then starting there) and a badge in the middle. Clicking either picks it.
 */
export function CutBand({ x, w, from, on, kind = "cut", label, onPick, children }: {
  x: number; w: number; from?: number; on?: boolean; kind?: "cut" | "fx" | "own"; label: string; onPick: () => void; children: React.ReactNode;
}) {
  const width = Math.max(10, w);
  const left = from !== undefined ? x : x - width / 2;
  return (
    <div className={`tr-band ${kind} ${on ? "on" : ""}`} style={{ left, width }} title={`${label}\nClick to change or remove`}
      onPointerDown={(e) => (e.stopPropagation(), onPick())}>
      <span className="tr-badge">{children}</span>
    </div>
  );
}

/** Where the shots of imported Claude edits change, on the timeline. */
function sceneCutTimes(plan: EditPlan, scenes: Record<string, Scene>): number[] {
  const out: number[] = [];
  for (const m of plan.motion) {
    const scene = m.template === "scene" && m.scene ? scenes[m.scene] : undefined;
    if (!scene) continue;
    for (const c of sceneClips(scene, m.layers)) if (c.kind === "shot" && c.start > 0.05) out.push(m.at - (m.offset ?? 0) + c.start);
  }
  return out;
}

/** A small drawing of what a transition does. */
function TransitionGlyph({ type }: { type: TransitionType }) {
  return <i className={`tr-glyph ${type}`} aria-hidden="true"><b /></i>;
}

export function TransitionPicker() {
  const open = usePicker((s) => s.open);
  const seg = useEditor((s) => (open ? s.plan.segments[open.index] : undefined));
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(open.x - r.width / 2, innerWidth - r.width - 8)), y: Math.max(8, open.y - r.height - 12) });
  }, [open]);
  if (!open || !seg) return null;
  const close = () => usePicker.setState({ open: null });
  const max = maxTransition(open.index);
  const current = seg.transition;
  const duration = Math.min(current?.duration ?? 0.5, max);
  return (
    <>
      <div className="menu-catcher" onPointerDown={close} onContextMenu={(e) => (e.preventDefault(), close())} />
      <div className="tr-picker" ref={box} style={{ left: pos.x || open.x, top: pos.y || open.y }} onKeyDown={(e) => e.stopPropagation()}>
        <div className="tr-picker-head">
          <span>Transition into clip {open.index + 1}</span>
          {current && <button className="link-btn" onClick={() => (setTransition(open.index, null), close())}>Remove</button>}
        </div>
        <div className="tr-grid">
          {TRANSITIONS.map((type) => (
            <button key={type} className={current?.type === type ? "on" : ""} title={TRANSITION_TYPES[type].label}
              onClick={() => setTransition(open.index, { type, duration: current ? duration : Math.min(0.5, max) })}>
              <TransitionGlyph type={type} />
              <span>{TRANSITION_TYPES[type].label}</span>
            </button>
          ))}
        </div>
        <label className="slider">
          <span className="slider-head"><span>Duration</span><span className="value">{duration.toFixed(1)}s</span></span>
          <input type="range" min={0.1} max={Math.max(0.1, max)} step={0.1} value={duration} disabled={!current}
            onPointerDown={() => useEditor.getState().checkpoint()}
            onChange={(e) => current && setTransition(open.index, { type: current.type, duration: Number(e.target.value) }, false)} />
        </label>
        <p className="hint">Plays half before the cut and half after. Nothing moves, and the edit keeps its length.</p>
      </div>
    </>
  );
}
