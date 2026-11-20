// Cuts on the timeline: where one shot gives way to the next. The main track's cuts, and the shot
// changes inside imported Claude edits (their footage clips), on the timeline clock.
import { clipLength, clipStarts } from "../src/timeline.ts";
import type { Scene } from "../src/scene.ts";
import type { EditPlan } from "../src/schema.ts";
import { sceneClips } from "../src/sceneClips.ts";

/** Every cut, sorted, in timeline seconds. */
export function cutsOf(plan: EditPlan, scenes: Record<string, Scene>): number[] {
  const out: number[] = [];
  const starts = clipStarts(plan);
  plan.segments.forEach((s, i) => i > 0 && out.push(starts[i]));
  if (plan.segments.length) out.push(starts[starts.length - 1] + clipLength(plan.segments[plan.segments.length - 1]));
  for (const m of plan.motion) {
    const scene = m.template === "scene" && m.scene ? scenes[m.scene] : undefined;
    if (!scene) continue;
    const at = (t: number) => m.at - (m.offset ?? 0) + t;
    for (const c of sceneClips(scene, m.layers)) if (c.kind === "shot" && c.start > 0.05) out.push(at(c.start));
  }
  return [...new Set(out.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
}

/** The cut closest to `t`, if there is any. */
export function nearestCut(plan: EditPlan, scenes: Record<string, Scene>, t: number): number | undefined {
  let best: number | undefined;
  for (const c of cutsOf(plan, scenes)) if (best === undefined || Math.abs(c - t) < Math.abs(best - t)) best = c;
  return best;
}
