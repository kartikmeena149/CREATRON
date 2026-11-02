// Markers: spots the user points at on the video ("this, here"). Each one carries what's on
// screen at that moment in words, so the AI knows exactly what is meant.
import type { Marker } from "../src/plan.ts";
import type { EditPlan, Word } from "../src/schema.ts";
import { buildCues, toSourceTime } from "../src/timeline.ts";
import { locate } from "./store.ts";

export function markerContext(plan: EditPlan, words: Word[], time: number): string {
  const parts: string[] = [];
  const clip = locate(plan, time).index;
  parts.push(`Clip ${clip + 1}`);
  const src = toSourceTime(plan, time);
  const said = words.filter((w) => w.end >= src - 1 && w.start <= src + 1).map((w) => w.text).join(" ");
  if (said) parts.push(`speech around then: "${said}"`);
  if (plan.captions.enabled) {
    const cue = buildCues(plan, words).find((c) => time >= c.start && time < c.end);
    if (cue) parts.push(`caption "${cue.text}"`);
  }
  for (const m of plan.motion.filter((x) => time >= x.at && time < x.at + x.duration))
    parts.push(m.template === "custom" ? `custom animation ${m.component} (id ${m.id})` : `${m.template} "${m.text}" (id ${m.id})`);
  for (const b of plan.broll.filter((x) => time >= x.at && time < x.at + x.duration)) parts.push(`B-roll "${b.query ?? b.source}" (id ${b.id})`);
  return parts.join("; ");
}

export type { Marker };
