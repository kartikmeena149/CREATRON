// A Claude edit brought into Creatron (a HyperFrames page): its layers, each with its look and
// keyframes, so text, colours and movement can be changed here like any other clip. The import
// (electron/sceneImport.ts) records the page frame by frame; toScene() turns that into keyframes.
// The plan keeps only what the user changed (LayerEdit), so the scene file itself never changes.
// Pure: shared by the preview, the export and the import. Times are seconds into the scene.
import { z } from "zod";
import type { PageCapture } from "../electron/scenePage.ts";

/** A constant, or keyframes [seconds, value] in time order with straight lines between them. */
export const Channel = z.union([z.number(), z.array(z.tuple([z.number(), z.number()]))]);
export type Channel = z.infer<typeof Channel>;
export type ColorChannel = string | [number, string][];

/** What can move: box (x, y, w, h: layout in the parent), tx/ty (shift), sx/sy (scale), rot (degrees), opacity, show (0/1, held), blur (px). */
export const CHANNELS = ["x", "y", "w", "h", "tx", "ty", "sx", "sy", "rot", "opacity", "show", "blur"] as const;
export type ChannelName = (typeof CHANNELS)[number];
export const CHANNEL_DEFAULT: Record<ChannelName, number> = { x: 0, y: 0, w: 0, h: 0, tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, opacity: 1, show: 1, blur: 0 };

export type LayerKind = "group" | "text" | "image" | "video" | "svg";
export type SceneLayer = {
  id: string;
  name: string;
  kind: LayerKind;
  /** CSS as the page computed it (kebab-case), minus what's animated. */
  style: Record<string, string>;
  origin: [number, number];
  anim: Partial<Record<ChannelName, Channel>>;
  /** Animated colours: text colour and background (scenes imported before styleAnim). */
  paint?: { color?: ColorChannel; bg?: ColorChannel };
  /** Styles that change over time (clip-path wipes, colours, filters…): keys [seconds, CSS value]. See styleAt. */
  styleAnim?: Record<string, [number, string][]>;
  /** A drawing whose insides move: keys [seconds, markup], numbers blended like styleAnim. */
  svgAnim?: [number, string][];
  /** Words that keep changing (a counter): [seconds, html], each held until the next. */
  htmlAnim?: [number, string][];
  html?: string;
  text?: string;
  /** Image or video file, relative to the scene's folder. */
  src?: string;
  svg?: string;
  /** Video: shown from `start` (scene seconds) playing from `offset` seconds into the file. */
  media?: { start: number; offset: number; rate: number };
  /** Paints over unpositioned siblings (as positioned / moving elements do in a page). */
  front?: boolean;
  /** One-line text whose box is as wide as its words: grows with new words from where it's aligned. */
  fit?: boolean;
  children: SceneLayer[];
};
export type SceneAudio = { file: string; name: string; at: number; offset: number; duration: number; volume: number };
export type Detail = "light" | "balanced" | "exact";
export type Scene = {
  version: 1;
  name: string;
  /** Where it came from (the project folder), and what it was made with (unset: HyperFrames). */
  source: string;
  kind?: "hyperframes" | "remotion";
  /** The caption style the project's code uses, as one of Creatron's caption animations (doc, spec…). */
  captionStyle?: "doc" | "spec" | "kinetic" | "glow";
  width: number;
  height: number;
  duration: number;
  fps: number;
  detail: Detail;
  /** @font-face rules, url()s pointing at files in the scene's folder. */
  fonts: string[];
  layers: SceneLayer[];
  audio: SceneAudio[];
};

/** What the user changed on one layer. Style wins over animated colours; anim replaces whole channels. */
export const LayerEdit = z.object({
  text: z.string().optional().describe("New words for a text layer"),
  style: z.record(z.string(), z.string()).optional().describe('CSS changes, e.g. {"color": "#ff0000", "font-size": "60px"}'),
  anim: z.record(z.string(), Channel).optional().describe("Channels replaced: a number, or keyframes [[seconds, value], …]"),
  hidden: z.boolean().optional(),
});
export type LayerEdit = z.infer<typeof LayerEdit>;

// ---------- reading channels ----------

