// The effects a Claude edit is made with (its flashes, blinds wipes, shading, film texture),
// taken out as presets for the effects library: each one its own layers with their keyframes,
// timed from 0, drawn by the scene renderer wherever it's used. Pure; the library file itself is
// kept by src/effectLibrary.ts.
import { type LayerEdit, type Scene, type SceneLayer, applyEdits, channelAt, flatLayers } from "./scene.ts";
import { sceneClips } from "./sceneClips.ts";

export type EffectPreset = {
  /** Stable: made from what it draws, so the same effect from two edits is one preset. */
  id: string;
  name: string;
  category: "transition" | "light" | "texture";
  /** Seconds it runs when added (a transition: as long as its movement). */
  duration: number;
  /** The edit it came from. */
  source: string;
  width: number;
  height: number;
  layers: SceneLayer[];
};

/** A short hash of a string (FNV-1a), for preset ids. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

/**
 * What makes two effects the same one: their kind and look, their timing to a tenth of a second,
 * and how many layers they're made of (the same wipe on two shots differs by a frame here or there).
 */
const likeness = (name: string, duration: number, layers: SceneLayer[]): string => {
  const all = flatLayers(layers).map((x) => x.layer);
  const look = all.map((l) => [l.style["background-color"], l.style["background-image"]?.slice(0, 80), l.kind].join("|")).join(";");
  return `${name}|${name === "Shade" || name === "Texture" ? "" : Math.round(duration * 10)}|${all.length}|${look}`;
};

/** Keyframes kept only over the preset's own run (a little either side): it's drawn from 0 to `end`. */
function trim(layers: SceneLayer[], end: number): SceneLayer[] {
  const keep = <T,>(c: [number, T][]) => {
    const inside = c.filter(([t]) => t >= -0.05 && t <= end + 0.05);
    // The value it had going in, and where it was going on the way out, so it still reads the same.
    const before = [...c].reverse().find(([t]) => t < -0.05);
    const after = c.find(([t]) => t > end + 0.05);
    return [...(before ? [[0, before[1]] as [number, T]] : []), ...inside, ...(after && inside.length ? [after] : [])].filter((k, i, a) => i === 0 || k[0] > a[i - 1][0]);
  };
  const one = (l: SceneLayer): SceneLayer => ({
    ...l,
    anim: Object.fromEntries(Object.entries(l.anim).map(([k, c]) => [k, Array.isArray(c) ? keep(c) : c])) as SceneLayer["anim"],
    ...(l.styleAnim ? { styleAnim: Object.fromEntries(Object.entries(l.styleAnim).map(([k, c]) => [k, keep(c)])) } : {}),
    ...(l.svgAnim ? { svgAnim: keep(l.svgAnim) } : {}),
    ...(l.htmlAnim ? { htmlAnim: keep(l.htmlAnim) } : {}),
    ...(l.paint ? { paint: { color: Array.isArray(l.paint.color) ? keep(l.paint.color) : l.paint.color, bg: Array.isArray(l.paint.bg) ? keep(l.paint.bg) : l.paint.bg } } : {}),
    children: l.children.map(one),
  });
  return layers.map(one);
}

/** Everything that moves in some layers: their last keyframe after `from`, seconds. */
function lastMove(layers: SceneLayer[], from: number): number {
  let end = from;
  for (const { layer } of flatLayers(layers))
    for (const [k, c] of Object.entries(layer.anim))
      if (k !== "show" && Array.isArray(c) && c.length > 1 && c.some(([, v]) => v !== c[0][1]))
        for (const [t] of c) if (t > from && t < from + 3) end = Math.max(end, t);
  return end;
}

/** The effects of a scene, as presets (with the user's edits to it ignored: the edit as made). */
export function sceneEffects(scene: Scene): EffectPreset[] {
  const out: EffectPreset[] = [];
  const byId = new Map(flatLayers(scene.layers).map((x) => [x.layer.id, x.layer]));
  for (const clip of sceneClips(scene, undefined)) {
    const kind = clip.kind === "effect" ? (clip.name === "Shade" ? "light" : "transition") : clip.kind === "graphic" && clip.name === "Texture" ? "texture" : undefined;
    if (!kind) continue;
    const members = clip.members.map((id) => byId.get(id)).filter((x): x is SceneLayer => Boolean(x));
    // Anything that loads a file (a picture, a video) stays with its edit.
    if (members.some((m) => flatLayers([m]).some((x) => x.layer.src || /url\(/.test(x.layer.style["background-image"] ?? "")))) continue;
    // Timed from 0: moved back by where it starts in the edit, on a frame the size of the edit's.
    const edits: Record<string, LayerEdit> = Object.fromEntries(members.map((m) => [m.id, { shift: -clip.start }]));
    const mini: Scene = { ...scene, layers: members, audio: [], fonts: [], duration: clip.end - clip.start };
    const duration = kind === "transition"
      ? Math.max(0.15, Math.min(clip.end - clip.start, lastMove(members, clip.start) - clip.start + 0.05))
      : 3; // a look runs as long as it's wanted: three seconds to start with
    const layers = trim(applyEdits(mini, edits).layers.map((l) => ({ ...l, anim: { ...l.anim, show: 1 } })), duration);
    // A shade or texture that never shows anything isn't worth keeping.
    if (kind !== "transition" && members.every((m) => channelAt("opacity", m.anim.opacity, clip.start + 0.1) < 0.02)) continue;
    const id = `lib:${hash(likeness(clip.name, duration, layers))}`;
    if (out.some((p) => p.id === id)) continue;
    out.push({ id, name: clip.name, category: kind, duration: Math.round(duration * 100) / 100, source: scene.name, width: scene.width, height: scene.height, layers });
  }
  return out;
}

/** A preset as a scene the renderer can draw (its layers, on its own frame, for its duration). */
export const presetScene = (p: EffectPreset): Scene => ({
  version: 1, name: p.name, source: p.source, width: p.width, height: p.height, duration: Math.max(p.duration, 3600), fps: 30, detail: "balanced", fonts: [], layers: p.layers, audio: [],
});
