// Timeline math shared by the renderer and the app's live preview: where each segment sits
// in the output, and which caption shows when. Pure functions, no Node or browser APIs.
import type { Caption, CaptionLook, EditPlan, Word } from "./schema.ts";
import { round } from "./round.ts";

/** A caption placed on the OUTPUT timeline, ready to draw. index points into captionsOf(). */
export type Cue = { index: number; text: string; start: number; end: number; x: number; y: number; look: Look };

/** A caption's final look: the captions' look with its own changes on top. */
export type Look = Required<CaptionLook>;

/** The dark box minimal captions have always had, when no background colour is chosen. */
export const DEFAULT_BOX = "#0000008c";

/** The box behind a caption as a CSS colour, or "" for none. */
export function lookBox(look: Look): string {
  const c = look.background || (look.outline === "box" ? DEFAULT_BOX : "");
  if (!c) return "";
  const a = parseInt(c.slice(7, 9), 16) / 255;
  return a > 0 ? `rgba(${parseInt(c.slice(1, 3), 16)},${parseInt(c.slice(3, 5), 16)},${parseInt(c.slice(5, 7), 16)},${a.toFixed(3)})` : "";
}

/** Caption animations that colour a word (the one being said, or the caption's key word) with the accent. */
export function usesAccent(animation: EditPlan["captions"]["animation"]): boolean {
  return animation === "highlight" || animation === "kinetic" || animation === "doc" || animation === "spec";
}

export function captionLook(plan: EditPlan, own?: CaptionLook, index = 0): Look {
  const c = plan.captions;
  const accents = c.accents ?? [];
  const all: Look = {
    font: c.font ?? "Arial",
    size: c.size,
    wrapAt: c.wrapAt ?? 1,
    color: c.color,
    bold: c.bold ?? true,
    italic: c.italic ?? false,
    underline: c.underline ?? false,
    strike: c.strike ?? false,
    outline: c.outline ?? (c.style === "bold" ? "outline" : "box"),
    behind: c.behind ?? false,
    align: c.align ?? "center",
    // The accent (the word being said, or the key word): the next palette colour for this caption
    // (index = its place among the captions), else the highlight colour; one-word captions only take
    // a palette. Otherwise the text colour.
    highlight: accents.length && (usesAccent(c.animation) || c.animation === "word") ? accents[index % accents.length]
      : usesAccent(c.animation) ? c.highlight : null,
    background: "",
  };
  return { ...all, ...Object.fromEntries(Object.entries(own ?? {}).filter(([, v]) => v !== undefined)) } as Look;
}

/** One caption's text size in pixels for a frame (its own size multiplier on the captions' base). */
export function cueFontSize(plan: EditPlan, look: Look, width: number, height: number): number {
  return Math.min(width, height) * (plan.captions.style === "bold" ? 0.075 : 0.05) * look.size;
}

/**
 * How wide a caption's lines may run before the next word wraps: 86% of the frame at the size the
 * look was set at (a preset's size), growing and shrinking with the text from there, so resizing
 * a caption scales it without moving words between lines.
 */
/** CSS for lining a caption's lines up: centred captions fit their words, aligned ones fill their column. */
export function alignBox(look: Look, width: number): { width?: number; textAlign: "center" | "left" | "right" } {
  return look.align === "center" ? { textAlign: "center" } : { width: captionWrapWidth(look, width), textAlign: look.align };
}

export function captionWrapWidth(look: Look, width: number): number {
  return (width * 0.86 * look.size) / (look.wrapAt || 1);
}

/** How long a main-track clip plays on the timeline (its speed applied). */
export const clipLength = (s: EditPlan["segments"][number]) => (s.end - s.start) / s.speed;

/**
 * Where each main-track clip starts on the output timeline. Clips follow each other, after the
 * empty gap before a clip when there is one (dragged there with the magnet off).
 */
export function clipStarts(plan: EditPlan): number[] {
  let t = 0;
  return plan.segments.map((s) => {
    const at = t + (s.gap ?? 0);
    t = at + clipLength(s);
    return at;
  });
}

/** Maps a source time into the output timeline, or undefined when that moment was cut. */
export function toOutputTime(plan: EditPlan, t: number): number | undefined {
  const starts = clipStarts(plan);
  for (const [i, s] of plan.segments.entries()) if (t >= s.start && t <= s.end) return starts[i] + (t - s.start) / s.speed;
  return undefined;
}

/** Maps an output time back to the source moment playing then (in a gap: where the next clip starts). */
export function toSourceTime(plan: EditPlan, t: number): number {
  const starts = clipStarts(plan);
  for (const [i, s] of plan.segments.entries()) if (t <= starts[i] + clipLength(s)) return s.start + Math.max(0, t - starts[i]) * s.speed;
  return plan.segments.at(-1)?.end ?? 0;
}

/** Length of the main track (Track 1) after cuts, speed changes and gaps. */
export function outputDuration(plan: EditPlan): number {
  const n = plan.segments.length;
  return n ? clipStarts(plan)[n - 1] + clipLength(plan.segments[n - 1]) : 0;
}

/**
 * Length of the whole edit: the main track, or longer when a B-roll, text or audio clip runs past
 * its end (the picture is black there, under whatever is on the other tracks).
 */
export function editDuration(plan: EditPlan): number {
  const ends = [...plan.broll, ...plan.motion, ...plan.voiceovers].map((c) => c.at + c.duration);
  return Math.max(outputDuration(plan), ...ends);
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
  const starts = clipStarts(plan);
  captionsOf(plan, words).forEach((c, index) => {
    let start: number | undefined;
    let end: number | undefined;
    for (const [i, s] of plan.segments.entries()) {
      const from = Math.max(c.start, s.start);
      const to = Math.min(c.end, s.end);
      if (to > from) {
        start ??= starts[i] + (from - s.start) / s.speed;
        end = starts[i] + (to - s.start) / s.speed;
      }
    }
    if (start === undefined || end === undefined || end - start < 0.05) return;
    cues.push({
      index,
      text: c.text,
      start,
      end,
      x: plan.captions.x + (c.x ?? 0),
      y: plan.captions.y + (c.y ?? 0),
      look: captionLook(plan, c.look, index),
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