/** A channel's value at t: held before the first key and after the last, straight lines between. */
export function valueAt(c: Channel | undefined, t: number, fallback: number): number {
  if (c === undefined) return fallback;
  if (typeof c === "number") return c;
  if (!c.length) return fallback;
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    const [t1, v1] = c[i];
    if (t < t1) {
      const [t0, v0] = c[i - 1];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return c[c.length - 1][1];
}

/** A held channel (show): the last key at or before t. */
export function stepAt(c: Channel | undefined, t: number, fallback: number): number {
  if (c === undefined) return fallback;
  if (typeof c === "number") return c;
  let v = c.length ? c[0][1] : fallback;
  for (const [k, x] of c) if (k <= t + 1e-6) v = x;
  return v;
}

export const channelAt = (name: ChannelName, c: Channel | undefined, t: number) =>
  name === "show" ? stepAt(c, t, 1) : valueAt(c, t, CHANNEL_DEFAULT[name]);

const rgba = (s: string): number[] => {
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m) return [0, 0, 0, 0];
  const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [v[0], v[1], v[2], v[3] ?? 1];
};
const css = (v: number[]) => `rgba(${Math.round(v[0])}, ${Math.round(v[1])}, ${Math.round(v[2])}, ${Math.round(v[3] * 1000) / 1000})`;

export function colorAt(c: ColorChannel | undefined, t: number): string | undefined {
  if (c === undefined || typeof c === "string") return c;
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++)
    if (t < c[i][0]) {
      const a = rgba(c[i - 1][1]);
      const b = rgba(c[i][1]);
      const k = (t - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return css(a.map((x, j) => x + (b[j] - x) * k));
    }
  return c[c.length - 1][1];
}

const NUM = /-?\d*\.?\d+(?:e-?\d+)?/g;
const skeleton = (v: string) => v.replace(NUM, "#");

/**
 * An animated style at t: between two keys of the same shape (only the numbers differ, like
 * inset(37% 0 0) and inset(0% 0 0)) the numbers move in a straight line; otherwise it holds.
 */
export function styleAt(keys: [number, string][], t: number): string {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t >= keys[i][0]) continue;
    const [t0, a] = keys[i - 1];
    const [t1, b] = keys[i];
    if (skeleton(a) !== skeleton(b)) return a;
    const to = (b.match(NUM) ?? []).map(Number);
    const k = (t - t0) / (t1 - t0);
    let j = 0;
    return a.replace(NUM, (x) => String(Math.round((Number(x) + (to[j++] - Number(x)) * k) * 1000) / 1000));
  }
  return keys[keys.length - 1][1];
}

/** The fewest keys that redraw a style's every frame (numbers within `rel` of their range). */
function styleTrack(times: number[], vals: string[], rel: number): string | [number, string][] {
  if (vals.every((v) => v === vals[0])) return vals[0];
  const keys: [number, string][] = [];
  for (let a = 0; a < vals.length; ) {
    let b = a;
    while (b + 1 < vals.length && skeleton(vals[b + 1]) === skeleton(vals[a])) b++;
    const seg = vals.slice(a, b + 1).map((v) => (v.match(NUM) ?? []).map(Number));
    const span = seg[0].map((_, j) => Math.max(...seg.map((r) => r[j])) - Math.min(...seg.map((r) => r[j])) || 1);
    const keep = seg[0].length ? reduce(times.slice(a, b + 1), seg.map((r) => r.map((x, j) => x / span[j])), rel) : [0];
    for (const k of keep) keys.push([round(times[a + k], 3), vals[a + k]]);
    a = b + 1;
  }
  return keys;
}

/** Keyframes in a channel (none for a constant). */
export const keyCount = (c: Channel | undefined) => (Array.isArray(c) ? c.length : 0);

/**
 * The channel with its value at t set to v: a constant stays a constant (the whole layer moves);
 * keyframes get a key at t (replacing one within half a frame).
 */
export function setChannelAt(c: Channel | undefined, t: number, v: number, fps: number): Channel {
  if (!Array.isArray(c) || !c.length) return v;
  const near = c.findIndex(([k]) => Math.abs(k - t) < 0.5 / fps);
  const keys = c.map((k) => [...k] as [number, number]);
  if (near >= 0) keys[near][1] = v;
  else keys.push([round(t, 3), v]);
  return keys.sort((a, b) => a[0] - b[0]);
}

/** A key added at t holding the current value: turns a constant into keyframes. */
export function addKey(c: Channel | undefined, name: ChannelName, t: number, fps: number): Channel {
  const v = channelAt(name, c, t);
  if (!Array.isArray(c) || !c.length) return [[round(t, 3), v]];
  return setChannelAt(c, t, v, fps);
}

/** Whole channel shifted or keys moved: the keys at `from` (seconds) moved by dt, kept in order. */
export function moveKeys(c: Channel, from: number[], dt: number): Channel {
  if (!Array.isArray(c)) return c;
  const set = new Set(from.map((t) => round(t, 3)));
  return c.map(([k, v]) => [set.has(round(k, 3)) ? Math.max(0, round(k + dt, 3)) : k, v] as [number, number]).sort((a, b) => a[0] - b[0]);
}

