// The Effects section: a library of transitions and effects, previewed on your own footage, like
// an editor's. Click a tile to add it at the playhead (a transition goes on the nearest cut), or
// drag it onto the timeline. A selected effect or cut opens its inspector here: a live preview on
// the real shots, duration, intensity and colour, use on every cut, and swap for another one.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFx } from "./fxState.ts";
import { CATEGORY_NAME, EFFECTS, type EffectCategory, EffectFrame, effectDef, libraryPresets } from "../motion/Effects.tsx";
import { clipLength, clipStarts } from "../src/timeline.ts";
import { TRANSITION_TYPES, type TransitionType, placedTransitions, transitionLook } from "../src/transitions.ts";
import { sceneClips } from "../src/sceneClips.ts";
import { flatLayers } from "../src/scene.ts";
import type { Motion } from "../src/schema.ts";
import { ColorField } from "./ColorPicker.tsx";
import { cutsOf, nearestCut } from "./cuts.ts";
import { useFileThumbs } from "./fileThumbs.ts";
import { Icon } from "./icons.tsx";
import { Slider } from "./Inspector.tsx";
import { sceneFile } from "./SceneClips.tsx";
import { maxTransition, setTransition } from "./TransitionPicker.tsx";
import { type Thumbs, useEditor } from "./store.ts";

export { useFx };
/** MIME type for an effect tile dragged onto the timeline. */
export const EFFECT_DRAG = "application/x-creatro-effect";

/** Opens the Effects section on the transition into main-track clip `index`. */
export function pickCut(index: number) {
  useFx.setState({ tab: "transitions", cut: index, cutFx: null });
  const s = useEditor.getState();
  s.set({ leftView: "effects", selectedMotion: null, selectedClip: null });
}

const SIMPLE: TransitionType[] = ["dissolve", "black", "white", "zoom", "circle"];
const WIPES: TransitionType[] = ["wipe-left", "wipe-right", "wipe-up", "wipe-down"];
const SLIDES: TransitionType[] = ["slide-left", "slide-right", "slide-up", "slide-down"];
const OVERLAY = ["flash", "dip", "blinds", "leak"];

// ---------- frames of your own footage, for previews ----------

/** A frame of footage: its file (or the main video), the second in it, and the look the edit gives it (a CSS filter). */
type Frame = { file?: string; main?: boolean; time: number; filter?: string };
/** What's on screen at timeline second `t`: a Claude edit's shot when one shows, else the main video. */
function frameAt(t: number): Frame {
  const s = useEditor.getState();
  for (const m of s.plan.motion) {
    const scene = m.template === "scene" && m.scene ? s.scenes[m.scene] : undefined;
    if (!scene || t < m.at || t >= m.at + m.duration) continue;
    const st = t - m.at + (m.offset ?? 0);
    const shot = sceneClips(scene, m.layers).find((c) => c.kind === "shot" && c.media && st >= c.start && st < c.end);
    if (shot?.media) {
      // The shot's own look (black and white, contrast…), as the edit shows it.
      const card = flatLayers(scene.layers).find((x) => x.layer.kind === "video" && x.layer.src === shot.media!.src && !x.layer.style.filter?.includes("blur"))?.layer;
      const filter = card?.style.filter && card.style.filter !== "none" ? card.style.filter : undefined;
      return { file: sceneFile(m, shot.media.src), time: shot.media.offset + (st - shot.media.start) * shot.media.rate, filter };
    }
  }
  const starts = clipStarts(s.plan);
  const i = s.plan.segments.findIndex((g, k) => t >= starts[k] && t < starts[k] + clipLength(g));
  const g = s.plan.segments[Math.max(0, i)];
  return { main: true, time: g ? g.start + Math.max(0, t - starts[Math.max(0, i)]) * g.speed : 0 };
}

