// Local edits that need no AI: fast, free, and work offline.
import { type Analysis, DEFAULT_CAPTIONS, type EditPlan } from "./schema.ts";
import { round } from "./round.ts";

/**
 * Removes the detected pauses from a plan's kept parts. Each segment is split around every pause
 * inside it, keeping 0.1 s either side so speech doesn't sound clipped. Speed and zoom carry over.
 */
export function removePauses(plan: EditPlan, analysis: Analysis): EditPlan {
  const keep = 0.1;
  const segments = plan.segments.flatMap((s) => {
    const parts: EditPlan["segments"] = [];
    let t = s.start;
    for (const p of analysis.silences) {
      if (p.end <= s.start || p.start >= s.end) continue;
      const cutFrom = Math.max(p.start + keep, t);
      const cutTo = Math.min(p.end - keep, s.end);
      if (cutTo - cutFrom < 0.15) continue; // too short to be worth a cut
      if (cutFrom - t > 0.1) parts.push({ ...s, start: round(t, 3), end: round(cutFrom, 3) });
      t = cutTo;
    }
    if (s.end - t > 0.1) parts.push({ ...s, start: round(t, 3), end: round(s.end, 3) });
    return parts;
  });
  return segments.length ? { ...plan, segments } : plan;
}

export type RoughCut = {
  plan: EditPlan;
  removed: number; // output seconds cut
  retakes: string[]; // lines dropped because a later take replaced them
  outtakes: string[]; // off-camera lines like "okay, thank you"
};

// Small words that say nothing about which line a take belongs to.
const FILLER = new Set(
  "a an the and or but so to of in on at for is are was were be it its this that i you he she we they me my your our their them just like um uh okay ok yeah no not do did".split(" "),
);
const OUTTAKE = /^(okay|ok|alright|all right|cut|thank you|thanks|done|wait)\b/;

/**
 * The first pass on raw talking footage, like an editor's rough cut:
 * keep only where words are spoken (drops dead air before, between and after lines),
 * drop a line when a later take repeats it, and drop short off-camera lines at the ends.
 */
export function roughCut(plan: EditPlan, analysis: Analysis): RoughCut {
  const words = analysis.words;
  if (!words.length) return { plan, removed: 0, retakes: [], outtakes: [] };

  // Lines: words split at pauses over 0.3 s or at sentence ends.
  type Line = { start: number; end: number; text: string };
  const lines: Line[] = [];
  for (const w of words) {
    const last = lines.at(-1);
    if (!last || w.start - last.end > 0.3 || /[.!?]$/.test(last.text)) lines.push({ ...w });
    else (last.text += ` ${w.text}`), (last.end = w.end);
  }
  const content = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w));

  const drop = new Set<Line>();
  const retakes: string[] = [];
  const outtakes: string[] = [];
  lines.forEach((line, i) => {
    // A retake: most of this line's meaningful words come back in one of the next three lines.
    const mine = content(line.text);
    if (mine.length >= 2) {
      for (const later of lines.slice(i + 1, i + 4)) {
        const theirs = new Set(content(later.text));
        const shared = mine.filter((w) => theirs.has(w)).length;
        if (shared / mine.length >= 0.6 && mine.length <= theirs.size + 1) {
          drop.add(line);
          retakes.push(line.text);
          break;
        }
      }
    }
    // An outtake: a short "okay, thank you" as the very first or last line.
    const atEdge = i === 0 || i === lines.length - 1;
    if (atEdge && line.text.split(" ").length <= 4 && OUTTAKE.test(line.text.toLowerCase())) {
      drop.add(line);
      outtakes.push(line.text);
    }
  });

  // Speech to keep: the remaining lines, joined when they're close, with a little air around them.
  const keep: { start: number; end: number }[] = [];
  for (const line of lines.filter((l) => !drop.has(l))) {
    const start = Math.max(0, line.start - 0.12);
    const end = Math.min(analysis.duration, line.end + 0.15);
    const last = keep.at(-1);
    if (last && start - last.end < 0.25) last.end = end;
    else keep.push({ start, end });
  }

  // Intersect with the user's current clips so their speed, zoom and earlier cuts survive.
  const segments = plan.segments.flatMap((s) =>
    keep
      .filter((k) => k.end > s.start && k.start < s.end)
      .map((k) => ({ ...s, start: round(Math.max(s.start, k.start), 3), end: round(Math.min(s.end, k.end), 3) }))
      .filter((p) => p.end - p.start >= 0.1),
  );
  if (!segments.length) return { plan, removed: 0, retakes: [], outtakes: [] };
  const length = (p: EditPlan) => p.segments.reduce((t, s) => t + (s.end - s.start) / s.speed, 0);
  // Whisper sometimes stretches a word over a pause; the audio's own pause detection catches those.
  const next = removePauses({ ...plan, segments }, analysis);
  return { plan: next, removed: length(plan) - length(next), retakes, outtakes };
}

/** A plan that keeps the whole video untouched: the starting point when a video is imported. */
export function wholeVideo(analysis: Analysis): EditPlan {
  return {
    version: 1,
    segments: [{ start: 0, end: analysis.duration, speed: 1, zoom: 1 }],
    aspect: "source",
    transform: { scale: 1, x: 0, y: 0, rotate: 0 },
    captions: { ...DEFAULT_CAPTIONS },
    audio: { denoise: false, clarity: 0, normalize: true, volumeDb: 0, duckDb: -14 },
    voiceovers: [],
    notes: "",
  };
}
