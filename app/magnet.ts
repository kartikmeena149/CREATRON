// The timeline magnet: while it's on, a clip you drag or trim snaps to the edges of the other
// clips (on every track), the playhead and the start, and a line shows where it snapped; off, it
// moves freely. Either way a clip never goes over another clip on its own track: it stops
// against it, edge to edge, like in any editor.
import { create } from "zustand";
import type { EditPlan } from "../src/schema.ts";
import { clipLength, clipStarts, editDuration } from "../src/timeline.ts";
import { useEditor } from "./store.ts";

const KEY = "creatron.magnet";
const SNAP_PX = 8; // how close (on screen) an edge must come to snap

export const useMagnet = create<{ on: boolean; line: number | null; toggle(): void }>((set, get) => ({
  on: (() => {
    try {
      return localStorage.getItem(KEY) !== "off";
    } catch {
      return true;
    }
  })(),
  line: null,
  toggle: () => {
    const on = !get().on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {}
    set({ on, line: null });
  },
}));

/** A track a clip lives on: B-roll on video 2+, titles on text N, audio on voice / music / sfx N. */
export type MagnetLane = { kind: "video" | "text" | "voice" | "music" | "sfx"; track: number };

type Span = { id: string; at: number; end: number };

/** The other clips on one track. */
function spans(plan: EditPlan, lane: MagnetLane, self: string): Span[] {
  const list =
    lane.kind === "video" ? plan.broll.filter((b) => (b.track ?? 2) === lane.track)
    : lane.kind === "text" ? plan.motion.filter((m) => (m.track ?? 1) === lane.track)
    : plan.voiceovers.filter((v) => (v.kind ?? "voice") === lane.kind && (v.track ?? 1) === lane.track);
  return list.filter((c) => c.id !== self).map((c) => ({ id: c.id, at: c.at, end: c.at + c.duration }));
}

/** Everything worth snapping to: every clip's edges on every track, the main track's cuts, the playhead, 0. */
function edges(plan: EditPlan, time: number, self: string): number[] {
  const out = [0, time, editDuration(plan)];
  const starts = clipStarts(plan);
  plan.segments.forEach((s, i) => out.push(starts[i], starts[i] + clipLength(s)));
  for (const c of [...plan.broll, ...plan.motion, ...plan.voiceovers]) if (c.id !== self) out.push(c.at, c.at + c.duration);
  return out;
}

const nearest = (t: number, targets: number[], within: number) => {
  let best: number | undefined;
  for (const x of targets) if (Math.abs(x - t) <= within && (best === undefined || Math.abs(x - t) < Math.abs(best - t))) best = x;
  return best;
};

/** Where a dragged clip lands: snapped by its start or its end, and pushed clear of its track's clips. */
export function magnetMove(self: string, lane: MagnetLane, at: number, duration: number): number {
  const { plan, time, pxPerSec } = useEditor.getState();
  const within = useMagnet.getState().on ? SNAP_PX / pxPerSec : 0;
  const targets = edges(plan, time, self);
  const byStart = nearest(at, targets, within);
  const byEnd = nearest(at + duration, targets, within);
  let snapped = at;
  let line: number | null = null;
  if (byStart !== undefined && (byEnd === undefined || Math.abs(byStart - at) <= Math.abs(byEnd - at - duration))) (snapped = byStart), (line = byStart);
  else if (byEnd !== undefined) (snapped = byEnd - duration), (line = byEnd);
  // Never on top of another clip on this track: the nearest spot that's free, edge to edge.
  const others = spans(plan, lane, self);
  const free = (a: number) => a >= 0 && others.every((o) => a + duration <= o.at + 1e-6 || a >= o.end - 1e-6);
  if (!free(snapped)) {
    const spots = [snapped, ...others.flatMap((o) => [o.end, o.at - duration])].filter(free);
    if (spots.length) {
      const pick = spots.reduce((b, s) => (Math.abs(s - at) < Math.abs(b - at) ? s : b));
      line = pick === snapped ? line : others.some((o) => Math.abs(o.end - pick) < 1e-6) ? pick : pick + duration;
      snapped = pick;
    }
  }
  useMagnet.setState({ line });
  return Math.max(0, snapped);
}

/**
 * A trimmed edge (`edge` at time `t`; `at`/`end` where the clip was before the trim): snapped, and
 * stopped at the clip beside it on its track.
 */
export function magnetTrim(self: string, lane: MagnetLane, edge: "start" | "end", t: number, at: number, end: number): number {
  const { plan, time, pxPerSec } = useEditor.getState();
  const snapped = useMagnet.getState().on ? nearest(t, edges(plan, time, self), SNAP_PX / pxPerSec) : undefined;
  let out = snapped ?? t;
  const others = spans(plan, lane, self);
  if (edge === "start") out = Math.max(out, ...others.filter((o) => o.end <= at + 1e-6).map((o) => o.end));
  else out = Math.min(out, ...others.filter((o) => o.at >= end - 1e-6).map((o) => o.at));
  useMagnet.setState({ line: snapped !== undefined || out !== t ? out : null });
  return out;
}

/** The drag is over: hide the snap line. */
export const magnetDone = () => useMagnet.setState({ line: null });

