// An imported Claude edit as clips, the way an editor shows a timeline: every shot, title, counter
// and graphic in it is one clip with a name, a span and a few keyframes, instead of a thousand
// page layers. Clips are a view onto the scene's layers: moving, trimming, deleting or animating
// one writes a clip edit ("clip:<id>" in the scene clip's layers: members, shift, window, hidden,
// keys), so the scene file never changes and the scene's own renderer draws it exactly as before.
// Pure functions, shared by the timeline, the panels and the AI.
import { EASES, type Ease, type Key, type Keys, eased } from "./keyframes.ts";
import {
  CLIP_PROPS, type Channel, type ClipProp, type LayerEdit, type Scene, type SceneLayer, applyEdits, channelAt, fromChannelValue, stepAt,
} from "./scene.ts";

/**
 * What a clip is, as a layer: a shot's footage (the card), the blurred copy filling the frame behind
 * it, an effect drawn over it (shade, flash, blinds), a title, a graphic, the background.
 */
export type SceneClipKind = "shot" | "fill" | "effect" | "text" | "graphic" | "background";

export type SceneClip = {
  /** Stable id: its first layer's. Its edits are stored as "clip:<id>". */
  id: string;
  kind: SceneClipKind;
  name: string;
  /** The layers it's made of (a counter's steps, a title and its glow). Edits apply to each. */
  members: string[];
  /** Where it shows, scene seconds, with the user's moves and trims. */
  start: number;
  end: number;
  /** How far it can be trimmed: where its content is, scene seconds, moved with it. */
  min: number;
  max: number;
  /** Scene second (before any move) where its keyframes' t = 0: its content's start. */
  keyStart: number;
  /** How far it was moved, its own move and its shot's, seconds. */
  shift: number;
  /** The layer whose recorded movement its keyframes show. */
  target: string;
  /** Which of x, y, scale, rotate, opacity it can animate. */
  props: ClipProp[];
  /** What deleting it hides: a shot's pictures (its titles stay), otherwise the clip itself. */
  parts: string[];
  /** Paint order: higher is drawn over lower. */
  z: number;
  /** A layer of a shot (its footage, blur fill, effects, titles): the shot group's id. */
  parent?: string;
  /**
   * The shot group it belongs to: its layers move and trim together (a shot's footage, fill and
   * effects; its titles can be moved within it). start/end where it shows, min/max its content,
   * shift how far it was moved; all scene seconds.
   */
  group?: { id: string; start: number; end: number; min: number; max: number; shift: number };
  /** A shot's footage, for its filmstrip: file (relative to the scene), where it starts in the file and in the scene, its rate. */
  media?: { src: string; offset: number; start: number; rate: number };
  /** Kept for older callers: effects are layers of their own now. */
  effects: string[];
  /** Text layers whose words can be retyped (a counter's or a typewriter's steps can't). */
  texts: { id: string; text: string }[];
  /** Every text layer in it (its font changes on all of them). */
  textLayers: string[];
  /** The text layers its colour is (not a glow or shadow copy's): a counter's every step, a title's own words. */
  colorLayers: string[];
  /** Its video layers (swapping the footage swaps all of them: the card and its blurred copy). */
  videos: string[];
  /** A text clip's colour, as CSS. */
  color?: string;
  /** Words that change as it plays: a counter, typing. */
  steps?: boolean;
  locked?: boolean;
};

/** The edit key a clip's changes are stored under. */
export const clipKey = (id: string) => `clip:${id}`;

const FPS_SAMPLE = 30;

