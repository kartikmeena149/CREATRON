// An imported Claude edit on the timeline as clips on tracks (src/sceneClips.ts): its shots with
// their footage, its titles and counters, its graphics, its background. Click to select, drag to
// move, drag an edge to trim, ⌫ to delete; the diamonds are each clip's keyframes. A title inside
// a shot is linked to it: it moves and trims with its shot, like an editor's linked clips.
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { createPortal } from "react-dom";
import { type Keys, keyTimes, setKey, valueAt } from "../src/keyframes.ts";
import type { ClipProp, LayerEdit, Scene } from "../src/scene.ts";
import { type ClipLane, type SceneClip, clipKey, clipKeys, clipLanes, recordedKeys, recordedStill, sceneClips, withClipKeys } from "../src/sceneClips.ts";
import type { Motion } from "../src/schema.ts";
import { useFileThumbs } from "./fileThumbs.ts";
import { Icon, type IconName } from "./icons.tsx";
import { SNAP_PX, edges, magnetDone, nearest, useMagnet } from "./magnet.ts";
import { FilmStrip } from "./Timeline.tsx";
import { CutBand, CutEffectMark } from "./TransitionPicker.tsx";
import { useEditor } from "./store.ts";

/** A scene file as a full path (its own files are relative to its folder; swapped-in ones are full). */
export const sceneFile = (m: Motion, src: string) => (src.startsWith("/") ? src : `${m.scene!.replace(/\/[^/]*$/, "")}/${src}`);

/** One track of an imported edit's clips, for the timeline's lane list. */
export type SceneLane = { scene: string; lane: ClipLane };

const cache = new WeakMap<Scene, Map<unknown, SceneClip[]>>();
/** The clips of a scene clip (memoised on its scene and its edits, which change together with the plan). */
export function clipsOf(m: Motion, scene: Scene): SceneClip[] {
  let per = cache.get(scene);
  if (!per) cache.set(scene, (per = new Map()));
  const key = m.layers ?? null;
  let hit = per.get(key);
  if (!hit) {
    hit = sceneClips(scene, m.layers);
    per.clear(); // only the latest edits are worth keeping
    per.set(key, hit);
  }
  return hit;
}

/** Every imported edit's tracks, top to bottom: its titles, graphics, shots, background. */
export function useSceneLanes(): SceneLane[] {
  const motion = useEditor((s) => s.plan.motion);
  const scenes = useEditor((s) => s.scenes);
  const open = useLayers((s) => s.open);
  // A folded-away layer that's selected (picked on the picture) shows its track while it is.
  const picked = useEditor((s) => s.selectedClip);
  return useMemo(() => motion.filter((m) => m.template === "scene" && m.scene && scenes[m.scene] && !m.hidden)
    .flatMap((m) => {
      const clips = clipsOf(m, scenes[m.scene!]);
      const sel = picked?.scene === m.id ? clips.find((c) => c.id === picked.clip) : undefined;
      // Folded: a shot's blur fill, its shading and flashes, and the background stay out of the way;
      // its flashes and wipes show as marks on its cuts instead.
      const shown = open ? clips : clips.filter((c) => !FOLDED.has(c.kind) || c === sel);
      return clipLanes(shown).map((lane) => ({ scene: m.id, lane }));
    }), [motion, scenes, open, picked?.scene, picked?.clip]);
}

/** Kinds of layer folded away until "Layers" is opened on the Footage track. */
const FOLDED = new Set<SceneClip["kind"]>(["fill", "effect", "background"]);
/** Whether the Claude edits' helper layers show (blur fills, shot effects, background). Kept between sessions. */
export const useLayers = create<{ open: boolean; toggle(): void }>((set, get) => ({
  open: (() => {
    try {
      return localStorage.getItem("creatro.sceneLayers") === "open";
    } catch {
      return false;
    }
  })(),
  toggle: () => {
    const open = !get().open;
    try {
      localStorage.setItem("creatro.sceneLayers", open ? "open" : "closed");
    } catch {}
    set({ open });
  },
}));

