// Timeline math shared by the renderer and the app's live preview: where each segment sits
// in the output, and which caption shows when. Pure functions, no Node or browser APIs.
import type { Caption, EditPlan, Word } from "./schema.ts";
import { round } from "./round.ts";

/** A caption placed on the OUTPUT timeline, ready to draw. index points into captionsOf(). */
export type Cue = { index: number; text: string; start: number; end: number; x: number; y: number };

/** Maps a source time into the output timeline, or undefined when that moment was cut. */
export function toOutputTime(plan: EditPlan, t: number): number | undefined {
  let offset = 0;
  for (const s of plan.segments) {
    if (t >= s.start && t <= s.end) return offset + (t - s.start) / s.speed;
    offset += (s.end - s.start) / s.speed;
  }
  return undefined;
}

/** Maps an output time back to the source moment playing then. */
export function toSourceTime(plan: EditPlan, t: number): number {
  let offset = 0;
  for (const s of plan.segments) {
    const len = (s.end - s.start) / s.speed;
    if (t <= offset + len) return s.start + Math.max(0, t - offset) * s.speed;
    offset += len;
  }
  return plan.segments.at(-1)?.end ?? 0;
}

export function outputDuration(plan: EditPlan): number {
  return plan.segments.reduce((sum, s) => sum + (s.end - s.start) / s.speed, 0);
}

/** Captions made from the transcript: a few words each, breaking at pauses and sentence ends. */
export function speechCaptions(words: Word[], perCaption: number): Caption[] {
  const out: Caption[] = [];
  let group: Word[] = [];
  const flush = () => {
    if (group.length)
      out.push({ start: group[0].start, end: group.at(-1)!.end, text: group.map((w) => w.text).join(" ") });
    group = [];
  };
  for (const w of words) {
    const prev = group.at(-1);
    if (prev && (w.start - prev.end > 0.6 || group.length >= perCaption)) flush();
    group.push(w);
    if (/[.!?]$/.test(w.text)) flush();
  }
  flush();
  return out;
}

/** The captions in effect: the plan's own (edited or AI-written) or, if none, the transcript's. */
export function captionsOf(plan: EditPlan, words: Word[]): Caption[] {
  return plan.captions.cues ?? speechCaptions(words, plan.captions.wordsPerCaption);
}

/** Places every caption on the output timeline. Parts that were cut out are skipped. */
export function buildCues(plan: EditPlan, words: Word[]): Cue[] {
  const cues: Cue[] = [];
  captionsOf(plan, words).forEach((c, index) => {
    let start: number | undefined;
    let end: number | undefined;
    let offset = 0;
    for (const s of plan.segments) {
      const from = Math.max(c.start, s.start);
      const to = Math.min(c.end, s.end);
      if (to > from) {
        start ??= offset + (from - s.start) / s.speed;
        end = offset + (to - s.start) / s.speed;
      }
      offset += (s.end - s.start) / s.speed;
    }
    if (start === undefined || end === undefined || end - start < 0.05) return;
    cues.push({
      index,
      text: c.text,
      start,
      end,
      x: plan.captions.x + (c.x ?? 0),
      y: plan.captions.y + (c.y ?? 0),
    });
  });
  cues.sort((a, b) => a.start - b.start);

  // Hold each cue until the next one starts when the gap is short, so captions don't flicker.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    if (next && next.start - cues[i].end < 0.4) cues[i].end = Math.max(cues[i].end, next.start);
    cues[i].start = round(cues[i].start, 3);
    cues[i].end = round(Math.max(cues[i].end, cues[i].start + 0.2), 3);
    if (next && cues[i].end > next.start) cues[i].end = round(next.start, 3); // never overlap
  }
  return cues;
}

/** Caption text size in pixels for a frame, shared by preview and export. */
export function captionFontSize(plan: EditPlan, width: number, height: number): number {
  return Math.min(width, height) * (plan.captions.style === "bold" ? 0.075 : 0.05) * plan.captions.size;
}