/** Where a show channel is on, as one span (first on to last off), or undefined if never. */
function onSpan(show: Channel | undefined, duration: number): [number, number] | undefined {
  if (show === undefined) return [0, duration];
  if (typeof show === "number") return show ? [0, duration] : undefined;
  let from: number | undefined;
  let to = duration;
  for (let i = 0; i < show.length; i++) {
    const [t, v] = show[i];
    if (v && from === undefined) from = i === 0 ? 0 : t;
    if (!v && from !== undefined) to = t;
  }
  if (from === undefined) return undefined;
  if (show[show.length - 1][1]) to = duration;
  return [Math.max(0, from), Math.min(duration, to)];
}
const union = (spans: ([number, number] | undefined)[]) => {
  const s = spans.filter((x): x is [number, number] => Boolean(x));
  return s.length ? ([Math.min(...s.map((x) => x[0])), Math.max(...s.map((x) => x[1]))] as [number, number]) : undefined;
};

/** Unpositioned layers first, then the ones a page paints on top of them (as the renderer draws). */
const order = (list: SceneLayer[]) => [...list.filter((l) => !l.front), ...list.filter((l) => l.front)];

const clear = (c: string | undefined) => !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c.replace(/\s+/g, " "));
/** Draws something itself (not only through its children). */
const paints = (l: SceneLayer) =>
  l.kind !== "group" || !clear(l.style["background-color"]) || Boolean(l.paint?.bg) ||
  Boolean(l.style["background-image"] && l.style["background-image"] !== "none") ||
  Boolean(l.style["border-top-width"] && parseFloat(l.style["border-top-width"]) > 0 && !clear(l.style["border-top-color"])) ||
  Boolean(l.style["box-shadow"] && l.style["box-shadow"] !== "none");
const hasVideo = (l: SceneLayer): boolean => l.kind === "video" || l.children.some(hasVideo);
const shows = (l: SceneLayer): boolean => paints(l) || l.children.some(shows);
const all = (l: SceneLayer): SceneLayer[] => [l, ...l.children.flatMap(all)];
const isText = (l: SceneLayer) => l.kind === "text" && Boolean(l.text?.trim());

/** Typed-out text's cursor and marker, and a number run into its unit ("70years"). */
const tidy = (s: string) => s.replace(/[▸▍▌▎▏_]+/g, " ").replace(/(\d)([A-Za-z])/g, "$1 $2").replace(/\s+/g, " ").trim();
const fileName = (p: string) => p.split("/").pop()!.replace(/\.[a-z0-9]+$/i, "");

const ANIMATED = (c: Channel | undefined) => Array.isArray(c) && c.length > 1 && c.some(([, v]) => v !== c[0][1]);
const same = (a: Channel | undefined, b: Channel | undefined) => JSON.stringify(a ?? 1) === JSON.stringify(b ?? 1);
const CH: Record<ClipProp, "tx" | "ty" | "sx" | "rot" | "opacity"> = { x: "tx", y: "ty", scale: "sx", rotate: "rot", opacity: "opacity" };

/**
 * The layer whose movement is the clip's: the clip, or the first wrapper inside it (one child at a
 * time, same box) that moves. Anything deeper (a slow push-in inside a card) is the clip's built-in animation.
 */
function keyTarget(root: SceneLayer): SceneLayer {
  const box = (l: SceneLayer) => ["x", "y", "w", "h"].map((k) => JSON.stringify(l.anim[k as "x"])).join("|");
  const moves = (l: SceneLayer) => ["tx", "ty", "sx", "sy", "rot", "opacity"].some((k) => ANIMATED(l.anim[k as "tx"]));
  let l = root;
  for (let i = 0; i < 6 && !moves(l); i++) {
    if (l.children.length !== 1 || box(l.children[0]) !== box(root) || paints(l)) break;
    l = l.children[0];
  }
  return moves(l) ? l : root;
}