export const LANE_HEIGHT: Record<SceneClip["kind"], number> = { shot: 54, fill: 40, effect: 28, text: 32, graphic: 28, background: 26 };
const LANE_NAME: Record<SceneClip["kind"], string> = { shot: "Footage", fill: "Blur fill", effect: "Shot FX", text: "Titles", graphic: "Graphics", background: "Background" };
const LANE_ICON: Record<SceneClip["kind"], IconName> = { shot: "video", fill: "video", effect: "sparkle", text: "type", graphic: "layers", background: "grid" };

export function SceneLaneLabel({ lane, height }: { lane: SceneLane; height: number }) {
  const name = useEditor((s) => s.plan.motion.find((m) => m.id === lane.scene)?.text ?? "");
  const { kind, n } = lane.lane;
  return (
    <div className={`track-label sc-label ${kind}`} style={{ height }} title={`${LANE_NAME[kind]}${n > 1 ? ` ${n}` : ""} of the Claude edit “${name}”`}>
      <Icon name={LANE_ICON[kind]} size={13} />
      <span className="track-name">{LANE_NAME[kind]}{n > 1 ? ` ${n}` : ""}</span>
      {kind === "shot" && n === 1 && <LayersToggle />}
    </div>
  );
}

/** The Footage track's switch for the folded layers: blur fills, shot effects, background. */
function LayersToggle() {
  const { open, toggle } = useLayers();
  return (
    <button className={`sc-layers-btn ${open ? "on" : ""}`} title={open ? "Fold away the blur fills, shot effects and background" : "Show every layer: blur fills, shot effects, background"}
      onClick={toggle}>
      <Icon name="layers" size={12} />
    </button>
  );
}

/** One track's clips; on the Footage track, the transitions on its cuts too. */
export function SceneLaneRow({ lane, pxPerSec }: { lane: SceneLane; pxPerSec: number }) {
  const m = useEditor((s) => s.plan.motion.find((x) => x.id === lane.scene));
  const scene = useEditor((s) => (m?.scene ? s.scenes[m.scene] : undefined));
  const cutFx = useEditor((s) => s.plan.cutEffects);
  if (!m || !scene) return null;
  const shots = lane.lane.kind === "shot" && lane.lane.n === 1;
  const clips = shots ? clipsOf(m, scene) : [];
  const cuts = clips.filter((c) => c.kind === "shot" && c.start > 0.05).map((c) => onTimeline(m, c.start));
  // The edit's own flashes and wipes: an effect layer starting with its shot, short of the shot's length.
  const own = clips.filter((c) => c.kind === "effect" && c.group && Math.abs(c.start - c.group.start) < 0.05 && c.group.start > 0.05 && /Flash|Blinds/.test(c.name));
  return (
    <>
      {lane.lane.clips.map((c) => <SceneClipBlock key={c.id} m={m} scene={scene} clip={c} pxPerSec={pxPerSec} />)}
      {own.map((c) => {
        const dur = c.name === "Flash" ? 0.15 : 0.25;
        return (
          <CutBand key={c.id} x={onTimeline(m, c.start) * pxPerSec} from={onTimeline(m, c.start)} w={dur * pxPerSec} kind="own" label={`${c.name} (from the edit)`}
            on={useEditor.getState().selectedClip?.clip === c.id} onPick={() => useEditor.getState().selectClip({ scene: m.id, clip: c.id })}>
            <i className={`tr-fx ${c.name === "Flash" ? "flash" : "blinds"}`} />
          </CutBand>
        );
      })}
      {shots && (cutFx ?? []).filter((c) => cuts.some((t) => Math.abs(t - c.at) < 0.02)).map((c) => <CutEffectMark key={c.id} c={c} />)}
    </>
  );
}

