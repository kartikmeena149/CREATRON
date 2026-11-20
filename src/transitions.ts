// Transitions between main-track clips. A transition sits on a cut and never changes the edit's
// length or timing: it plays half before the cut and half after, using the footage just past
// each clip's ends (its handles; a held frame where the recording has none). The export draws it
// with ffmpeg's xfade, the preview with the same shapes in CSS. Pure functions.
import { z } from "zod";
import type { EditPlan } from "./schema.ts";
import { clipLength, clipStarts } from "./timeline.ts";

/** Each transition: its name in the plan, what the timeline calls it, and ffmpeg's xfade name. */
export const TRANSITION_TYPES = {
  dissolve: { label: "Dissolve", xfade: "fade" },
  black: { label: "Dip to black", xfade: "fadeblack" },
  white: { label: "Dip to white", xfade: "fadewhite" },
  "wipe-left": { label: "Wipe left", xfade: "wipeleft" },
  "wipe-right": { label: "Wipe right", xfade: "wiperight" },
  "wipe-up": { label: "Wipe up", xfade: "wipeup" },
  "wipe-down": { label: "Wipe down", xfade: "wipedown" },
  "slide-left": { label: "Slide left", xfade: "slideleft" },
  "slide-right": { label: "Slide right", xfade: "slideright" },
  "slide-up": { label: "Slide up", xfade: "slideup" },
  "slide-down": { label: "Slide down", xfade: "slidedown" },
  circle: { label: "Circle", xfade: "circleopen" },
  zoom: { label: "Zoom in", xfade: "zoomin" },
} as const;
export type TransitionType = keyof typeof TRANSITION_TYPES;
export const TRANSITIONS = Object.keys(TRANSITION_TYPES) as [TransitionType, ...TransitionType[]];

export const Transition = z.object({
  type: z.enum(TRANSITIONS).describe(
    "dissolve = cross-fade; black / white = dip through a colour; wipe-* = a straight edge uncovers the next clip; slide-* = both clips move; circle = the next clip opens from the middle; zoom = zooms into the cut",
  ),
  duration: z.number().min(0.1).max(3).default(0.5).describe("Seconds, centred on the cut (0.3-0.8 is typical). Never longer than either clip"),
});
export type Transition = z.infer<typeof Transition>;

/** A transition as it will play: into clip `index`, `duration` output seconds centred on the cut at `cut`. */
export type PlacedTransition = { index: number; type: TransitionType; duration: number; cut: number };

/**
 * The transitions that play: into every main-track clip that has one, except the first clip and a
 * clip after an empty gap. Each is cut down to fit both clips, so two never overlap.
 */
export function placedTransitions(plan: EditPlan): PlacedTransition[] {
  const starts = clipStarts(plan);
  const out: PlacedTransition[] = [];
  plan.segments.forEach((s, i) => {
    const t = s.transition;
    if (!t || i === 0 || s.gap) return;
    const d = Math.min(t.duration, clipLength(plan.segments[i - 1]), clipLength(s));
    if (d >= 0.05) out.push({ index: i, type: t.type, duration: Math.round(d * 1000) / 1000, cut: starts[i] });
  });
  return out;
}

/**
 * Per clip, the extra output seconds it plays before its start and after its end for the
 * transitions on either side (half of each), so the cross-over has footage to show.
 */
export function clipHandles(plan: EditPlan): { before: number; after: number }[] {
  const h = plan.segments.map(() => ({ before: 0, after: 0 }));
  for (const t of placedTransitions(plan)) {
    h[t.index].before = t.duration / 2;
    h[t.index - 1].after = t.duration / 2;
  }
  return h;
}

/** The transition playing at output time `time`, with how far through it is (0..1). */
export function transitionAt(plan: EditPlan, time: number): (PlacedTransition & { p: number }) | undefined {
  for (const t of placedTransitions(plan)) {
    const from = t.cut - t.duration / 2;
    if (time >= from && time < from + t.duration) return { ...t, p: (time - from) / t.duration };
  }
  return undefined;
}

type Css = { opacity?: number; transform?: string; clipPath?: string };

/**
 * The preview's version of each transition at progress p: styles for the outgoing clip (a), the
 * incoming clip (b, drawn on top) and a colour cover over both (the dips). Matches xfade's shapes.
 */
export function transitionLook(type: TransitionType, p: number): { a: Css; b: Css; cover?: { color: string; opacity: number } } {
  const q = 1 - p;
  const pc = (n: number) => `${(n * 100).toFixed(2)}%`;
  switch (type) {
    case "dissolve": return { a: {}, b: { opacity: p } };
    case "black":
    case "white": return { a: {}, b: { opacity: p < 0.5 ? 0 : 1 }, cover: { color: type === "black" ? "#000" : "#fff", opacity: 1 - Math.abs(2 * p - 1) } };
    case "wipe-left": return { a: {}, b: { clipPath: `inset(0 0 0 ${pc(q)})` } };
    case "wipe-right": return { a: {}, b: { clipPath: `inset(0 ${pc(q)} 0 0)` } };
    case "wipe-up": return { a: {}, b: { clipPath: `inset(${pc(q)} 0 0 0)` } };
    case "wipe-down": return { a: {}, b: { clipPath: `inset(0 0 ${pc(q)} 0)` } };
    case "slide-left": return { a: { transform: `translateX(${pc(-p)})` }, b: { transform: `translateX(${pc(q)})` } };
    case "slide-right": return { a: { transform: `translateX(${pc(p)})` }, b: { transform: `translateX(${pc(-q)})` } };
    case "slide-up": return { a: { transform: `translateY(${pc(-p)})` }, b: { transform: `translateY(${pc(q)})` } };
    case "slide-down": return { a: { transform: `translateY(${pc(p)})` }, b: { transform: `translateY(${pc(-q)})` } };
    case "circle": return { a: {}, b: { clipPath: `circle(${(p * 71).toFixed(2)}% at 50% 50%)` } };
    case "zoom": return { a: { transform: `scale(${(1 + p).toFixed(3)})` }, b: { opacity: p < 0.5 ? 0 : (p - 0.5) * 2 } };
  }
}