/** The words of some layers as they read at `t` (top to bottom, left to right). */
function wordsAt(roots: SceneLayer[], t: number): string {
  const out: { y: number; x: number; s: string }[] = [];
  const walk = (l: SceneLayer, ox: number, oy: number) => {
    if (!stepAt(l.anim.show, t, 1)) return;
    const x = ox + channelAt("x", l.anim.x, t) + channelAt("tx", l.anim.tx, t);
    const y = oy + channelAt("y", l.anim.y, t) + channelAt("ty", l.anim.ty, t);
    if (isText(l)) out.push({ x, y, s: l.text! });
    for (const c of l.children) walk(c, x, y);
  };
  for (const r of roots) walk(r, 0, 0);
  out.sort((a, b) => (Math.abs(a.y - b.y) > 12 ? a.y - b.y : a.x - b.x));
  // A glow copy repeats the same words: once.
  const seen = new Set<string>();
  return tidy(out.filter((w) => !seen.has(w.s) && seen.add(w.s)).map((w) => w.s).join(" "));
}

/** A text layer's colour as shown: the user's, its own, or (when it animates) where it ends. */
function colorOf(l: SceneLayer, edits: Record<string, LayerEdit> | undefined): string | undefined {
  const c = l.paint?.color;
  return edits?.[l.id]?.style?.color ?? (Array.isArray(c) ? c[c.length - 1][1] : c) ?? l.style.color;
}

/** What a full-frame graphic inside a shot is, for its badge: shading, a flash, a blinds wipe. */
function effectOf(l: SceneLayer): string | undefined {
  const bg = l.style["background-color"] ?? "";
  if (l.children.length >= 6 && l.children.every((c) => !clear(c.style["background-color"]))) return "Blinds";
  if (/255,\s*255,\s*255/.test(bg) && ANIMATED(l.anim.opacity)) return "Flash";
  if (/gradient/.test(l.style["background-image"] ?? "")) return "Shade";
  return undefined;
}

/**
 * The clips of a scene with the user's edits (`edits`: the scene clip's layers). In paint order;
 * deleted ones are left out.
 */
