// What the Remotion layer (motion/Overlay.tsx) draws: animated captions and the M1 Motion track,
// all on the OUTPUT clock. Pure functions shared by the live preview and the export, so both
// show the same thing. No Node or browser APIs.
import { round } from "./round.ts";
import type { EditPlan, Word } from "./schema.ts";
import { type Look, buildCues, captionFontSize, captionsOf, cueFontSize, editDuration, toOutputTime } from "./timeline.ts";

export type OverlayWord = { text: string; start: number; end: number };
export type OverlayCue = { start: number; end: number; x: number; y: number; words: OverlayWord[]; look: Look; fontSize: number };
export type OverlayProps = {
  width: number;
  height: number;
  fps: number;
  duration: number; // seconds
  captions?: {
    animation: "pop" | "highlight" | "word";
    style: "bold" | "minimal";
    color: string;
    highlight: string;
    uppercase: boolean;
    fontSize: number; // px at width x height
    cues: OverlayCue[];
  };
  motion: {
    template: "title" | "lower-third" | "custom";
    component?: string;
    props?: Record<string, unknown>;
    text: string;
    subtext: string;
    at: number;
    duration: number;
    color: string;
  }[];
};

/** True when the edit needs the Remotion layer (animated captions or anything on M1). */
export function hasOverlay(plan: EditPlan, words: Word[]): boolean {
  return animatedCaptions(plan, words) || plan.motion.length > 0;
}

const animatedCaptions = (plan: EditPlan, words: Word[]) =>
  plan.captions.enabled && plan.captions.animation !== "none" && captionsOf(plan, words).length > 0;

export function overlayProps(plan: EditPlan, words: Word[], size: { width: number; height: number }, fps: number): OverlayProps {
  const caps = plan.captions;
  return {
    width: size.width,
    height: size.height,
    fps,
    duration: round(editDuration(plan), 3),
    captions: animatedCaptions(plan, words)
      ? {
          animation: caps.animation as "pop" | "highlight" | "word",
          style: caps.style,
          color: caps.color,
          highlight: caps.highlight,
          uppercase: caps.uppercase,
          fontSize: captionFontSize(plan, size.width, size.height),
          cues: cueWords(plan, words, size),
        }
      : undefined,
    motion: plan.motion.map((m) => ({
      template: m.template, component: m.component, props: m.props, text: m.text, subtext: m.subtext, at: m.at, duration: m.duration, color: m.color,
    })),
  };
}

/**
 * Each caption with its words timed on the output clock. Real word times from the transcript
 * when the caption's words match it; otherwise (edited text) the words share the caption's time.
 */
function cueWords(plan: EditPlan, words: Word[], size: { width: number; height: number }): OverlayCue[] {
  const source = captionsOf(plan, words);
  return buildCues(plan, words).map((cue) => {
    const c = source[cue.index];
    const texts = cue.text.split(/\s+/).filter(Boolean);
    const spoken = words.filter((w) => w.start >= c.start - 0.05 && w.end <= c.end + 0.05);
    const timed =
      spoken.length === texts.length
        ? texts.map((text, i) => {
            const start = toOutputTime(plan, spoken[i].start) ?? cue.start;
            const end = toOutputTime(plan, spoken[i].end) ?? start;
            return { text, start: Math.max(cue.start, start), end: Math.min(cue.end, Math.max(end, start + 0.05)) };
          })
        : texts.map((text, i) => ({
            text,
            start: cue.start + ((cue.end - cue.start) * i) / texts.length,
            end: cue.start + ((cue.end - cue.start) * (i + 1)) / texts.length,
          }));
    return {
      start: cue.start, end: cue.end, x: cue.x, y: cue.y, look: cue.look, fontSize: cueFontSize(plan, cue.look, size.width, size.height),
      words: timed.map((w) => ({ ...w, start: round(w.start, 3), end: round(w.end, 3) })),
    };
  });
}
