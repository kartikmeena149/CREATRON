// Keyframes: a clip property that changes over time, like a pro editor's diamonds. Plain values in
// the edit plan ({ t, v, ease }), read the same way by the live preview and the export.
// Pure functions, no Node or browser APIs.
import { z } from "zod";

export const EASES = ["linear", "ease", "in", "out"] as const;
export type Ease = (typeof EASES)[number];

/** One keyframe: `t` seconds into the clip (on the edited timeline), the value there, the easing on the way to the next one. */
export const Key = z.object({
  t: z.number().min(-3600).max(3600).describe("Seconds into the clip (0 = its first frame on the timeline)"),
  v: z.number().describe("The property's value at that moment"),
  ease: z.enum(EASES).optional().describe("How it moves to the next keyframe: linear (default), ease (slow in and out), in (speeds up), out (slows down)"),
});
export type Key = z.infer<typeof Key>;

/** Keyframes for some of a clip's properties. A property with keyframes ignores its plain value. */
export const keysFor = <P extends string>(props: readonly [P, ...P[]], what: string) =>
  z.object(Object.fromEntries(props.map((p) => [p, z.array(Key).optional()])) as Record<P, z.ZodOptional<z.ZodArray<typeof Key>>>)
    .partial()
    .optional()
    .describe(`Keyframes that animate ${what} over the clip: { property: [{ t, v, ease? }, …] }. Leave out to keep each property still`);

export type Keys<P extends string = string> = Partial<Record<P, Key[]>>;

/** What can be animated on each kind of clip. */
export const SEGMENT_KEYS = ["zoom", "volume"] as const;
export const BROLL_KEYS = ["x", "y", "scale", "rotate", "opacity"] as const;
export const AUDIO_KEYS = ["volumeDb"] as const;

/** Two keyframes closer than this (seconds) are the same one. */
export const KEY_SNAP = 1 / 30;

const sorted = (list: Key[]) => [...list].sort((a, b) => a.t - b.t);

/** How far along (0..1) after easing. */
export function eased(ease: Ease | undefined, u: number): number {
  if (ease === "ease") return u * u * (3 - 2 * u);
  if (ease === "in") return u * u;
  if (ease === "out") return 1 - (1 - u) * (1 - u);
  return u;
}

/** The value at `t` seconds into the clip: held before the first and after the last keyframe. */
export function valueAt(list: Key[] | undefined, t: number, still: number): number {
  if (!list?.length) return still;
  const k = sorted(list);
  if (t <= k[0].t) return k[0].v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (t < b.t) return a.v + (b.v - a.v) * eased(a.ease, b.t > a.t ? (t - a.t) / (b.t - a.t) : 1);
  }
  return k[k.length - 1].v;
}

/** Every animated property's value at `t`, on top of the clip's plain values. */
export function animated<T extends object>(clip: T & { keys?: Keys }, t: number, props: readonly string[]): T {
  if (!clip.keys) return clip;
  const out: Record<string, unknown> = { ...clip };
  for (const p of props) {
    const list = clip.keys[p];
    if (list?.length) out[p] = valueAt(list, t, Number(out[p] ?? 0));
  }
  return out as T;
}

const num = (n: number) => (Math.abs(n) < 1e-9 ? "0" : String(Math.round(n * 1e6) / 1e6));

/**
 * The same curve as an ffmpeg expression of time variable `T` (seconds into the clip). `map` turns
 * a value into what the filter wants, e.g. dB into a gain. Used inside single-quoted filter options.
 */