export function sceneClips(scene: Scene, edits: Record<string, LayerEdit> | undefined): SceneClip[] {
  const D = scene.duration;
  const W = scene.width, H = scene.height;
  // Structure and names from the scene as made (ids and names never change as you edit); timing
  // from the scene as edited, with deleted clips kept in it so their layers can still be read.
  const kept = Object.fromEntries(Object.entries(edits ?? {}).map(([k, e]) => [k, e.hidden ? { ...e, hidden: undefined } : e]));
  const edited = new Map(applyEdits(scene, kept).layers.flatMap(all).map((l) => [l.id, l]));
  const hidden = new Set(Object.entries(edits ?? {}).filter(([, e]) => e.hidden).map(([k]) => k));
  const zOf = new Map<string, number>();
  let z = 0;
  const number = (list: SceneLayer[]) => order(list).forEach((l) => (zOf.set(l.id, z++), number(l.children)));
  number(scene.layers);
  const clips: SceneClip[] = [];
  const area = (l: SceneLayer, t: number) => channelAt("w", l.anim.w, t) * channelAt("h", l.anim.h, t);
  const fullFrame = (l: SceneLayer) => {
    const t = onSpan(l.anim.show, D)?.[0] ?? 0;
    return area(l, t) >= W * H * 0.6;
  };

  // Whether a layer shows at t: it and everything holding it switched on.
  const parentOf = new Map<string, SceneLayer>();
  const link = (l: SceneLayer) => l.children.forEach((c) => (parentOf.set(c.id, l), link(c)));
  scene.layers.forEach(link);
  const visibleAt = (l: SceneLayer, t: number): boolean => {
    for (let n: SceneLayer | undefined = l; n; n = parentOf.get(n.id)) if (!stepAt(n.anim.show, t, 1)) return false;
    return true;
  };

  const add = (members: SceneLayer[], kind: SceneClipKind, parent?: string, inheritedShift = 0, effects: string[] = [], fxName?: string) => {
    const id = members[0].id;
    if (hidden.has(clipKey(id))) return;
    const e = edits?.[clipKey(id)];
    const span = union(members.map((m) => onSpan(edited.get(m.id)?.anim.show, D)));
    const content = union(members.map((m) => onSpan(m.anim.show, D)));
    if (!span || !content) return;
    const shift = inheritedShift + (e?.shift ?? 0);
    // The member whose movement the clip's keyframes show: a title's, not its glow's; a counter's last step.
    const primary = members.length === 1 ? members[0]
      : [...members].sort((a, b) => (a.style.filter?.includes("blur") ? 1 : 0) - (b.style.filter?.includes("blur") ? 1 : 0)
        || channelAt("opacity", b.anim.opacity, content[1] - 0.05) - channelAt("opacity", a.anim.opacity, content[1] - 0.05)
        || (onSpan(b.anim.show, D)?.[1] ?? 0) - (onSpan(a.anim.show, D)?.[1] ?? 0))[0];
    const target = keyTarget(primary);
    const subtree = members.flatMap(all);
    const video = subtree.find((x) => x.kind === "video" && x.src && !x.style.filter?.includes("blur")) ?? subtree.find((x) => x.kind === "video" && x.src);
    const parts: string[] = [];
    const textLayers = subtree.filter(isText);
    // Words that change as it plays (a counter, typing): its wordings replace each other over time,
    // never all on screen at once (a title made of several words shows them together).
    const distinct = new Set(textLayers.map((x) => x.text)).size;
    let together = 0;
    for (let t = content[0]; t < content[1]; t += 0.1) together = Math.max(together, new Set(textLayers.filter((x) => visibleAt(x, t)).map((x) => x.text)).size);
    const steps = members.length > 2 || (distinct > 3 && together < distinct);
    const ownStart = (span[1] - 1 / FPS_SAMPLE);
    const roots = members.map((m) => edited.get(m.id)).filter((x): x is SceneLayer => Boolean(x));
    let name =
      (kind === "shot" || kind === "fill") && video?.src ? `${fileName(video.src)}${kind === "fill" ? " · blur" : ""}`
        : kind === "effect" ? fxName ?? "Effect"
        : kind === "background" ? "Background"
        : kind === "text" ? wordsAt(roots, ownStart) || wordsAt(members, (content[0] + content[1]) / 2) || "Text"
        : subtree.some((x) => x.kind === "svg") ? (fullFrame(members[0]) && faint(members[0], content[0]) ? "Texture" : "Drawing")
        : subtree.some((x) => x.kind === "image") ? fileName(subtree.find((x) => x.kind === "image")!.src ?? "Picture") : "Shape";
    // Captions burned into the edit: many words over most of it.
    if (kind === "text" && textLayers.length > 30 && content[1] - content[0] > D * 0.4) name = "Captions";
    const scale = same(target.anim.sx, target.anim.sy);
    clips.push({
      id, kind, name: name.length > 70 ? `${name.slice(0, 67)}…` : name, members: members.map((m) => m.id),
      start: span[0], end: span[1], min: Math.max(0, content[0] + shift), max: Math.min(D, content[1] + shift),
      keyStart: content[0], shift, target: target.id, props: CLIP_PROPS.filter((p) => p !== "scale" || scale),
      parts, z: zOf.get(id) ?? 0, parent,
      ...(video?.src && video.media ? { media: { src: video.src, offset: video.media.offset, start: video.media.start + shift, rate: video.media.rate } } : {}),
      effects,
      texts: steps || kind !== "text" ? [] : uniqueTexts(textLayers).slice(0, 6).map((x) => ({ id: x.id, text: edits?.[x.id]?.text ?? x.text! })),
      textLayers: kind === "text" ? textLayers.map((x) => x.id) : [],
      colorLayers: kind !== "text" ? [] : steps ? textLayers.map((x) => x.id) : all(primary).filter(isText).map((x) => x.id),
      videos: kind === "shot" || kind === "fill" ? (parent ? groupVideos.get(parent) ?? [] : subtree.filter((x) => x.kind === "video").map((x) => x.id)) : [],
      ...(kind === "text" && textLayers[0] ? { color: colorOf(steps ? textLayers[0] : (all(primary).find(isText) ?? textLayers[0]), edits) } : {}),
      ...(steps && kind === "text" ? { steps: true } : {}),
      ...(kind === "background" ? { locked: true } : {}),
    });
  };

  /** Drawn faintly over everything (film grain, a texture): every layer down to its drawing is see-through. */
  const faint = (l: SceneLayer, t: number): boolean => {
    let o = channelAt("opacity", l.anim.opacity, t);
    let n = l;
    while (n.children.length && o >= 0.5) {
      n = n.children.find((c) => all(c).some((x) => x.kind === "svg")) ?? n.children[0];
      o *= channelAt("opacity", n.anim.opacity, t);
    }
    return o < 0.5;
  };
  /** One layer per wording (a glow copy says the same). */
  const uniqueTexts = (list: SceneLayer[]) => list.filter((x, i) => list.findIndex((y) => y.text === x.text) === i);

  /**
   * Siblings that are one thing on screen become one clip: the steps of a counter (the import
   * splits each wording into its own layer, "L607.0", "L607.1"…) and a title drawn twice (its glow).
   */
  const units = (list: SceneLayer[]): SceneLayer[][] => {
    const out: SceneLayer[][] = [];
    const words = (l: SceneLayer) => tidy(all(l).filter(isText).map((x) => x.text).join(" "));
    for (const l of list) {
      const stem = /^(.+)\.\d+$/.exec(l.id)?.[1];
      const prev = out[out.length - 1];
      const prevStem = prev && /^(.+)\.\d+$/.exec(prev[0].id)?.[1];
      if (stem && prevStem === stem) { prev.push(l); continue; }
      // A twin says the same words over (nearly) the same time: a title and its glow or shadow.
      const span = onSpan(l.anim.show, D);
      const overlap = (a?: [number, number], b?: [number, number]) => (a && b ? Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) / Math.max(1e-3, Math.max(a[1], b[1]) - Math.min(a[0], b[0])) : 0);
      const twin = out.find((u) => {
        const w = words(u[0]);
        return w && (w === words(l) || wordsAt([u[0]], (span?.[1] ?? 0) - 0.05) === wordsAt([l], (span?.[1] ?? 0) - 0.05)) && overlap(onSpan(u[0].anim.show, D), span) > 0.8;
      });
      if (twin) { twin.push(l); continue; }
      out.push([l]);
    }
    return out;
  };

  // Each shot's video layers (a swap of its footage changes all of them: the card and its blur).
  const groupVideos = new Map<string, string[]>();
  /** A video layer drawn blurred: the copy that fills the frame behind the card. */
  const blurred = (l: SceneLayer) => all(l).some((x) => x.kind === "video" && (x.style.filter?.includes("blur") || channelAt("blur", x.anim.blur, 0) > 4));

  // Inside a shot, each layer is a clip, in the order they're drawn: its footage (the card), the
  // blurred copy behind it, the effects over it (shade, flash, blinds), its titles and graphics.
  const inside = (n: SceneLayer, shot: string, shift: number) => {
    const dt = shift + (edits?.[n.id]?.shift ?? 0);
    for (const u of units(order(n.children).filter((c) => !hidden.has(c.id) && shows(c)))) {
      const subtree = u.flatMap(all);
      if (u.some(hasVideo)) {
        // A branch holding a video and titles is a container: look inside it. Otherwise it's a picture layer.
        // (A wrapper around both the card and its blurred copy is a container too.)
        if (subtree.some((x) => isText(x) || x.kind === "svg") || subtree.filter((x) => x.kind === "video").length > 1 || subtree.some((x) => x !== u[0] && x.kind === "group" && fullFrame(x) && !hasVideo(x) && paints(x)))
          for (const c of u) inside(c, shot, dt);
        else add(u, blurred(u[0]) ? "fill" : "shot", shot, dt);
      } else if (subtree.some(isText)) add(u, "text", shot, dt);
      else if (fullFrame(u[0]) && !subtree.some((x) => x.kind === "svg" || x.kind === "image")) add(u, "effect", shot, dt, [], effectOf(u[0]) ?? "Shade");
      else add(u, "graphic", shot, dt);
    }
  };

  const walk = (list: SceneLayer[], shift: number) => {
    const visible = order(list).filter((l) => !hidden.has(l.id) && shows(l) && onSpan(l.anim.show, D));
    for (const u of units(visible)) {
      const l = u[0];
      const span = onSpan(l.anim.show, D)!;
      // On for the whole edit with things inside: a container. What it paints itself is the background.
      if (u.length === 1 && span[0] < 0.05 && span[1] > D - 0.05 && l.children.length) {
        if (paints(l)) add([l], "background", undefined, shift);
        walk(l.children, shift + (edits?.[l.id]?.shift ?? 0));
        continue;
      }
      if (hasVideo(l)) {
        // A shot: a group of layers. Its own move and trim (clip:<id>) move and trim all of them.
        if (hidden.has(clipKey(l.id))) continue;
        const ge = edits?.[clipKey(l.id)];
        const gShift = shift + (ge?.shift ?? 0);
        const gSpan = onSpan(edited.get(l.id)?.anim.show, D) ?? span;
        const group = { id: l.id, start: gSpan[0], end: gSpan[1], min: Math.max(0, span[0] + gShift), max: Math.min(D, span[1] + gShift), shift: gShift };
        groupVideos.set(l.id, all(l).filter((x) => x.kind === "video").map((x) => x.id));
        const before = clips.length;
        inside(l, l.id, gShift);
        for (const c of clips.slice(before)) c.group = group;
        // Nothing of it was recognised as a layer: the whole shot is one clip.
        if (clips.length === before) add(u, "shot", undefined, shift);
      } else add(u, u.flatMap(all).some(isText) ? "text" : "graphic", undefined, shift);
    }
  };
  walk(scene.layers, 0);
  return clips;
}