/** Timeline seconds of a scene second, for a scene clip. */
const onTimeline = (m: Motion, t: number) => m.at - (m.offset ?? 0) + t;

/** Changes the clip edit of `clip` (one undo step unless `record` is false). */
export function editClip(m: Motion, clip: SceneClip, fn: (e: LayerEdit) => LayerEdit, record = true) {
  useEditor.getState().editLayer(m.id, clipKey(clip.id), (e) => {
    const next = fn({ ...e, members: clip.members });
    // Nothing changed any more: no edit at all.
    const { members: _, ...rest } = next;
    return Object.values(rest).every((v) => v === undefined) ? {} : next;
  }, record);
}

/** Keys that are the recorded ones moved as a whole: same times and easing, every value off by the same amount (or factor). */
function shiftedOnly(list: { t: number; v: number; ease?: string }[], base: { t: number; v: number; ease?: string }[] | undefined): boolean {
  if (!base || base.length !== list.length) return false;
  const d = list[0].v - base[0].v;
  const f = Math.abs(base[0].v) > 1e-6 ? list[0].v / base[0].v : NaN;
  return list.every((k, i) => Math.abs(k.t - base[i].t) < 1e-3 && (k.ease ?? "linear") === (base[i].ease ?? "linear"))
    && (list.every((k, i) => Math.abs(k.v - base[i].v - d) < 1e-3) || list.every((k, i) => Math.abs(k.v - base[i].v * f) < 1e-3));
}

/** The playhead in a clip's keyframe time (seconds after its keyframes' t = 0). */
export const clipTime = (m: Motion, clip: SceneClip, time: number) => time - m.at + (m.offset ?? 0) - (clip.keyStart + clip.shift);

/**
 * Sets a clip property the way an editor does. With keyframes you set, a keyframe at the playhead.
 * With only the movement the edit recorded (a title's entrance), the whole movement shifts, like
 * moving a clip with an in-animation. Without keyframes, its value for the whole clip. Reads the
 * latest plan, so a drag's steps build on each other.
 */
export function setClipProp(sceneId: string, scene: Scene, clip: SceneClip, values: Partial<Record<ClipProp, number>>) {
  const s = useEditor.getState();
  const m = s.plan.motion.find((x) => x.id === sceneId);
  if (!m) return;
  const t = Math.max(0, clipTime(m, clip, s.time));
  const own = m.layers?.[clipKey(clip.id)];
  let keys = clipKeys(scene, clip, m.layers);
  const recorded = own?.keyBase ?? recordedKeys(scene, clip);
  const still: Partial<Record<ClipProp, number>> = {};
  for (const [p, v] of Object.entries(values) as [ClipProp, number][]) {
    const list = keys[p];
    if (!list?.length) still[p] = v;
    else if (JSON.stringify(list) === JSON.stringify(own?.keyBase?.[p] ?? recorded[p]) || shiftedOnly(list, recorded[p])) {
      // Still the recorded movement (maybe moved as a whole before): move all of it.
      const now = valueAt(list, t, list[0].v);
      const mult = p === "scale" || p === "opacity";
      const k = mult && Math.abs(now) > 1e-6 ? v / now : 1;
      keys = { ...keys, [p]: list.map((x) => ({ ...x, v: Math.round((mult && Math.abs(now) > 1e-6 ? x.v * k : x.v + v - now) * 10000) / 10000 })) };
    } else keys = setKey(keys, p, t, v);
  }
  editClip(m, clip, () => withClipKeys(scene, clip, m.layers, { keys, ...(Object.keys(still).length ? { still } : {}) }), false);
}

/**
 * Deletes a clip: a shot's pictures (its titles stay), or the clip. The background stays (it's
 * what's under everything); hide it from its panel instead.
 */