/** One frame from a thumbnail strip, filling its box from the middle (cropped like a cover photo). */
function Still({ frame }: { frame: Frame }) {
  const main = useEditor((s) => s.project?.thumbs);
  const own = useFileThumbs(frame.main ? undefined : frame.file);
  const th: Thumbs | undefined = frame.main ? main : own;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!th || !th.count || !size.w) return <div className="fx-still empty" ref={box} />;
  const n = Math.max(0, Math.min(th.count - 1, Math.floor(frame.time / th.interval)));
  const k = Math.max(size.w / th.frameW, size.h / th.frameH);
  const cw = th.frameW * k, ch = th.frameH * k;
  return (
    <div className="fx-still" ref={box} style={{
      filter: frame.filter,
      backgroundImage: `url("${th.url}")`,
      backgroundSize: `${th.cols * cw}px auto`,
      backgroundPosition: `${-(n % th.cols) * cw + (size.w - cw) / 2}px ${-Math.floor(n / th.cols) * ch + (size.h - ch) / 2}px`,
    }} />
  );
}

/** A looping clock (0..1 over `period` seconds) while `on`, else `rest`. */
function useLoop(on: boolean, period: number, rest: number) {
  const [p, setP] = useState(rest);
  useEffect(() => {
    if (!on) return setP(rest);
    let raf = 0;
    const t0 = performance.now();
    const tick = () => (setP(((performance.now() - t0) / 1000 / period) % 1), (raf = requestAnimationFrame(tick)));
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, period, rest]);
  return p;
}

/** A cut transition playing between two frames (as the preview and export draw it), at progress p. */
function TransitionPlay({ type, a, b, p }: { type: TransitionType; a: Frame; b: Frame; p: number }) {
  // Hold each side a moment: before, the transition, after.
  const q = Math.max(0, Math.min(1, (p - 0.2) / 0.6));
  const look = transitionLook(type, q);
  return (
    <div className="fx-stage">
      <div className="fx-layer" style={look.a}><Still frame={a} /></div>
      <div className="fx-layer" style={look.b}><Still frame={b} /></div>
      {look.cover && <div className="fx-layer" style={{ background: look.cover.color, opacity: look.cover.opacity }} />}
    </div>
  );
}