// ---------- keyframes from the recorded movement ----------

const TOL: Record<ClipProp, number> = { x: 0.0015, y: 0.0015, scale: 0.004, rotate: 0.3, opacity: 0.01 };

/**
 * The fewest eased keyframes that follow a recorded curve within `tol`: each piece gets the easing
 * that fits it best, and is split where it's furthest off until every piece fits.
 */
export function fitKeys(times: number[], values: number[], tol: number): Key[] {
  const n = times.length;
  if (!n) return [];
  const r = (v: number) => Math.round(v * 10000) / 10000;
  if (Math.max(...values) - Math.min(...values) <= tol) return [{ t: r(times[0]), v: r(values[0]) }];
  const fit = (a: number, b: number): { ease: Ease; err: number; at: number } => {
    let best = { ease: "linear" as Ease, err: Infinity, at: -1 };
    for (const ease of EASES) {
      let err = 0;
      let at = -1;
      for (let i = a + 1; i < b; i++) {
        const u = (times[i] - times[a]) / (times[b] - times[a] || 1);
        const e = Math.abs(values[a] + (values[b] - values[a]) * eased(ease, u) - values[i]);
        if (e > err) (err = e), (at = i);
      }
      if (err < best.err - 1e-9) best = { ease, err, at };
    }
    return best;
  };
  const keep = new Map<number, Ease>();
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const f = fit(a, b);
    if (f.err > tol && f.at > a && f.at < b) stack.push([a, f.at], [f.at, b]);
    else keep.set(a, f.ease);
  }
  const idx = [...new Set([...keep.keys(), n - 1])].sort((x, y) => x - y);
  // A last key that only holds the value (nothing moves after the one before) isn't needed.
  const keys = idx.map((i) => ({ t: r(times[i]), v: r(values[i]), ...(keep.get(i) && keep.get(i) !== "linear" ? { ease: keep.get(i) } : {}) }));
  while (keys.length > 2 && Math.abs(keys[keys.length - 1].v - keys[keys.length - 2].v) <= tol) keys.pop();
  return keys;
}