export function deleteSceneClip(m: Motion, clip: SceneClip) {
  if (clip.locked) return;
  const s = useEditor.getState();
  const layers = { ...m.layers };
  if (clip.parts.length) for (const p of clip.parts) layers[p] = { ...layers[p], hidden: true };
  else layers[clipKey(clip.id)] = { ...layers[clipKey(clip.id)], members: clip.members, hidden: true };
  s.commit({ ...s.plan, motion: s.plan.motion.map((x) => (x.id === m.id ? { ...x, layers } : x)) });
  s.selectClip(null);
}

/** The selected scene clip, with its scene clip and scene. */
export function useSelectedClip(): { m: Motion; scene: Scene; clip: SceneClip } | undefined {
  const sel = useEditor((s) => s.selectedClip);
  const m = useEditor((s) => s.plan.motion.find((x) => x.id === sel?.scene));
  const scene = useEditor((s) => (m?.scene ? s.scenes[m.scene] : undefined));
  if (!sel || !m || !scene) return undefined;
  const clip = clipsOf(m, scene).find((c) => c.id === sel.clip);
  return clip && { m, scene, clip };
}

function SceneClipBlock({ m, scene, clip, pxPerSec }: { m: Motion; scene: Scene; clip: SceneClip; pxPerSec: number }) {
  const selected = useEditor((s) => s.selectedClip?.scene === m.id && s.selectedClip.clip === clip.id);
  // The other layers of the selected clip's shot: shown so you see what moves together.
  const linked = useEditor((s) => s.selectedClip?.scene === m.id && !selected && Boolean(clip.parent) && sceneParent(m, scene, s.selectedClip.clip) === clip.parent);
  const strip = useFileThumbs(clip.media ? sceneFile(m, clip.media.src) : undefined);
  const keys = useMemo(() => clipKeys(scene, clip, m.layers), [scene, clip, m.layers]);
  // Only the part inside the scene clip shows (after a trim or split of the whole edit).
  const offset = m.offset ?? 0;
  const from = Math.max(clip.start, offset);
  const to = Math.min(clip.end, offset + m.duration);
  if (to - from < 1e-3) return null;
  const left = onTimeline(m, from) * pxPerSec;
  const w = Math.max(3, (to - from) * pxPerSec - 1);
  // Seconds from the block's left edge to the keyframes' t = 0.
  const lead = clip.keyStart + clip.shift - from;
  const own = m.layers?.[clipKey(clip.id)];

  const drag = (mode: "move" | "start" | "end") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = useEditor.getState();
    s.selectClip({ scene: m.id, clip: clip.id });
    if (clip.locked) return;
    const x0 = e.clientX;
    // A shot's picture layers (footage, blur fill, effects) move and trim the whole shot, like
    // linked clips; its titles and graphics move and trim on their own, inside it.
    const g = clip.group && (clip.kind === "shot" || clip.kind === "fill" || clip.kind === "effect") ? clip.group : undefined;
    const gEdit = g ? m.layers?.[clipKey(g.id)] : undefined;
    const span = g ? { start: g.start, end: g.end, min: g.min, max: g.max, shift: g.shift } : clip;
    const shift0 = (g ? gEdit?.shift : own?.shift) ?? 0;
    const win0 = (g ? gEdit?.window : own?.window) ?? [span.min - span.shift, span.max - span.shift];
    // Inside its shot, a title stays within the shot.
    const bounds = clip.group && !g ? [clip.group.start, clip.group.end] : [0, scene.duration];
    const write = (fn: (e: LayerEdit) => LayerEdit) =>
      g ? useEditor.getState().editLayer(m.id, clipKey(g.id), (e) => tidyEdit(fn({ ...e, members: [g.id] })), false) : editClip(m, clip, fn, false);
    // Snap targets: every other clip of this edit, and the rest of the timeline's edges.
    const targets = [
      ...clipsOf(m, scene).filter((c) => c.id !== clip.id).flatMap((c) => [onTimeline(m, c.start), onTimeline(m, c.end)]),
      ...edges(s.plan, s.time, m.id),
    ];
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      if (!moved) (moved = true), useEditor.getState().checkpoint();
      const st = useEditor.getState();
      const within = useMagnet.getState().on ? SNAP_PX / st.pxPerSec : 0;
      let d = (ev.clientX - x0) / st.pxPerSec;
      let line: number | null = null;
      if (mode === "move") {
        // Snapped by whichever edge comes closest; kept inside the edit (a title inside its shot).
        const a = onTimeline(m, span.start) + d, b = onTimeline(m, span.end) + d;
        const sa = nearest(a, targets, within), sb = nearest(b, targets, within);
        if (sa !== undefined && (sb === undefined || Math.abs(sa - a) <= Math.abs(sb - b))) (d += sa - a), (line = sa);
        else if (sb !== undefined) (d += sb - b), (line = sb);
        d = Math.max(bounds[0] - span.start, Math.min(bounds[1] - span.end, d));
        write((x) => ({ ...x, shift: round(shift0 + d) || undefined }));
      } else {
        // Trimmed within its content (it can't show more than there is).
        const edge = onTimeline(m, mode === "start" ? span.start : span.end) + d;
        const snapped = nearest(edge, targets, within);
        if (snapped !== undefined) (d += snapped - edge), (line = snapped);
        const [a0, b0] = win0;
        const a = mode === "start" ? Math.max(span.min - span.shift, Math.min(b0 - 0.1, a0 + d)) : a0;
        const b = mode === "end" ? Math.min(span.max - span.shift, Math.max(a0 + 0.1, b0 + d)) : b0;
        const whole = a <= span.min - span.shift + 1e-3 && b >= span.max - span.shift - 1e-3;
        write((x) => ({ ...x, window: whole ? undefined : [round(a), round(b)] }));
      }
      useMagnet.setState({ line });
    };
    const up = () => {
      magnetDone();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  const fromFile = clip.media ? clip.media.offset + (from - clip.media.start) * clip.media.rate : 0;
  const times = keyTimes(keys as Keys).filter((t) => lead + t >= -1e-3 && (lead + t) * pxPerSec <= w + 1);
  const trimmed = Boolean(own?.window);
  return (
    <div
      className={`sc-clip ${clip.kind} ${selected ? "selected" : ""} ${linked ? "linked" : ""} ${clip.locked ? "locked" : ""}`}
      data-sel={`sc:${m.id}:${clip.id}`}
      style={{ left, width: w }}
      onPointerDown={drag("move")}
      title={tip(clip, trimmed)}
    >
      {clip.kind === "shot" && strip && <FilmStrip thumbs={strip} from={fromFile} speed={clip.media?.rate ?? 1} w={w} />}
      <div className="sc-head">
        {clip.kind === "text" && <span className="sc-kind">{clip.steps ? "123" : "T"}</span>}
        {clip.locked && <Icon name="lock" size={10} />}
        <span className="sc-name">{clip.name}</span>
        {w > 120 && clip.effects.map((fx) => <span key={fx} className="sc-fx">{fx}</span>)}
      </div>
      {times.length > 0 && (
        <div className="key-diamonds">
          {times.map((t) => (
            <i key={t} style={{ left: (lead + t) * pxPerSec }} title={`Keyframe at ${(onTimeline(m, clip.keyStart + clip.shift + t)).toFixed(2)}s · click to go there`}
              onPointerDown={(e) => {
                e.stopPropagation();
                const s = useEditor.getState();
                s.setPlaying(false);
                s.selectClip({ scene: m.id, clip: clip.id });
                s.seek(onTimeline(m, clip.keyStart + clip.shift + t));
              }} />
          ))}
        </div>
      )}
      {!clip.locked && <div className="handle left" onPointerDown={drag("start")} />}
      {!clip.locked && <div className="handle right" onPointerDown={drag("end")} />}
    </div>
  );
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** An edit with nothing left in it but its members is no edit. */
const tidyEdit = (e: LayerEdit): LayerEdit => {
  const { members: _, ...rest } = e;
  return Object.values(rest).every((v) => v === undefined) ? {} : e;
};

function tip(c: SceneClip, trimmed: boolean): string {
  const what = { shot: "Footage", fill: "Blur fill (behind the footage)", effect: "Effect", text: c.steps ? "Animated text" : "Title", graphic: "Graphic", background: "Background" }[c.kind];
  const lines = [`${what}: ${c.name}`];
  if (c.kind === "shot" || c.kind === "fill" || c.kind === "effect") lines.push("A layer of its shot: moving or trimming it moves or trims the whole shot");
  else if (c.parent) lines.push("Inside its shot: moves on its own, within the shot");
  if (trimmed) lines.push("Trimmed");
  lines.push(c.locked ? "Locked: it's what's under everything" : "Drag to move · drag an edge to trim · ⌫ to delete");
  return lines.join("\n");
}

/** The shot a scene clip belongs to (by id), if any. */
function sceneParent(m: Motion, scene: Scene, id: string): string | undefined {
  return clipsOf(m, scene).find((c) => c.id === id)?.parent;
}

/** Where a clip is drawn right now, in page pixels (its layers' boxes together), or null when it isn't. */
function clipRect(frame: HTMLElement, clip: SceneClip): DOMRect | null {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const id of clip.members) for (const el of frame.querySelectorAll<HTMLElement>(`[data-layer="${CSS.escape(id)}"]`)) {
    const k = el.getBoundingClientRect();
    if (k.width < 1 || k.height < 1) continue;
    l = Math.min(l, k.left); t = Math.min(t, k.top); r = Math.max(r, k.right); b = Math.max(b, k.bottom);
  }
  return l === Infinity ? null : new DOMRect(l, t, r - l, b - t);
}

