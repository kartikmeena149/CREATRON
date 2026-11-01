// Timeline math shared by the renderer and the app's live preview: where each segment sits
// in the output, and which caption shows when. Pure functions, no Node or browser APIs.
import type { EditPlan, Word } from "./schema.ts";
import { round } from "./round.ts";

export type Cue = { text: string; start: number; end: number };

/** Maps a source time into the output timeline, or undefined when that moment was cut. */
export function toOutputTime(plan: EditPlan, t: number): number | undefined {
  let offset = 0;
  for (const s of plan.segments) {
    if (t >= s.start && t <= s.end) return offset + (t - s.start) / s.speed;
    offset += (s.end - s.start) / s.speed;
  }
  return undefined;
}

export function outputDuration(plan: EditPlan): number {
  return plan.segments.reduce((sum, s) => sum + (s.end - s.start) / s.speed, 0);
}

export function buildCues(plan: EditPlan, words: Word[]): Cue[] {
  const max = plan.captions.wordsPerCaption;
  // Keep a word when its middle survives the cut; place it on the output timeline.
  const placed = words.flatMap((w) => {
    const mid = toOutputTime(plan, (w.start + w.end) / 2);
    const start = toOutputTime(plan, w.start);
    const end = toOutputTime(plan, w.end);
    if (mid === undefined) return [];
    return [{ text: w.text, start: start ?? mid - 0.05, end: end ?? mid + 0.05 }];
  });

  const cues: Cue[] = [];
  let group: typeof placed = [];
  const flush = () => {
    if (group.length) cues.push({ text: group.map((w) => w.text).join(" "), start: group[0].start, end: group.at(-1)!.end });
    group = [];
  };
  for (const w of placed) {
    const prev = group.at(-1);
    if (prev && (w.start - prev.end > 0.6 || group.length >= max)) flush();
    group.push(w);
    if (/[.!?]$/.test(w.text)) flush();
  }
  flush();

  // Hold each cue until the next one starts when the gap is short, so captions don't flicker.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    if (next && next.start - cues[i].end < 0.4) cues[i].end = next.start;
    cues[i].start = round(cues[i].start, 3);
    cues[i].end = round(Math.max(cues[i].end, cues[i].start + 0.2), 3);
  }
  return cues;
}