/** The keyframes a clip's recorded movement comes down to (t from its keyStart). Only properties that move. */
export function recordedKeys(scene: Scene, clip: SceneClip): Keys {
  const target = findIn(scene.layers, clip.target);
  if (!target) return {};
  const from = clip.keyStart;
  const to = clip.max - clip.shift;
  const times: number[] = [];
  for (let t = from; t <= to + 1e-6; t += 1 / FPS_SAMPLE) times.push(t);
  const out: Keys = {};
  for (const p of clip.props) {
    if (!ANIMATED(target.anim[CH[p]])) continue;
    const keys = fitKeys(times.map((t) => t - from), times.map((t) => fromChannelValue(p, channelAt(CH[p], target.anim[CH[p]], t), scene)), TOL[p]);
    if (keys.length > 1) out[p] = keys;
  }
  return out;
}

/** A clip's keyframes: the user's (once changed), else the recorded movement's. */
export function clipKeys(scene: Scene, clip: SceneClip, edits: Record<string, LayerEdit> | undefined): Keys {
  return edits?.[clipKey(clip.id)]?.keys ?? recordedKeys(scene, clip);
}

/** A property's value without keyframes, as recorded at the clip's start. */
export function recordedStill(scene: Scene, clip: SceneClip, p: ClipProp): number {
  const target = findIn(scene.layers, clip.target);
  return target ? fromChannelValue(p, channelAt(CH[p], target.anim[CH[p]], clip.keyStart), scene) : p === "scale" || p === "opacity" ? 1 : 0;
}