/** Layers that cover the frame to give a look (shading, a flash, a blurred fill, the background): picked last. */
const PASSIVE = new Set<SceneClip["kind"]>(["effect", "fill", "background"]);

type Hit = { m: Motion; scene: Scene; clip: SceneClip };
/**
 * The clips under a point of the picture, in the order a click picks them: what's drawn on top
 * first, titles, footage and graphics before the shading, blur and background over or under them.
 */
function clipsAt(frame: HTMLElement, x: number, y: number): Hit[] {
  const s = useEditor.getState();
  const hits: Hit[] = [];
  for (const m of s.plan.motion) {
    const scene = m.template === "scene" && m.scene ? s.scenes[m.scene] : undefined;
    if (!scene || m.hidden || s.time < m.at || s.time >= m.at + m.duration) continue;
    for (const clip of clipsOf(m, scene)) {
      if (s.time < onTimeline(m, clip.start) || s.time >= onTimeline(m, clip.end)) continue;
      const r = clipRect(frame, clip);
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hits.push({ m, scene, clip });
    }
  }
  // A layer that covers (nearly) the whole frame is a look laid over or under everything (film
  // grain, a full-frame shot): picked after what sits on it, footage before graphics and effects.
  const fr = frame.getBoundingClientRect();
  const covers = new Map(hits.map((h) => {
    const r = clipRect(frame, h.clip)!;
    return [h, Math.min(r.right, fr.right) - Math.max(r.left, fr.left) >= fr.width * 0.92 && Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top) >= fr.height * 0.92];
  }));
  const back = (h: Hit) => PASSIVE.has(h.clip.kind) || covers.get(h)!;
  return hits.sort((a, b) => Number(back(a)) - Number(back(b)) || (back(a) ? RANK[a.clip.kind] - RANK[b.clip.kind] : 0) || b.clip.z - a.clip.z);
}
/** Among the layers that fill the frame, which a click picks first. */
const RANK: Record<SceneClip["kind"], number> = { shot: 0, text: 1, graphic: 2, effect: 3, fill: 4, background: 5 };

