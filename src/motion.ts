// What the Remotion layer (motion/Overlay.tsx) draws: animated captions and the M1 Motion track,
// all on the OUTPUT clock. Pure functions shared by the live preview and the export, so both
// show the same thing. No Node or browser APIs.
import { round } from "./round.ts";
import { type Scene, applyEdits } from "./scene.ts";
import type { EditPlan, Word } from "./schema.ts";
import { type Look, buildCues, captionFontSize, captionsOf, cueFontSize, editDuration, toOutputTime } from "./timeline.ts";

export type OverlayWord = { text: string; start: number; end: number };
/** `key`: the caption's key word (index into words, -1 for none), which Kartik's styles set apart. */
export type OverlayCue = { start: number; end: number; x: number; y: number; words: OverlayWord[]; look: Look; fontSize: number; key: number; index: number };
export type OverlayProps = {
  width: number;
  height: number;
  fps: number;
  duration: number; // seconds
  captions?: {
    animation: Exclude<EditPlan["captions"]["animation"], "none">;
    style: "bold" | "minimal";
    color: string;
    highlight: string;
    uppercase: boolean;
    fontSize: number; // px at width x height
    cues: OverlayCue[];
  };
  motion: {
    template: "title" | "lower-third" | "custom" | "scene";
    component?: string;
    props?: Record<string, unknown>;
    text: string;
    subtext: string;
    at: number;
    duration: number;
    color: string;
    /** An imported Claude edit with the user's changes applied; files are relative to dir. */
    scene?: { data: Scene; dir: string; offset: number };
  }[];
  /** Put before an encoded absolute path to load a scene's file (media:// in the app, a local server in the export). */
  assetPrefix?: string;
  /** Creatron's font library (fonts edits brought in), as files to load. */
  fonts?: { family: string; weight: string; style: string; unicodeRange?: string; url: string }[];
};

/** Imported scenes by scene.json path, and how their files are loaded. */
export type SceneLibrary = { scenes: Record<string, Scene>; prefix: string; fonts?: { family: string; weight: string; style: string; unicodeRange?: string; file: string }[] };

/** True when the edit needs the Remotion layer (animated captions or anything on M1). */
export function hasOverlay(plan: EditPlan, words: Word[]): boolean {
  return animatedCaptions(plan, words) || plan.motion.length > 0;
}

const animatedCaptions = (plan: EditPlan, words: Word[]) =>
  plan.captions.enabled && plan.captions.animation !== "none" && captionsOf(plan, words).length > 0;

export function overlayProps(plan: EditPlan, words: Word[], size: { width: number; height: number }, fps: number, library?: SceneLibrary): OverlayProps {
  const caps = plan.captions;
  return {
    width: size.width,
    height: size.height,
    fps,
    duration: round(editDuration(plan), 3),
    captions: animatedCaptions(plan, words)
      ? {
          animation: caps.animation as Exclude<EditPlan["captions"]["animation"], "none">,
          style: caps.style,
          color: caps.color,
          highlight: caps.highlight,
          uppercase: caps.uppercase,
          fontSize: captionFontSize(plan, size.width, size.height),
          cues: withKeyWords(cueWords(plan, words, size), caps.animation),
        }
      : undefined,
    motion: plan.motion.map((m) => {
      const data = m.template === "scene" && m.scene ? library?.scenes[m.scene] : undefined;
      return {
        template: m.template, component: m.component, props: m.props, text: m.text, subtext: m.subtext, at: m.at, duration: m.duration, color: m.color,
        ...(data ? { scene: { data: applyEdits(data, m.layers), dir: m.scene!.replace(/\/[^/]*$/, ""), offset: m.offset ?? 0 } } : {}),
      };
    }),
    ...(library ? { assetPrefix: library.prefix } : {}),
    ...(library?.fonts?.length ? { fonts: library.fonts.map(({ file, ...f }) => ({ ...f, url: library.prefix + encodeURIComponent(file) })) } : {}),
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
      start: cue.start, end: cue.end, x: cue.x, y: cue.y, look: cue.look, fontSize: cueFontSize(plan, cue.look, size.width, size.height), key: -1, index: cue.index,
      words: timed.map((w) => ({ ...w, start: round(w.start, 3), end: round(w.end, 3) })),
    };
  });
}

// Little words that are never a caption's key word.
const COMMON = new Set(("the a an and or but so to of in on at for with from by as is are was were be been it its it's this that these those " +
  "i i'm you your we our they their he she his her my me us them what when where which who how just really very then than there here " +
  "about because could would should have has had do does did not can will into out up down over also some more most like").split(" "));

/**
 * The word in each caption that Kartik's styles set apart: a number if there is one (the last),
 * otherwise the longest real word of 5+ letters (the later one on a tie, as the payoff comes last).
 * Doc captions get one only about every third caption and never two in a row, as in his skill.
 */
function withKeyWords(cues: OverlayCue[], animation: EditPlan["captions"]["animation"]): OverlayCue[] {
  if (animation !== "kinetic" && animation !== "doc" && animation !== "glow" && animation !== "spec") return cues;
  let sinceKey = 2;
  return cues.map((cue) => {
    const bare = cue.words.map((w) => w.text.toLowerCase().replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, ""));
    let key = bare.findLastIndex((w) => /\d/.test(w));
    if (key < 0) {
      let best = 4;
      bare.forEach((w, i) => !COMMON.has(w) && w.length >= best && ((best = w.length), (key = i)));
    }
    if (animation === "doc") {
      if (key >= 0 && sinceKey >= 2) sinceKey = 0;
      else (key = -1), sinceKey++;
    }
    return { ...cue, key };
  });
}