/** A property's value without keyframes: the user's, or as recorded. */
export function clipStill(scene: Scene, clip: SceneClip, edits: Record<string, LayerEdit> | undefined, p: ClipProp): number {
  return edits?.[clipKey(clip.id)]?.still?.[p] ?? recordedStill(scene, clip, p);
}

/**
 * The clip edit for new keyframes or plain values: what's recorded is stored alongside the first
 * time (so only the difference changes the picture, and later imports read it the same way).
 */
export function withClipKeys(scene: Scene, clip: SceneClip, edits: Record<string, LayerEdit> | undefined, change: { keys?: Keys; still?: Partial<Record<ClipProp, number>> }): LayerEdit {
  const e = edits?.[clipKey(clip.id)] ?? {};
  const keyBase = e.keyBase ?? recordedKeys(scene, clip);
  const stillBase = e.stillBase ?? Object.fromEntries(clip.props.map((p) => [p, recordedStill(scene, clip, p)]));
  return {
    ...e,
    members: clip.members,
    keyStart: clip.keyStart,
    keyBase: keyBase as Record<string, Key[]>,
    stillBase,
    keys: (change.keys ?? e.keys ?? keyBase) as Record<string, Key[]>,
    ...(change.still ? { still: { ...e.still, ...change.still } as Record<string, number> } : {}),
  };
}

function findIn(list: SceneLayer[], id: string): SceneLayer | undefined {
  for (const l of list) {
    if (l.id === id) return l;
    const hit = findIn(l.children, id);
    if (hit) return hit;
  }
}

// ---------- tracks ----------

export type ClipLane = { kind: SceneClipKind; n: number; clips: SceneClip[] };

/**
 * Clips on tracks as layers, like an editor: a higher track is drawn over a lower one. Each clip
 * goes on a track above every clip it overlaps that's drawn under it, on a track of its own kind
 * when there's room (so a shot's footage, blur fill, effects and titles each keep a track), and a
 * new track is put in at that height when there isn't. Returned top track first.
 */