/** An effect over a frame, at progress p of its run. */
function EffectPlay({ effect, a, b, p, duration, color, intensity = 1 }: { effect: string; a: Frame; b?: Frame; p: number; duration: number; color?: string; intensity?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 160, h: 200 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const def = effectDef(effect);
  // A transition effect is shown on its cut: the shot before, then the effect over the shot after.
  const onCut = def?.category === "transition" && b;
  const lead = onCut ? (effect === "dip" ? 0.5 : 0.3) : 0;
  const run = Math.max(0, Math.min(1, (p - lead * 0.6) / (1 - lead * 0.6)));
  const showB = onCut && (effect === "dip" ? run >= 0.5 : p >= lead * 0.6);
  return (
    <div className="fx-stage" ref={box}>
      <div className="fx-layer"><Still frame={showB ? b! : a} /></div>
      {(!onCut || p >= lead * 0.6) && (
        <div className="fx-layer"><EffectFrame effect={effect} t={run * duration} duration={duration} color={color} intensity={intensity} W={size.w} H={size.h} /></div>
      )}
    </div>
  );
}

/** Frames either side of the cut nearest the playhead (or of cut `at`). */
function useCutFrames(at?: number) {
  const plan = useEditor((s) => s.plan);
  const scenes = useEditor((s) => s.scenes);
  const time = useEditor((s) => s.time);
  return useMemo(() => {
    const cut = at ?? nearestCut(plan, scenes, time) ?? time;
    return { cut, a: frameAt(Math.max(0, cut - 0.3)), b: frameAt(cut + 0.3), here: frameAt(time) };
  }, [plan, scenes, time, at]);
}

// ---------- tiles ----------

function Tile({ name, about, on, playing, children, onPick, drag }: {
  name: string; about: string; on?: boolean; playing?: boolean; children: React.ReactNode; onPick: () => void; drag?: string;
}) {
  return (
    <button className={`fx-tile ${on ? "on" : ""}`} title={`${name}: ${about}`} onClick={onPick}
      draggable={Boolean(drag)} onDragStart={(e) => drag && (e.dataTransfer.setData(EFFECT_DRAG, drag), (e.dataTransfer.effectAllowed = "copy"))}>
      <span className={`fx-thumb ${playing ? "playing" : ""}`}>{children}</span>
      <span className="fx-name">{name}</span>
    </button>
  );
}

function TransitionTile({ type, a, b, on, onPick }: { type: TransitionType; a: Frame; b: Frame; on?: boolean; onPick: () => void }) {
  const [hover, setHover] = useState(false);
  const p = useLoop(hover || Boolean(on), 1.6, 0.5);
  return (
    <span onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <Tile name={TRANSITION_TYPES[type].label} about={ABOUT[type]} on={on} playing={hover} onPick={onPick}>
        <TransitionPlay type={type} a={a} b={b} p={p} />
      </Tile>
    </span>
  );
}

function EffectTile({ id, a, b, on, onPick }: { id: string; a: Frame; b?: Frame; on?: boolean; onPick: () => void }) {
  const def = effectDef(id)!;
  const [hover, setHover] = useState(false);
  const period = Math.max(1.2, Math.min(3, def.duration + 0.8));
  const p = useLoop(hover, period, def.category === "transition" ? 0.42 : 0.5);
  return (
    <span onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <Tile name={def.name} about={def.about} on={on} playing={hover} onPick={onPick} drag={id}>
        <EffectPlay effect={id} a={a} b={b} p={p} duration={def.duration} />
      </Tile>
    </span>
  );
}

const ABOUT: Record<TransitionType, string> = {
  dissolve: "The shots blend into each other", black: "Fades to black, then up on the next shot", white: "Fades to white, then down to the next shot",
  "wipe-left": "The next shot wipes in from the right", "wipe-right": "The next shot wipes in from the left", "wipe-up": "The next shot wipes up from the bottom", "wipe-down": "The next shot wipes down from the top",
  "slide-left": "Both shots slide left", "slide-right": "Both shots slide right", "slide-up": "Both shots slide up", "slide-down": "Both shots slide down",
  circle: "The next shot opens from the middle", zoom: "Zooms into the cut and through",
};

// ---------- the section ----------

export function EffectsPanel() {
  const tab = useFx((s) => s.tab);
  const cut = useFx((s) => s.cut);
  const selected = useEditor((s) => s.plan.motion.find((m) => m.id === s.selectedMotion && m.template === "effect"));
  const segs = useEditor((s) => s.plan.segments);
  const cutFx = useFx((s) => s.cutFx);
  const hasCutFx = useEditor((s) => (s.plan.cutEffects ?? []).some((c) => c.id === cutFx));
  if (selected) return <EffectInspector m={selected} />;
  if (cutFx && hasCutFx) return <CutEffectInspector id={cutFx} />;
  if (cut !== null && segs[cut] && cut > 0) return <CutInspector index={cut} />;
  return (
    <>
      <div className="fx-tabs segmented">
        <button className={tab === "transitions" ? "on" : ""} onClick={() => useFx.setState({ tab: "transitions" })}>Transitions</button>
        <button className={tab === "effects" ? "on" : ""} onClick={() => useFx.setState({ tab: "effects" })}>Effects</button>
      </div>
      {tab === "transitions" ? <TransitionLibrary /> : <EffectLibrary />}
    </>
  );
}

function TransitionLibrary() {
  const plan = useEditor((s) => s.plan);
  const time = useEditor((s) => s.time);
  const { a, b } = useCutFrames();
  const starts = clipStarts(plan);
  // The main-track cut nearest the playhead (the clip after it), if the main track has any.
  const target = plan.segments.length > 1
    ? plan.segments.map((_, i) => i).slice(1).filter((i) => !plan.segments[i].gap).sort((x, y) => Math.abs(starts[x] - time) - Math.abs(starts[y] - time))[0]
    : undefined;
  const apply = (type: TransitionType) => {
    if (target === undefined) return;
    setTransition(target, { type, duration: Math.min(0.5, maxTransition(target)) });
    pickCut(target);
  };
  const grid = (label: string, list: TransitionType[]) => (
    <div className="fx-group">
      <span className="fx-group-name">{label}</span>
      <div className="fx-grid">{list.map((t) => <TransitionTile key={t} type={t} a={a} b={b} onPick={() => apply(t)} />)}</div>
    </div>
  );
  return (
    <section className="fx-lib">
      {target !== undefined ? (
        <>
          <p className="hint fx-lead">Click one to put it on the cut nearest the playhead (into clip {target + 1}). Hover to preview.</p>
          {grid("Simple", SIMPLE)}
          {grid("Wipe", WIPES)}
          {grid("Slide", SLIDES)}
        </>
      ) : (
        <p className="hint fx-lead">Cut transitions go between clips on Track 1, and it has no cuts yet. These work on any cut, including the shots of a Claude edit:</p>
      )}
      <div className="fx-group">
        <span className="fx-group-name">On any cut</span>
        <div className="fx-grid">{OVERLAY.map((id) => <EffectTile key={id} id={id} a={a} b={b} onPick={() => useEditor.getState().addEffect(id)} />)}</div>
      </div>
      <FromEdits category="transition" a={a} b={b} />
    </section>
  );
}

/**
 * Effects taken out of imported Claude edits: their own flashes, wipes, shading and textures,
 * kept in the library so they can go on anything.
 */
function FromEdits({ category, a, b }: { category?: EffectCategory; a: Frame; b: Frame }) {
  const lib = useEditor((s) => s.effectLibrary).filter((p) => !category || p.category === category);
  if (!lib.length) return null;
  return (
    <div className="fx-group">
      <span className="fx-group-name">From your Claude edits</span>
      <div className="fx-grid">
        {lib.map((p) => <EffectTile key={p.id} id={p.id} a={a} b={b} onPick={() => useEditor.getState().addEffect(p.id)} />)}
      </div>
    </div>
  );
}

function EffectLibrary() {
  const { here, a, b } = useCutFrames();
  const [cat, setCat] = useState<EffectCategory | "all">("all");
  const cats: (EffectCategory | "all")[] = ["all", "light", "texture", "frame", "transition"];
  return (
    <section className="fx-lib">
      <div className="fx-chips">
        {cats.map((c) => <button key={c} className={c === cat ? "on" : ""} onClick={() => setCat(c)}>{c === "all" ? "All" : CATEGORY_NAME[c]}</button>)}
      </div>
      <p className="hint fx-lead">Click to add at the playhead, or drag onto the timeline. It covers everything under it while it plays.</p>
      <div className="fx-grid">
        {EFFECTS.filter((e) => cat === "all" || e.category === cat).map((e) => (
          <EffectTile key={e.id} id={e.id} a={e.category === "transition" ? a : here} b={b} onPick={() => useEditor.getState().addEffect(e.id)} />
        ))}
      </div>
      {cat !== "frame" && <FromEdits category={cat === "all" ? undefined : cat} a={a} b={b} />}
    </section>
  );
}

// ---------- inspectors ----------

function Preview({ children, p }: { children: React.ReactNode; p: number }) {
  return (
    <div className="fx-preview">
      {children}
      <i className="fx-progress"><b style={{ width: `${p * 100}%` }} /></i>
    </div>
  );
}

type FxValue = { effect: string; duration: number; color?: string; intensity: number };

/**
 * An effect's inspector, for an effect clip or a transition over a cut: where it is, a live
 * preview on the real shots, duration, intensity and colour, use on every cut, delete, and the
 * other effects to swap it for.
 */
function FxInspector({ crumb, value, cut, onChange, onStart, onDelete, onAllCuts, onBack, note }: {
  crumb: string; value: FxValue; cut: number; onChange: (patch: Partial<FxValue>) => void; onStart: () => void;
  onDelete: () => void; onAllCuts?: () => void; onBack: () => void; note: string;
}) {
  const plan = useEditor((s) => s.plan);
  const scenes = useEditor((s) => s.scenes);
  const def = effectDef(value.effect);
  const { a, b } = useCutFrames(cut);
  const p = useLoop(true, Math.max(1.2, value.duration + 0.8), 0);
  const cuts = cutsOf(plan, scenes);
  if (!def) return null;
  return (
    <section className="fx-insp">
      <div className="fx-crumb">
        <span>{crumb} / <b>{def.name}</b></span>
        <button className="icon-btn" title="Back to the library" onClick={onBack}><Icon name="close" size={14} /></button>
      </div>
      <div className="fx-sub">{def.name} · {value.duration.toFixed(1)}s</div>
      <div className="fx-actions">
        {onAllCuts && cuts.length > 1 && <button className="lib-add" onClick={onAllCuts}>Use on all {cuts.length} cuts</button>}
        <button className="lib-add fx-trash" title="Delete" onClick={onDelete}><Icon name="trash" size={14} /></button>
      </div>
      <Preview p={p}><EffectPlay effect={value.effect} a={a} b={b} p={p} duration={value.duration} color={value.color} intensity={value.intensity} /></Preview>
      <Slider label="Duration" unit="s" min={0.1} max={Math.max(def.category === "transition" ? 3 : 10, value.duration)} step={0.05} value={value.duration} display={(v) => v.toFixed(2)}
        onStart={onStart} onChange={(v) => onChange({ duration: Math.round(v * 100) / 100 })} />
      <Slider label="Intensity" unit="%" min={0} max={2} step={0.01} value={value.intensity} display={(v) => Math.round(v * 100)}
        onStart={onStart} onChange={(v) => onChange({ intensity: Math.round(v * 100) / 100 })} />
      {def.color && (
        <div className="tp-line">
          <span className="tp-label">Colour</span>
          <ColorField label="Colour" value={value.color || def.color} alpha={false} onStart={onStart} onChange={(c) => onChange({ color: c })}
            palette={["#ffffff", "#000000", "#ff8a3d", "#ff453a", "#c8ff3d", "#3d8bff"]} />
        </div>
      )}
      <div className="fx-group">
        <span className="fx-group-name">Swap for</span>
        <div className="fx-grid">
          {[...EFFECTS, ...libraryPresets().map((p) => effectDef(p.id)!)].filter((e) => (def.category === "transition") === (e.category === "transition")).map((e) => (
            <EffectTile key={e.id} id={e.id} a={a} b={b} on={e.id === value.effect}
              onPick={() => (onStart(), onChange({ effect: e.id, ...(e.color ? { color: e.color } : {}) }))} />
          ))}
        </div>
      </div>
      <p className="hint">{note}</p>
    </section>
  );
}

/** A selected effect clip (a look on an Effects track). */
function EffectInspector({ m }: { m: Motion }) {
  const { checkpoint, updateMotion, deleteMotion } = useEditor();
  return (
    <FxInspector crumb="Effects" cut={m.at} onStart={checkpoint} onBack={() => useEditor.getState().selectMotion(null)} onDelete={() => deleteMotion(m.id)}
      value={{ effect: m.effect ?? "", duration: m.duration, color: m.color, intensity: Number(m.props?.intensity ?? 1) }}
      onChange={(v) => updateMotion(m.id, {
        ...(v.duration !== undefined ? { duration: v.duration } : {}), ...(v.color !== undefined ? { color: v.color } : {}),
        ...(v.effect !== undefined ? { effect: v.effect, text: effectDef(v.effect)?.name ?? m.text } : {}),
        ...(v.intensity !== undefined ? { props: { ...m.props, intensity: v.intensity } } : {}),
      }, false)}
      note="On the timeline it's a clip on the Effects track: drag to move it, drag its edges to change how long it runs." />
  );
}

/** A selected transition over a cut. */
function CutEffectInspector({ id }: { id: string }) {
  const { checkpoint, updateCutEffect, removeCutEffect, plan, scenes } = useEditor();
  const c = (plan.cutEffects ?? []).find((x) => x.id === id);
  if (!c) return null;
  const onAllCuts = () => {
    const s = useEditor.getState();
    const have = new Set((s.plan.cutEffects ?? []).map((x) => Math.round(x.at * 50)));
    const add = cutsOf(s.plan, scenes).filter((t) => !have.has(Math.round(t * 50))).map((t, i) => ({ ...c, id: `c${Math.random().toString(36).slice(2, 8)}${i}`, at: t }));
    // Every cut the same: the ones that had another transition take this one too.
    s.commit({ ...s.plan, cutEffects: [...(s.plan.cutEffects ?? []).map((x) => ({ ...x, effect: c.effect, duration: c.duration, color: c.color, intensity: c.intensity })), ...add] });
  };
  return (
    <FxInspector crumb="Cut" cut={c.at} onStart={checkpoint} onBack={() => useFx.setState({ cutFx: null })} onDelete={() => removeCutEffect(id)} onAllCuts={onAllCuts}
      value={{ effect: c.effect, duration: c.duration, color: c.color, intensity: c.intensity ?? 1 }}
      onChange={(v) => updateCutEffect(id, v, false)}
      note="It sits on the cut, not on a track: it moves with the cut and keeps the timeline clean." />
  );
}

/** A main-track cut: the transition on it (or none), previewed on the two real shots. */
function CutInspector({ index }: { index: number }) {
  const { plan, checkpoint } = useEditor();
  const starts = clipStarts(plan);
  const seg = plan.segments[index];
  const t = seg.transition;
  const placed = placedTransitions(plan).find((x) => x.index === index);
  const { a, b } = useCutFrames(starts[index]);
  const p = useLoop(true, Math.max(1.4, (placed?.duration ?? 0.5) * 2 + 0.8), 0);
  const cuts = plan.segments.map((g, i) => i).filter((i) => i > 0 && !plan.segments[i].gap);
  const max = maxTransition(index);
  const useAll = () => {
    if (!t) return;
    const s = useEditor.getState();
    s.commit({ ...s.plan, segments: s.plan.segments.map((g, i) => (cuts.includes(i) ? { ...g, transition: { ...t, duration: Math.min(t.duration, maxTransition(i)) } } : g)) });
  };
  const grid = (label: string, list: TransitionType[]) => (
    <div className="fx-group">
      <span className="fx-group-name">{label}</span>
      <div className="fx-grid">
        {list.map((type) => <TransitionTile key={type} type={type} a={a} b={b} on={t?.type === type}
          onPick={() => setTransition(index, { type, duration: Math.min(t?.duration ?? 0.5, max) })} />)}
      </div>
    </div>
  );
  return (
    <section className="fx-insp">
      <div className="fx-crumb">
        <span>Track 1 / <b>Cut into clip {index + 1}</b></span>
        <button className="icon-btn" title="Back to the library" onClick={() => useFx.setState({ cut: null })}><Icon name="close" size={14} /></button>
      </div>
      <div className="fx-sub">{t ? `${TRANSITION_TYPES[t.type].label} · ${(placed?.duration ?? t.duration).toFixed(1)}s` : "Straight cut"}</div>
      <div className="fx-actions">
        {t && cuts.length > 1 && <button className="lib-add" onClick={useAll}>Use on all {cuts.length} cuts</button>}
        {t && <button className="lib-add fx-trash" title="Remove the transition" onClick={() => setTransition(index, null)}><Icon name="trash" size={14} /></button>}
      </div>
      <Preview p={p}>{t ? <TransitionPlay type={t.type} a={a} b={b} p={p} /> : <div className="fx-stage"><div className="fx-layer"><Still frame={p < 0.5 ? a : b} /></div></div>}</Preview>
      {t && (
        <Slider label="Duration" unit="s" min={0.1} max={Math.max(0.1, max)} step={0.05} value={Math.min(t.duration, max)} display={(v) => v.toFixed(2)}
          onStart={checkpoint} onChange={(v) => setTransition(index, { type: t.type, duration: Math.round(v * 100) / 100 }, false)} />
      )}
      {grid("Simple", SIMPLE)}
      {grid("Wipe", WIPES)}
      {grid("Slide", SLIDES)}
      <p className="hint">It plays half before the cut and half after; nothing moves and the video keeps its length.</p>
    </section>
  );
}
