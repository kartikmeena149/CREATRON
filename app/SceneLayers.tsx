// The timeline inside an imported Claude edit: one row per layer (like a comp's layers), a bar
// where the layer shows, and its keyframes as diamonds. Twirl a layer open for a row per animated
// property. Click a diamond to go there, drag it to retime, ⌫ to delete it.
import { useMemo } from "react";
import { create } from "zustand";
import {
  type Channel, type ChannelName, type SceneLayer, applyEdits, channelAt, deleteKeys, flatLayers, keyCount, moveKeys, sceneStats,
} from "../src/scene.ts";
import type { Motion } from "../src/schema.ts";
import { Icon } from "./icons.tsx";
import { useEditor } from "./store.ts";

export const ROW_H = 24;
const LABELS: Partial<Record<ChannelName, string>> = {
  tx: "Position X", ty: "Position Y", sx: "Scale X", sy: "Scale Y", rot: "Rotation", opacity: "Opacity", show: "Visible", blur: "Blur",
  x: "Left", y: "Top", w: "Width", h: "Height",
};

/** Which groups are folded and which layers show their property rows (kept while you click around). */
const useFold = create<{ closed: Set<string>; props: Set<string>; toggle(kind: "closed" | "props", id: string): void }>((set) => ({
  closed: new Set(),
  props: new Set(),
  toggle: (kind, id) => set((s) => {
    const next = new Set(s[kind]);
    next.has(id) ? next.delete(id) : next.add(id);
    return { [kind]: next } as Pick<typeof s, typeof kind>;
  }),
}));

type Row = { key: string; layer: SceneLayer; depth: number; channel?: ChannelName };

/** The open scene clip, the scene with the user's changes, and the rows the timeline shows. */
export function useSceneRows() {
  const id = useEditor((s) => s.openScene);
  const m = useEditor((s) => s.plan.motion.find((x) => x.id === id && x.template === "scene"));
  const base = useEditor((s) => (m?.scene ? s.scenes[m.scene] : undefined));
  const { closed, props } = useFold();
  return useMemo(() => {
    if (!m || !base) return undefined;
    const scene = applyEdits(base, Object.fromEntries(Object.entries(m.layers ?? {}).map(([k, e]) => [k, { ...e, hidden: false }])));
    const rows: Row[] = [];
    const walk = (list: SceneLayer[], depth: number) => {
      for (const l of list) {
        rows.push({ key: l.id, layer: l, depth });
        if (props.has(l.id))
          for (const c of Object.keys(l.anim) as ChannelName[]) if (keyCount(l.anim[c]) > 1) rows.push({ key: `${l.id}.${c}`, layer: l, depth: depth + 1, channel: c });
        if (!closed.has(l.id)) walk(l.children, depth + 1);
      }
    };
    walk(scene.layers, 0);
    return { m, scene, rows, stats: sceneStats(base) };
  }, [m, base, closed, props]);
}

/** Bar above the layers: where you are, and the way back to the tracks. */
export function SceneBar() {
  const s = useSceneRows();
  if (!s) return null;
  return (
    <div className="scene-bar">
      <button className="link" onClick={() => useEditor.setState({ openScene: null, selectedLayer: null, sceneKey: null })}>Timeline</button>
      <span className="dim">›</span>
      <b>✦ {s.m.text}</b>
      <span className="dim small">{s.stats.layers} layers · {s.stats.keyframes.toLocaleString()} keyframes</span>
      <span className="grow" />
      <button className="ghost small" onClick={() => useEditor.setState({ openScene: null, selectedLayer: null, sceneKey: null })}>Close layers</button>
    </div>
  );
}

const pick = (m: Motion, layer: string) =>
  useEditor.setState({ selectedLayer: layer, selectedMotion: m.id, selected: null, picked: [], pickedIds: [], selectedCue: null, selectedVo: null, selectedBroll: null, leftView: "text" });