/**
 * Moves a clip by dragging on the picture from a press at `e`: one undo step, its middle snapping
 * to the frame's centre lines (⌘ to place freely). A keyframe at the playhead when it moves already.
 */
function dragClip(e: PointerEvent | React.PointerEvent, frame: HTMLElement, hit: Hit, guides: (g: { x: boolean; y: boolean }) => void) {
  const { m, scene, clip } = hit;
  const s = useEditor.getState();
  s.setPlaying(false);
  const fr = frame.getBoundingClientRect();
  const rect = clipRect(frame, clip);
  if (!rect || clip.locked) return;
  // The scene is fitted in the frame: a share of its width is this many pixels.
  const k = Math.min(fr.width / scene.width, fr.height / scene.height);
  const t = Math.max(0, clipTime(m, clip, s.time));
  const keys = clipKeys(scene, clip, m.layers);
  const x0 = keys.x?.length ? valueAtKeys(keys.x, t) : (m.layers?.[clipKey(clip.id)]?.still?.x ?? recordedOr(scene, clip, "x"));
  const y0 = keys.y?.length ? valueAtKeys(keys.y, t) : (m.layers?.[clipKey(clip.id)]?.still?.y ?? recordedOr(scene, clip, "y"));
  const mid0 = { x: rect.left + rect.width / 2 - fr.left, y: rect.top + rect.height / 2 - fr.top };
  const px = e.clientX, py = e.clientY;
  let moved = false;
  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - px, ev.clientY - py) < 3) return;
    if (!moved) (moved = true), useEditor.getState().checkpoint();
    let dx = ev.clientX - px, dy = ev.clientY - py;
    const gx = !ev.metaKey && Math.abs(mid0.x + dx - fr.width / 2) < 6;
    const gy = !ev.metaKey && Math.abs(mid0.y + dy - fr.height / 2) < 6;
    if (gx) dx = fr.width / 2 - mid0.x;
    if (gy) dy = fr.height / 2 - mid0.y;
    guides({ x: gx, y: gy });
    setClipProp(m.id, scene, clip, { x: round(x0 + dx / (scene.width * k)), y: round(y0 + dy / (scene.height * k)) });
  };
  const up = () => {
    guides({ x: false, y: false });
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
}