export function ffExpr(list: Key[] | undefined, T: string, still: number, map: (v: string) => string = (v) => v): string {
  if (!list?.length) return map(num(still));
  const k = sorted(list);
  const curve = (u: string, e?: Ease) =>
    e === "ease" ? `(${u})*(${u})*(3-2*(${u}))` : e === "in" ? `(${u})*(${u})` : e === "out" ? `(1-(1-(${u}))*(1-(${u})))` : `(${u})`;
  let expr = num(k[k.length - 1].v);
  for (let i = k.length - 2; i >= 0; i--) {
    const a = k[i], b = k[i + 1];
    const span = b.t - a.t;
    const piece = span > 1e-6 ? `${num(a.v)}+(${num(b.v - a.v)})*${curve(`(${T}-${num(a.t)})/${num(span)}`, a.ease)}` : num(b.v);
    expr = `if(lt(${T},${num(b.t)}),${piece},${expr})`;
  }
  return map(`if(lt(${T},${num(k[0].t)}),${num(k[0].v)},${expr})`);
}

/** Whether any property has keyframes. */
export const hasKeys = (keys: Keys | undefined) => Boolean(keys && Object.values(keys).some((l) => l?.length));

/** The keyframe at `t` (within KEY_SNAP), if there is one. */
export const keyAt = (list: Key[] | undefined, t: number) => list?.find((k) => Math.abs(k.t - t) < KEY_SNAP);

/** Adds a keyframe at `t`, or changes the one already there. */
export function setKey(keys: Keys | undefined, prop: string, t: number, v: number): Keys {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const list = (keys?.[prop] ?? []).filter((k) => Math.abs(k.t - t) >= KEY_SNAP);
  const old = keyAt(keys?.[prop], t);
  return { ...keys, [prop]: sorted([...list, { ...old, t: r(old?.t ?? t), v: r(v) }]) };
}

/** Takes out the keyframe at `t`. A property left without keyframes is still again. */
export function removeKey(keys: Keys | undefined, prop: string, t: number): Keys | undefined {
  const list = (keys?.[prop] ?? []).filter((k) => Math.abs(k.t - t) >= KEY_SNAP);
  return tidy({ ...keys, [prop]: list });
}

/** Changes the easing out of the keyframe at `t`. */
export function setEase(keys: Keys | undefined, prop: string, t: number, ease: Ease): Keys | undefined {
  return tidy({ ...keys, [prop]: (keys?.[prop] ?? []).map((k) => (Math.abs(k.t - t) < KEY_SNAP ? { ...k, ease: ease === "linear" ? undefined : ease } : k)) });
}

/** Moves every keyframe by `dt` seconds (a clip trimmed or split at its start keeps its animation on the picture). */
export function shiftKeys(keys: Keys | undefined, dt: number): Keys | undefined {
  if (!keys || !dt) return keys;
  return tidy(Object.fromEntries(Object.entries(keys).map(([p, l]) => [p, l?.map((k) => ({ ...k, t: Math.round((k.t + dt) * 1000) / 1000 }))])));
}

/** Keyframe times of every property, once each, sorted (for the diamonds on a clip). */
export function keyTimes(keys: Keys | undefined): number[] {
  const out: number[] = [];
  for (const l of Object.values(keys ?? {})) for (const k of l ?? []) if (!out.some((t) => Math.abs(t - k.t) < KEY_SNAP)) out.push(k.t);
  return out.sort((a, b) => a - b);
}

/** Drops empty properties; undefined when nothing is left. */
function tidy(keys: Keys): Keys | undefined {
  const kept = Object.entries(keys).filter(([, l]) => l?.length);
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/**
 * A change to a clip's properties, the way a pro editor takes it: a property that has keyframes
 * gets a keyframe at `t` (seconds into the clip, kept inside it) instead of a new still value.
 * A change that sets `keys` itself is left as it is.
 */
export function routeToKeys<T extends { keys?: Keys }>(clip: T, patch: Partial<T>, props: readonly string[], t: number, length: number): Partial<T> {
  if ("keys" in patch) return patch;
  const at = Math.max(0, Math.min(length, t));
  let keys = clip.keys;
  const out: Record<string, unknown> = { ...patch };
  for (const p of props) {
    const v = (patch as Record<string, unknown>)[p];
    if (typeof v === "number" && keys?.[p]?.length) {
      keys = setKey(keys, p, at, v);
      delete out[p];
    }
  }
  return keys === clip.keys ? patch : ({ ...out, keys } as Partial<T>);
}