export function SceneLabels() {
  const s = useSceneRows();
  const selectedLayer = useEditor((st) => st.selectedLayer);
  const { closed, props, toggle } = useFold();
  if (!s) return null;
  const hidden = (id: string) => Boolean(s.m.layers?.[id]?.hidden);
  return (
    <>
      {s.rows.map((r) => {
        const keyed = Object.values(r.layer.anim).filter((c) => keyCount(c) > 1).length;
        return (
          <div
            key={r.key}
            className={`scene-label ${r.channel ? "prop" : ""} ${selectedLayer === r.layer.id && !r.channel ? "on" : ""} ${hidden(r.layer.id) ? "off" : ""}`}
            style={{ height: ROW_H, paddingLeft: 6 + r.depth * 12 }}
            onPointerDown={() => pick(s.m, r.layer.id)}
            title={r.channel ? LABELS[r.channel] : `${r.layer.name} (${r.layer.kind})`}
          >
            {r.channel ? (
              <span className="dim">{LABELS[r.channel] ?? r.channel}</span>
            ) : (
              <>
                <button className={`twirl ${r.layer.children.length ? "" : "none"}`} onPointerDown={(e) => (e.stopPropagation(), toggle("closed", r.layer.id))}>
                  {r.layer.children.length ? (closed.has(r.layer.id) ? "▸" : "▾") : ""}
                </button>
                <span className="kind">{KIND[r.layer.kind]}</span>
                <span className="name">{r.layer.name}</span>
                {keyed > 0 && (
                  <button className={`keys ${props.has(r.layer.id) ? "on" : ""}`} title="Show its animated properties" onPointerDown={(e) => (e.stopPropagation(), toggle("props", r.layer.id))}>◆</button>
                )}
                <button
                  className="eye"
                  title={hidden(r.layer.id) ? "Show this layer" : "Hide this layer"}
                  onPointerDown={(e) => (e.stopPropagation(), useEditor.getState().editLayer(s.m.id, r.layer.id, (x) => ({ ...x, hidden: x.hidden ? undefined : true })))}
                >
                  <Icon name={hidden(r.layer.id) ? "eyeOff" : "eye"} size={12} />
                </button>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

const KIND: Record<SceneLayer["kind"], string> = { group: "▭", text: "T", image: "▣", video: "▶", svg: "✎" };

/** Key times of a layer: one channel's, or every channel's together. */
function keyTimes(l: SceneLayer, channel?: ChannelName): number[] {
  const chans = channel ? [l.anim[channel]] : Object.values(l.anim);
  const set = new Set<number>();
  for (const c of chans) if (Array.isArray(c) && c.length > 1) for (const [t] of c) set.add(t);
  return [...set].sort((a, b) => a - b);
}

/** Spans (scene seconds) where the layer can be seen, sampled 10× a second. */
function shownSpans(l: SceneLayer, duration: number): [number, number][] {
  const spans: [number, number][] = [];
  let from = -1;
  for (let t = 0; t <= duration + 1e-6; t += 0.1) {
    const on = channelAt("show", l.anim.show, t) > 0 && channelAt("opacity", l.anim.opacity, t) > 0.01;
    if (on && from < 0) from = t;
    if (!on && from >= 0) spans.push([from, t]), (from = -1);
  }
  if (from >= 0) spans.push([from, duration]);
  return spans;
}

export function SceneRows({ pxPerSec }: { pxPerSec: number }) {
  const s = useSceneRows();
  const selectedLayer = useEditor((st) => st.selectedLayer);
  const sceneKey = useEditor((st) => st.sceneKey);
  if (!s) return null;
  const { m, scene } = s;
  const offset = m.offset ?? 0;
  // Scene seconds → timeline seconds, and whether that moment is inside the clip.
  const toT = (t: number) => m.at - offset + t;
  const inClip = (t: number) => t >= offset - 1e-6 && t <= offset + m.duration + 1e-6;
  const x = (t: number) => toT(t) * pxPerSec;

  const dragKey = (r: Row, t: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const st = useEditor.getState();
    pick(m, r.layer.id);
    st.seek(toT(t));
    useEditor.setState({ sceneKey: { layer: r.layer.id, channel: r.channel ?? null, t } });
    const x0 = e.clientX;
    const fps = scene.fps;
    const names = (r.channel ? [r.channel] : (Object.keys(r.layer.anim) as ChannelName[])).filter((c) => Array.isArray(r.layer.anim[c]));
    const orig = Object.fromEntries(names.map((c) => [c, r.layer.anim[c] as Channel]));
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      if (!moved) (moved = true), useEditor.getState().checkpoint();
      // Whole frames, never before the scene starts.
      const dt = Math.max(-t, Math.round(((ev.clientX - x0) / pxPerSec) * fps) / fps);
      const anim = Object.fromEntries(names.map((c) => [c, moveKeys(orig[c], [t], dt)]));
      useEditor.getState().editLayer(m.id, r.layer.id, (x) => ({ ...x, anim: { ...x.anim, ...anim } }), false);
      useEditor.setState({ sceneKey: { layer: r.layer.id, channel: r.channel ?? null, t: Math.round((t + dt) * 1000) / 1000 } });
      useEditor.getState().seek(toT(t + dt));
    };
    const up = () => (window.removeEventListener("pointermove", onMove), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      {s.rows.map((r) => {
        const keys = keyTimes(r.layer, r.channel).filter(inClip);
        const spans = r.channel ? [] : shownSpans(r.layer, scene.duration);
        return (
          <div
            key={r.key}
            className={`scene-row ${r.channel ? "prop" : ""} ${selectedLayer === r.layer.id ? "on" : ""}`}
            style={{ height: ROW_H }}
            onPointerDown={(e) => e.target === e.currentTarget && pick(m, r.layer.id)}
          >
            {spans.map(([a, b], i) => {
              const from = Math.max(a, offset);
              const to = Math.min(b, offset + m.duration);
              return to > from && (
                <div key={i} className={`scene-span ${r.layer.kind}`} style={{ left: x(from), width: Math.max(2, (to - from) * pxPerSec) }} onPointerDown={() => pick(m, r.layer.id)} />
              );
            })}
            {keys.map((t) => (
              <div
                key={t}
                className={`scene-key ${sceneKey && sceneKey.layer === r.layer.id && (sceneKey.channel ?? undefined) === r.channel && Math.abs(sceneKey.t - t) < 1e-3 ? "on" : ""}`}
                style={{ left: x(t) }}
                title={`${(toT(t)).toFixed(2)} s · drag to move · ⌫ to delete`}
                onPointerDown={dragKey(r, t)}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

/** ⌫ on a picked keyframe: takes it out (of one property, or of every property at that moment). Returns whether it did. */
export function deleteSceneKey(): boolean {
  const st = useEditor.getState();
  const k = st.sceneKey;
  const m = st.plan.motion.find((x) => x.id === st.openScene);
  const base = m?.scene ? st.scenes[m.scene] : undefined;
  if (!k || !m || !base) return false;
  const layer = flatLayers(applyEdits(base, m.layers).layers).find((x) => x.layer.id === k.layer)?.layer;
  if (!layer) return false;
  const names = (k.channel ? [k.channel as ChannelName] : (Object.keys(layer.anim) as ChannelName[])).filter((c) => Array.isArray(layer.anim[c]));
  const anim = Object.fromEntries(names.map((c) => [c, deleteKeys(layer.anim[c] as Channel, [k.t])]));
  st.editLayer(m.id, k.layer, (x) => ({ ...x, anim: { ...x.anim, ...anim } }));
  useEditor.setState({ sceneKey: null });
  return true;
}