/**
 * Picking clips on the picture, like an editor's canvas: click a title, the footage or a graphic
 * to select it, press and drag to move it, ⌥-click to pick the layer behind the selected one. A
 * thin outline shows what a click would pick; the selected clip gets its box and name. Clicks on
 * Creatro's own captions, B-roll and handles keep doing what they did.
 */
export function SceneClipBox({ frame, overlay }: { frame: HTMLDivElement | null; overlay: HTMLDivElement | null }) {
  const sel = useSelectedClip();
  const time = useEditor((s) => s.time);
  const [box, setBox] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const [hover, setHover] = useState<{ l: number; t: number; w: number; h: number; name: string } | null>(null);
  const [guide, setGuide] = useState({ x: false, y: false });
  const members = sel?.clip.members.join(",");

  // The selected clip's box, read each frame (it moves as it plays).
  useEffect(() => {
    if (!sel || !frame) return setBox(null);
    let raf = 0;
    const measure = () => {
      const o = frame.getBoundingClientRect();
      const r = clipRect(frame, sel.clip);
      const next = r && { l: r.left - o.left, t: r.top - o.top, w: r.width, h: r.height };
      setBox((p) => (p && next && Math.abs(p.l - next.l) + Math.abs(p.t - next.t) + Math.abs(p.w - next.w) + Math.abs(p.h - next.h) < 0.5 ? p : next));
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [members, sel?.m.id, frame, time]);

  // Click and hover on the picture. Listening while the event goes down to the page (capture),
  // a press on a clip is taken before the frame's own drag (which moves the main video).
  useEffect(() => {
    if (!frame) return;
    const ours = (t: EventTarget | null) => !(t instanceof HTMLElement) || !t.closest(".caption, .cap-handle, .broll-box, .size-box, .point-catcher, .marker-pin, .viewer-reset");
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !ours(e.target) || useEditor.getState().pointing) return;
      const hits = clipsAt(frame, e.clientX, e.clientY);
      if (!hits.length) return;
      const cur = useEditor.getState().selectedClip;
      const at = hits.findIndex((h) => h.m.id === cur?.scene && h.clip.id === cur?.clip);
      // The selected clip stays picked while it's under the pointer (so it can be dragged even
      // when something is drawn over it); ⌥ picks the one behind it, round and round.
      const hit = e.altKey ? hits[(at + 1) % hits.length] : at >= 0 ? hits[at] : hits[0];
      e.stopPropagation();
      e.preventDefault();
      useEditor.getState().selectClip({ scene: hit.m.id, clip: hit.clip.id });
      setHover(null);
      if (!hit.clip.locked) dragClip(e, frame, hit, setGuide);
    };
    let raf = 0;
    const move = (e: PointerEvent) => {
      if (e.buttons) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const hit = ours(e.target) ? clipsAt(frame, e.clientX, e.clientY)[0] : undefined;
        const cur = useEditor.getState().selectedClip;
        if (!hit || (hit.m.id === cur?.scene && hit.clip.id === cur?.clip)) return setHover(null);
        const o = frame.getBoundingClientRect();
        const r = clipRect(frame, hit.clip)!;
        setHover({ l: r.left - o.left, t: r.top - o.top, w: r.width, h: r.height, name: hit.clip.name });
      });
    };
    const leave = () => (cancelAnimationFrame(raf), setHover(null));
    frame.addEventListener("pointerdown", down, true);
    frame.addEventListener("pointermove", move);
    frame.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      frame.removeEventListener("pointerdown", down, true);
      frame.removeEventListener("pointermove", move);
      frame.removeEventListener("pointerleave", leave);
    };
  }, [frame]);

  if (!overlay) return null;
  const pressBox = (e: React.PointerEvent) => {
    if (e.button !== 0 || !frame || !sel) return;
    e.stopPropagation();
    // ⌥ on the selected clip: the layer behind it.
    if (e.altKey) {
      const hits = clipsAt(frame, e.clientX, e.clientY);
      const at = hits.findIndex((h) => h.m.id === sel.m.id && h.clip.id === sel.clip.id);
      const next = hits[(at + 1) % Math.max(1, hits.length)];
      if (next) useEditor.getState().selectClip({ scene: next.m.id, clip: next.clip.id });
      return;
    }
    dragClip(e, frame, sel, setGuide);
  };
  return createPortal(
    <>
      {guide.x && <div className="snap-guide v" />}
      {guide.y && <div className="snap-guide h" />}
      {hover && (
        <div className="sc-hover" style={{ left: hover.l, top: hover.t, width: hover.w, height: hover.h }}>
          <span className="sc-hover-tag">{hover.name}</span>
        </div>
      )}
      {sel && box && (
        <div className={`sc-box ${sel.clip.kind} ${sel.clip.locked ? "locked" : ""}`} style={{ left: box.l, top: box.t, width: box.w, height: box.h }} onPointerDown={pressBox}
          title={`${sel.clip.name}\n${sel.clip.locked ? "Locked" : `Drag to move it${clipKeys(sel.scene, sel.clip, sel.m.layers).x?.length ? " (sets a keyframe at the playhead)" : ""}`} · ⌥-click for the layer behind`}>
          <span className="sc-box-tag">{sel.clip.name}</span>
        </div>
      )}
    </>,
    overlay,
  );
}

const valueAtKeys = (keys: { t: number; v: number; ease?: "linear" | "ease" | "in" | "out" }[], t: number) => valueAt(keys, t, keys[0]?.v ?? 0);
const recordedOr = (scene: Scene, clip: SceneClip, p: ClipProp) => recordedStill(scene, clip, p);
