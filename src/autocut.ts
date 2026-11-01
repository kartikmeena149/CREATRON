// Local edits that need no AI: fast, free, and work offline.
import type { Analysis, EditPlan } from "./schema.ts";
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

/** A plan that keeps the whole video untouched: the starting point when a video is imported. */
export function wholeVideo(analysis: Analysis): EditPlan {
  return {
    version: 1,
    segments: [{ start: 0, end: analysis.duration, speed: 1, zoom: 1 }],
    aspect: "source",
    reframeX: 0.5,
    captions: { enabled: false, style: "bold", wordsPerCaption: 3 },
    audio: { denoise: false, clarity: 0, normalize: true, volumeDb: 0 },
    notes: "",
  };
}