export function deleteKeys(c: Channel, at: number[]): Channel {
  if (!Array.isArray(c)) return c;
  const set = new Set(at.map((t) => round(t, 3)));
  const kept = c.filter(([k]) => !set.has(round(k, 3)));
  return kept.length === 0 ? c[0][1] : kept.length === 1 ? kept[0][1] : kept;
}

/** When a video layer is on screen: from its start until it's switched off (scene seconds). */
export function videoSpan(l: SceneLayer, duration: number): [number, number] {
  const start = l.media?.start ?? 0;
  const show = l.anim.show;
  const off = Array.isArray(show) ? show.find(([t, v]) => t > start && v === 0)?.[0] : undefined;
  return [start, off ?? duration];
}

const spans = new WeakMap<SceneLayer, [number, number][]>();
/** The on-screen spans of every video in a layer and under it (worked out once per layer). */
export function videoSpans(l: SceneLayer, duration: number): [number, number][] {
  let out = spans.get(l);
  if (!out) {
    out = [...(l.kind === "video" ? [videoSpan(l, duration)] : []), ...l.children.flatMap((c) => videoSpans(c, duration))];
    spans.set(l, out);
  }
  return out;
}

// ---------- fonts ----------

/** One @font-face rule's family, file (its first url()) and descriptors. */
export function parseFontFace(rule: string): { family: string; src: string; weight: string; style: string; unicodeRange?: string } | undefined {
  const get = (name: string) => new RegExp(`${name}\\s*:\\s*([^;}]+)`).exec(rule)?.[1].trim();
  const family = get("font-family")?.replace(/^["']|["']$/g, "");
  const src = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(rule)?.[1];
  if (!family || !src) return undefined;
  return { family, src, weight: get("font-weight") ?? "normal", style: get("font-style") ?? "normal", ...(get("unicode-range") ? { unicodeRange: get("unicode-range") } : {}) };
}

// ---------- captions ----------

/** The voiceover among a scene's sounds (by its name), else the longest sound that isn't music. */
export function voiceOf(scene: Scene): SceneAudio | undefined {
  const named = scene.audio.find((a) => /(^|[^a-z])(vo|voice|voiceover|narration|narrator)([^a-z]|$)/i.test(`${a.name} ${a.file}`));
  if (named) return named;
  const talk = scene.audio.filter((a) => !/music|song|bgm|beat|ambien/i.test(`${a.name} ${a.file}`) && a.duration > scene.duration * 0.4);
  return talk.sort((a, b) => b.duration - a.duration)[0];
}

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The scene's own captions: the many short-lived text layers in one band of the frame whose words
 * are being said while they show (the transcript, in scene seconds), and the containers holding
 * only them, so every word of them goes (graphics that quote the voice, like a chat bubble or a big
 * label, are fewer and elsewhere and stay). Returns the layers to hide, where captions sat (as
 * Creatron's caption y, a shift from the frame's middle), their font and whether they were in capitals.
 */
export function captionLayers(scene: Scene, words: { text: string; start: number; end: number }[]) {
  const spoken = words.map((w) => ({ ...w, k: bare(w.text) })).filter((w) => w.k);
  type Hit = { l: SceneLayer; x: number; y: number; w: number; to: number; path: SceneLayer[] };
  const hits: Hit[] = [];
  const texts = new Map<SceneLayer, number>();
  const span = (l: SceneLayer): [number, number] => {
    const show = l.anim.show;
    if (!Array.isArray(show)) return show === 0 ? [-1, -1] : [0, scene.duration];
    const on = show.find(([, v]) => v === 1);
    if (!on) return [-1, -1];
    return [on[0], show.find(([t, v]) => t > on[0] && v === 0)?.[0] ?? scene.duration];
  };
  const walk = (list: SceneLayer[], ox: number, oy: number, path: SceneLayer[]) => {
    for (const l of list) {
      const [from, to] = span(l);
      const t = from >= 0 ? (from + to) / 2 : 0;
      const x = ox + channelAt("x", l.anim.x, t) + channelAt("tx", l.anim.tx, t);
      const y = oy + channelAt("y", l.anim.y, t) + channelAt("ty", l.anim.ty, t);
      if (l.kind === "text" && l.text) for (const p of path) texts.set(p, (texts.get(p) ?? 0) + 1);
      if (l.kind === "text" && l.text && from >= 0 && to - from <= 8) {
        const mine = l.text.split(/\s+/).map(bare).filter(Boolean);
        // Said while it shows, or just before (a caption's previous line stays up, dimmed, after it was said).
        const said = mine.filter((k) => spoken.some((w) => w.k === k && w.end >= from - 4 && w.start <= to + 0.6));
        if (mine.length && mine.length <= 10 && said.length / mine.length >= 0.6) {
          // Where it is on the frame at its own moment (its parents move as captions reflow).
          const at = (k: "x" | "y", tk: "tx" | "ty") => [...path, l].reduce((n, p) => n + channelAt(k, p.anim[k], t) + channelAt(tk, p.anim[tk], t), 0);
          hits.push({ l, x: at("x", "tx"), y: at("y", "ty") + channelAt("h", l.anim.h, t) / 2, w: channelAt("w", l.anim.w, t), to, path });
        }
      }
      walk(l.children, x, y, [...path, l]);
    }
  };
  walk(scene.layers, 0, 0, []);
  // Captions live in one band of the frame; keep the busy bands.
  const band = (y: number) => Math.round(y / (scene.height * 0.08));
  const count = new Map<number, number>();
  for (const h of hits) count.set(band(h.y), (count.get(band(h.y)) ?? 0) + 1);
  const most = Math.max(0, ...count.values());
  const keep = hits.filter((h) => (count.get(band(h.y)) ?? 0) >= Math.max(6, most * 0.25));
  if (!keep.length) return undefined;
  // Every word of them: the topmost containers whose text is mostly captions and that hold no picture or video.
  const mine = new Map<SceneLayer, number>();
  for (const h of keep) for (const p of h.path) mine.set(p, (mine.get(p) ?? 0) + 1);
  const media = (l: SceneLayer): boolean => l.kind === "video" || l.kind === "image" || l.children.some(media);
  // Captions come from one caption component, so they gather in one or two containers; a label or
  // a typed tag that happens to say a spoken word sits in a container of its own.
  const boxes = new Map<SceneLayer, Hit[]>();
  for (const h of keep) {
    const box = h.path.find((p) => !media(p) && (mine.get(p) ?? 0) / (texts.get(p) ?? 1) >= 0.7 && p !== scene.layers[0]) ?? h.l;
    boxes.set(box, [...(boxes.get(box) ?? []), h]);
  }
  const biggest = Math.max(...[...boxes.values()].map((b) => b.length));
  const chosen = [...boxes].filter(([, b]) => b.length >= Math.max(4, biggest * 0.3));
  const hide = new Set(chosen.map(([box]) => box));
  keep.splice(0, keep.length, ...chosen.flatMap(([, b]) => b));
  const ys = keep.map((h) => h.y).sort((a, b) => a - b);
  const fonts = new Map<string, number>();
  for (const h of keep) {
    const f = (h.l.style["font-family"] ?? "").split(",")[0].replace(/["']/g, "").trim();
    if (f) fonts.set(f, (fonts.get(f) ?? 0) + 1);
  }
  // The accent: the most common bright colour among them (the key word's colour).
  const accents = new Map<string, number>();
  for (const h of keep) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(h.l.style.color ?? "");
    if (!m) continue;
    const [r, g, b] = m.slice(1).map(Number);
    if (Math.max(r, g, b) - Math.min(r, g, b) < 60) continue; // white, grey, black
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    accents.set(hex, (accents.get(hex) ?? 0) + 1);
  }
  // Layout: captions are lines of words that leave together; where their lines start and end
  // says how they're aligned, the container they're in says how wide their column is.
  const lines = new Map<string, Hit[]>();
  for (const h of keep) {
    const k = `${Math.round(h.to * 10)}|${Math.round(h.y / 20)}`;
    lines.set(k, [...(lines.get(k) ?? []), h]);
  }
  /** How many of the values sit at the most common one (within 6px): lined-up edges share one. */
  const share = (v: number[]) => {
    const n = new Map<number, number>();
    for (const x of v) n.set(Math.round(x / 6), (n.get(Math.round(x / 6)) ?? 0) + 1);
    return v.length ? Math.max(...n.values()) / v.length : 0;
  };
  const starts = [...lines.values()].map((ws) => Math.min(...ws.map((h) => h.x)));
  const ends = [...lines.values()].map((ws) => Math.max(...ws.map((h) => h.x + h.w)));
  const centres = starts.map((a, i) => (a + ends[i]) / 2);
  // A line whose first word wasn't heard right seems to start later, so most (not all) lines agree.
  const [ls, rs, cs] = [share(starts), share(ends), share(centres)];
  const align: "left" | "right" | "center" = ls >= 0.5 && ls >= rs && ls >= cs ? "left" : rs >= 0.5 && rs >= cs ? "right" : "center";
  const columnOf = (box: SceneLayer, path: SceneLayer[]) => {
    let ox = 0;
    for (const p of [...path, box]) {
      if (p === box) return { left: ox + channelAt("x", box.anim.x, 0), width: channelAt("w", box.anim.w, 0) };
      ox += channelAt("x", p.anim.x, 0);
    }
    return { left: 0, width: scene.width };
  };
  const [box0, hits0] = chosen.sort((a, b) => b[1].length - a[1].length)[0];
  const column = columnOf(box0, hits0[0].path.slice(0, hits0[0].path.indexOf(box0)));
  // Words in a full caption: most lines (a dimmed previous line or a short one says less).
  const counts = [...lines.values()].map((ws) => ws.reduce((n, h) => n + h.l.text!.split(/\s+/).length, 0)).sort((a, b) => a - b);
  // (Captions whose words leave one by one don't show this: then it's left to Creatron.)
  const perLine = counts[Math.floor(counts.length * 0.75)] >= 2 ? Math.min(8, counts[Math.floor(counts.length * 0.75)]) : undefined;
  const upper = keep.filter((h) => h.l.style["text-transform"] === "uppercase" || (h.l.text === h.l.text!.toUpperCase() && /[A-Z]/.test(h.l.text!))).length > keep.length / 2;
  return {
    ids: [...hide].map((l) => l.id),
    y: Math.max(-0.5, Math.min(0.5, ys[Math.floor(ys.length / 2)] / scene.height - 0.5)),
    font: [...fonts].sort((a, b) => b[1] - a[1])[0]?.[0],
    upper,
    accent: [...accents].sort((a, b) => b[1] - a[1])[0]?.[0],
    align,
    /** The column's middle as Creatron's caption x (a shift from the frame's middle) and its width as a share of the frame. */
    x: Math.max(-0.5, Math.min(0.5, (column.left + column.width / 2) / scene.width - 0.5)),
    width: Math.max(0.2, Math.min(1, column.width / scene.width)),
    wordsPerCaption: perLine,
  };
}

// ---------- the scene with the user's changes ----------

/** Every layer, depth first, with its depth. */
export function flatLayers(layers: SceneLayer[], depth = 0, out: { layer: SceneLayer; depth: number }[] = []) {
  for (const l of layers) {
    out.push({ layer: l, depth });
    flatLayers(l.children, depth + 1, out);
  }
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

/** The scene as it should play: each layer with the user's text, style and keyframes applied, hidden ones taken out. */
export function applyEdits(scene: Scene, edits: Record<string, LayerEdit> | undefined): Scene {
  if (!edits || !Object.keys(edits).length) return scene;
  const one = (l: SceneLayer): SceneLayer | null => {
    const e = edits[l.id];
    if (e?.hidden) return null;
    const children = l.children.map(one).filter((c): c is SceneLayer => c !== null);
    if (!e) return children.every((c, i) => c === l.children[i]) && children.length === l.children.length ? l : { ...l, children };
    const paint = l.paint && e.style ? { color: e.style.color ? undefined : l.paint.color, bg: e.style["background-color"] ? undefined : l.paint.bg } : l.paint;
    const styleAnim = l.styleAnim && e.style ? Object.fromEntries(Object.entries(l.styleAnim).filter(([k]) => !(k in e.style!))) : l.styleAnim;
    return {
      ...l,
      children,
      styleAnim,
      ...(e.text !== undefined ? { htmlAnim: undefined } : {}),
      style: e.style ? { ...l.style, ...e.style } : l.style,
      anim: e.anim ? { ...l.anim, ...(e.anim as SceneLayer["anim"]) } : l.anim,
      paint,
      ...(e.text !== undefined ? { text: e.text, html: escapeHtml(e.text) } : {}),
    };
  };
  return { ...scene, layers: scene.layers.map(one).filter((c): c is SceneLayer => c !== null) };
}

export function findLayer(layers: SceneLayer[], id: string): SceneLayer | undefined {
  for (const l of layers) {
    if (l.id === id) return l;
    const hit = findLayer(l.children, id);
    if (hit) return hit;
  }
}

/** Short line about a scene: how many layers and keyframes, like the import panel shows. */
export function sceneStats(scene: Scene) {
  const all = flatLayers(scene.layers);
  const keys = all.reduce((n, { layer }) => n + Object.values(layer.anim).reduce<number>((k, c) => k + keyCount(c), 0), 0);
  return { layers: all.length, keyframes: keys, groups: all.filter((x) => x.layer.children.length).length };
}

// ---------- from a page recording to keyframes ----------

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

// rel: for styles, how close (as a share of how far each number moves) the keys must stay.
const TOLERANCE: Record<Detail, { px: number; scale: number; deg: number; opacity: number; blur: number; color: number; rel: number }> = {
  light: { px: 2, scale: 0.012, deg: 0.6, opacity: 0.025, blur: 0.6, color: 8, rel: 0.03 },
  balanced: { px: 0.5, scale: 0.003, deg: 0.15, opacity: 0.006, blur: 0.2, color: 3, rel: 0.008 },
  exact: { px: 0.001, scale: 0.00001, deg: 0.001, opacity: 0.00001, blur: 0.001, color: 0.01, rel: 0.0001 },
};

/** Text whose words change this many times or fewer becomes one layer per wording (each caption its own layer). */
const SPLIT_TEXT = 40;

/**
 * The fewest keyframes whose straight lines stay within `tol` of every sample (Ramer–Douglas–
 * Peucker on time). A channel that never moves more than tol becomes a constant.
 */
export function reduce(times: number[], values: number[][], tol: number): number[] {
  const n = times.length;
  const err = (i: number, a: number, b: number) => {
    const k = (times[i] - times[a]) / (times[b] - times[a] || 1);
    let e = 0;
    for (let j = 0; j < values[i].length; j++) e = Math.max(e, Math.abs(values[a][j] + (values[b][j] - values[a][j]) * k - values[i][j]));
    return e;
  };
  const keep = new Set([0, n - 1]);
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const e = err(i, a, b);
      if (e > worst) (worst = e), (at = i);
    }
    if (worst > tol) {
      keep.add(at);
      stack.push([a, at], [at, b]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}

function toChannel(times: number[], vals: number[], tol: number, digits: number): Channel {
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (max - min <= tol) return round(vals[0], digits);
  // A held value that jumps (between two frames) keeps its jump: a key just before each step.
  const keys = reduce(times, vals.map((v) => [v]), tol);
  return keys.map((i) => [round(times[i], 3), round(vals[i], digits)] as [number, number]);
}

/** On/off: a key wherever it switches. */
function toStep(times: number[], vals: number[]): Channel {
  if (vals.every((v) => v === vals[0])) return vals[0];
  const keys: [number, number][] = [[round(times[0], 3), vals[0]]];
  for (let i = 1; i < vals.length; i++) if (vals[i] !== vals[i - 1]) keys.push([round(times[i], 3), vals[i]]);
  return keys;
}

function toColor(times: number[], vals: string[], tol: number): ColorChannel | undefined {
  if (vals.every((v) => v === vals[0])) return undefined;
  const nums = vals.map(rgba).map((v) => [v[0], v[1], v[2], v[3] * 255]);
  return reduce(times, nums, tol).map((i) => [round(times[i], 3), vals[i]] as [number, string]);
}

const VISUAL = ["background-color", "background-image", "box-shadow", "clip-path", "filter", "backdrop-filter", "mix-blend-mode", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width"];

/**
 * Keyframes from a page recording. `asset` maps each file URL the page used to its name in the
 * scene's folder (images, videos, fonts). Wrappers that neither show nor move anything are
 * folded into their children, and layers that never show are left out.
 */
export function toScene(cap: PageCapture, opts: { name: string; source: string; detail: Detail; asset: (url: string) => string | undefined }): Scene {
  const tol = TOLERANCE[opts.detail];
  const times = cap.frames.map((_, f) => Math.min(cap.duration, f / cap.fps));
  const col = (i: number, k: number) => cap.frames.map((row) => row[i][k]);
  // Turns kept continuous (no jump from 179° to -179°).
  const unwrap = (v: number[]) => {
    const out = [...v];
    for (let j = 1; j < out.length; j++) {
      while (out[j] - out[j - 1] > 180) out[j] -= 360;
      while (out[j] - out[j - 1] < -180) out[j] += 360;
    }
    return out;
  };

  const N = cap.frames.length;
  /** Per frame, the style's value (held from its last change; before the first, its first). */
  const expand = (runs: [number, string][]) => {
    const out: string[] = new Array(N);
    let k = 0;
    for (let f = 0; f < N; f++) {
      while (k + 1 < runs.length && runs[k + 1][0] <= f) k++;
      out[f] = runs[k][1];
    }
    return out;
  };
  /** Outside `mask` a value is whatever it was at the nearest frame inside it (so only those frames shape the keys). */
  const within = <T,>(vals: T[], mask?: boolean[]) => {
    if (!mask) return vals;
    const first = mask.indexOf(true);
    const out = [...vals];
    let last = vals[first];
    for (let f = 0; f < N; f++) out[f] = f < first ? vals[first] : mask[f] ? (last = vals[f]) : last;
    return out;
  };

  /** One layer from a recorded element; with `run`, just its frames showing one wording. */
  const build = (L: PageCapture["layers"][number], i: number, run?: { id: string; html: string; text: string; mask: boolean[]; style?: Record<string, string> }): SceneLayer | null => {
    const mask = run?.mask;
    const show = col(i, 10).map((v, f) => (mask && !mask[f] ? 0 : v));
    if (!cap.frames.some((row, f) => row[i][13] > 0.001 && (!mask || mask[f]))) return null;
    const ch = (k: number) => within(col(i, k), mask);
    const anim: SceneLayer["anim"] = {
      x: toChannel(times, ch(0), tol.px, 2),
      y: toChannel(times, ch(1), tol.px, 2),
      w: toChannel(times, ch(2), tol.px, 2),
      h: toChannel(times, ch(3), tol.px, 2),
      tx: toChannel(times, ch(4), tol.px, 2),
      ty: toChannel(times, ch(5), tol.px, 2),
      sx: toChannel(times, ch(6), tol.scale, 4),
      sy: toChannel(times, ch(7), tol.scale, 4),
      rot: toChannel(times, unwrap(ch(8)), tol.deg, 3),
      opacity: toChannel(times, ch(9), tol.opacity, 4),
      show: toStep(times, show),
      blur: toChannel(times, ch(11), tol.blur, 2),
    };
    for (const k of CHANNELS) if (anim[k] === CHANNEL_DEFAULT[k] && k !== "w" && k !== "h" && k !== "x" && k !== "y") delete anim[k];
    const style = { ...(run?.style ?? L.style) };
    // Styles that change over time get keys; one that's steady (while this layer shows) is just its style.
    const styleAnim: Record<string, [number, string][]> = {};
    for (const [p, runs] of Object.entries(cap.styles?.[i] ?? {})) {
      const track = styleTrack(times, within(expand(runs), mask), tol.rel);
      if (typeof track === "string") {
        if (track === "none" || track === "rgba(0, 0, 0, 0)" || track === "0px") delete style[p];
        else style[p] = track;
      } else styleAnim[p] = track;
    }
    // Scenes recorded before styles were tracked: colours only.
    const paint: NonNullable<SceneLayer["paint"]> = {};
    if (cap.colors) {
      const color = toColor(times, cap.colors.map((r) => r[i][0]), tol.color);
      const bg = toColor(times, cap.colors.map((r) => r[i][1]), tol.color);
      if (color && L.kind === "text") (paint.color = color), delete style.color;
      if (bg) (paint.bg = bg), delete style["background-color"];
    }
    // Files the page loaded: background pictures and fonts point at the scene's own copies.
    const local = (css: string) => css.replace(/url\("?([^")]+)"?\)/g, (m, u) => (opts.asset(u) ? `url("${opts.asset(u)}")` : m));
    if (style["background-image"]) style["background-image"] = local(style["background-image"]);
    if (styleAnim["background-image"]) styleAnim["background-image"] = styleAnim["background-image"].map(([t, v]) => [t, local(v)]);
    // Words that keep changing (a counter) stay one layer whose words step along.
    const htmlRuns = !run && cap.html?.[i];
    const htmlAnim = htmlRuns ? htmlRuns.map(([f, h]) => [round(times[f], 3), h] as [number, string]) : undefined;
    const svgRuns = L.kind === "svg" && cap.svg?.[i];
    const svgTrack = svgRuns ? styleTrack(times, within(expand(svgRuns), mask), tol.rel) : undefined;
    const media = L.kind === "video" ? mediaTiming(cap, i) : undefined;
    const moves = ["tx", "ty", "sx", "sy", "rot"].some((k) => k in anim) || typeof anim.opacity !== "number" || (anim.opacity ?? 1) < 1;
    return {
      id: run?.id ?? L.id,
      name: run ? run.text.slice(0, 32) || L.name : L.name,
      kind: L.kind,
      style,
      origin: [round(L.origin[0], 2), round(L.origin[1], 2)],
      anim,
      ...(Object.keys(styleAnim).length ? { styleAnim } : {}),
      ...(paint.color || paint.bg ? { paint } : {}),
      ...(run ? { html: run.html, text: run.text } : L.html !== undefined ? { html: L.html, text: L.text } : {}),
      ...(htmlAnim ? { htmlAnim } : {}),
      ...(L.src ? { src: opts.asset(L.src) ?? L.src } : {}),
      ...(typeof svgTrack === "string" ? { svg: svgTrack } : L.svg ? { svg: L.svg } : {}),
      ...(Array.isArray(svgTrack) ? { svgAnim: svgTrack } : {}),
      ...(media ? { media } : {}),
      ...(L.positioned || moves ? { front: true } : {}),
      ...(L.fit ? { fit: true } : {}),
      children: [],
    };
  };

  // Text that changes wording a few times (captions reusing their slots) becomes a layer per wording.
  const built: SceneLayer[][] = cap.layers.map((L, i) => {
    const runs = cap.html?.[i];
    if (L.kind !== "text" || !runs || runs.length > SPLIT_TEXT) {
      const one = build(L, i);
      return one ? [one] : [];
    }
    return runs.flatMap(([from, html, text, style], k) => {
      const to = k + 1 < runs.length ? runs[k + 1][0] : N;
      const mask = Array.from({ length: N }, (_, f) => f >= from && f < to);
      const one = build(L, i, { id: `${L.id}.${k}`, html, text, mask, style });
      return one ? [one] : [];
    });
  });
  // Children under their parents; a layer whose parent was left out goes to the nearest kept one.
  const top: SceneLayer[] = [];
  // Siblings in page order (the order they paint in), whenever each first appeared.
  const rank = new Map<SceneLayer, number>();
  cap.layers.forEach((L, i) => built[i].forEach((l) => rank.set(l, L.rank ?? i)));
  cap.layers.forEach((L, i) => {
    if (!built[i].length) return;
    let p = L.parent;
    while (p >= 0 && !built[p].length) p = cap.layers[p].parent;
    (p >= 0 ? built[p][0].children : top).push(...built[i]);
  });
  const sortTree = (list: SceneLayer[]) => {
    list.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    for (const l of list) sortTree(l.children);
  };
  sortTree(top);

  const plain = (l: SceneLayer) =>
    l.kind === "group" && l.children.length > 0 && !l.paint && !l.styleAnim && !VISUAL.some((k) => l.style[k] && l.style[k] !== "0px") &&
    !["overflow", "z-index"].some((k) => l.style[k] && l.style[k] !== "visible" && l.style[k] !== "auto") &&
    Object.keys(l.anim).every((k) => ["x", "y", "w", "h"].includes(k)) && CHANNELS.slice(0, 2).every((k) => typeof l.anim[k] === "number");
  const fold = (list: SceneLayer[], isTop: boolean): SceneLayer[] =>
    list.flatMap((l) => {
      l.children = fold(l.children, false);
      if (isTop || !plain(l)) return [l];
      const dx = l.anim.x as number;
      const dy = l.anim.y as number;
      return l.children.map((c) => ({ ...c, anim: { ...c.anim, x: shift(c.anim.x, dx), y: shift(c.anim.y, dy) } }));
    });
  const keep = (l: SceneLayer): boolean => l.kind !== "group" || l.children.length > 0 || VISUAL.some((k) => l.style[k] && l.style[k] !== "0px") || !!l.paint || !!l.styleAnim;
  const prune = (list: SceneLayer[]): SceneLayer[] => list.map((l) => ({ ...l, children: prune(l.children) })).filter(keep);

  return {
    version: 1,
    name: opts.name,
    source: opts.source,
    width: cap.width,
    height: cap.height,
    duration: round(cap.duration, 3),
    fps: cap.fps,
    detail: opts.detail,
    fonts: cap.fonts.map((f) => f.replace(/url\("([^"]+)"\)/g, (m, u) => (opts.asset(u) ? `url("${opts.asset(u)}")` : m))),
    layers: prune(fold(top, true)),
    audio: [],
  };
}

const shift = (c: Channel | undefined, d: number): Channel =>
  c === undefined ? d : typeof c === "number" ? round(c + d, 2) : c.map(([t, v]) => [t, round(v + d, 2)] as [number, number]);

/** When a video shows and where in its file: from the first frame it's shown. */
function mediaTiming(cap: PageCapture, i: number): SceneLayer["media"] {
  const shown = cap.frames.findIndex((row) => row[i][10] > 0);
  if (shown < 0) return undefined;
  const t0 = shown / cap.fps;
  const m0 = cap.frames[shown][i][12];
  const next = cap.frames[Math.min(cap.frames.length - 1, shown + Math.round(cap.fps))]?.[i][12] ?? m0;
  const rate = next > m0 ? (next - m0) / (Math.min(cap.frames.length - 1, shown + Math.round(cap.fps)) / cap.fps - t0) : 1;
  return { start: round(t0, 3), offset: round(m0, 3), rate: Math.abs(rate - 1) < 0.03 ? 1 : round(rate, 3) };
}