export function clipLanes(clips: SceneClip[]): ClipLane[] {
  const stack: { kind: SceneClipKind; clips: SceneClip[] }[] = []; // bottom first
  const overlaps = (a: SceneClip, b: SceneClip) => a.start < b.end - 1e-3 && b.start < a.end - 1e-3;
  for (const c of [...clips].sort((a, b) => a.z - b.z)) {
    let floor = 0;
    stack.forEach((lane, i) => lane.clips.some((o) => overlaps(o, c)) && (floor = i + 1));
    const at = stack.findIndex((lane, i) => i >= floor && lane.kind === c.kind && !lane.clips.some((o) => overlaps(o, c)));
    if (at >= 0) stack[at].clips.push(c);
    else {
      // A new track at the lowest height it may take, just above its own kind's tracks if they're higher.
      let i = floor;
      while (i < stack.length && stack[i].kind !== c.kind && KIND_RANK[stack[i].kind] < KIND_RANK[c.kind]) i++;
      stack.splice(i, 0, { kind: c.kind, clips: [c] });
    }
  }
  // Number each kind's tracks bottom up ("Titles 2" is above "Titles").
  const seen: Partial<Record<SceneClipKind, number>> = {};
  const lanes = stack.map((l) => ({ kind: l.kind, n: (seen[l.kind] = (seen[l.kind] ?? 0) + 1), clips: l.clips }));
  return lanes.reverse();
}
/** Where a kind usually sits in the stack, bottom first: a tie-break for new tracks. */
const KIND_RANK: Record<SceneClipKind, number> = { background: 0, fill: 1, shot: 2, effect: 3, graphic: 4, text: 5 };

/**
 * A clip as the AI should see it when the user picked it: what it is, where, and exactly how its
 * changes are written in the plan (the same clip edit the timeline writes), so "move this up" or
 * "make it red" changes this clip and nothing else.
 */
export function sceneClipBrief(motion: { id: string; at: number; offset?: number; layers?: Record<string, LayerEdit> }, scene: Scene, clip: SceneClip): string {
  const at = (t: number) => (motion.at - (motion.offset ?? 0) + t).toFixed(2);
  const keys = clipKeys(scene, clip, motion.layers);
  const e = motion.layers?.[clipKey(clip.id)];
  const what = { shot: "footage layer", fill: "blurred fill layer (behind the footage)", effect: "effect layer", text: clip.steps ? "animated text (counter or typing)" : "title", graphic: "graphic", background: "background" }[clip.kind];
  const linked = clip.group && (clip.kind === "shot" || clip.kind === "fill" || clip.kind === "effect");
  return [
    `- A ${what} "${clip.name}" in the Claude edit motion id "${motion.id}", on screen ${at(clip.start)}-${at(clip.end)}s.`,
    `  Change it ONLY through motion["${motion.id}"].layers["${clipKey(clip.id)}"] (keep "members": ${JSON.stringify(clip.members)}, "keyStart": ${clip.keyStart}${e?.keyBase ? ', and "keyBase"/"stillBase" as they are' : ""}):`,
    `  "shift" (seconds later; it is ${e?.shift ?? 0}), "window" [from, to] in scene seconds before the shift (a trim), "hidden": true (delete),`,
    `  "still" {x, y (share of the frame from where it was), scale, rotate (degrees), opacity} for the whole clip, or "keys" {prop: [{t, v, ease}]} with t seconds after keyStart.`,
    `  Its keyframes now: ${JSON.stringify(keys)}${clip.props.includes("scale") ? "" : " (its scale can't be keyed)"}.`,
    clip.texts.length ? `  Its words: ${clip.texts.map((x) => `layers["${x.id}"].text (now "${x.text}")`).join(", ")}; colour: layers[id].style.color on ${JSON.stringify(clip.colorLayers)}.` : "",
    linked ? `  It is a layer of the shot group ${clip.group!.id}: to move or trim the shot in time, set "shift"/"window" on layers["${clipKey(clip.group!.id)}"] (with "members": ["${clip.group!.id}"]), not on this clip. Place, size, opacity and "hidden" are this layer's own.` : "",
    !linked && clip.parent ? `  It is inside the shot group ${clip.parent} and moves with it; its own "shift" moves it within the shot.` : "",
  ].filter(Boolean).join("\n");
}
