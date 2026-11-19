// cut: which parts of the recording stay. Nothing is cut into a file: the ranges become "cuts" in
// project/timeline.json and the words inside them become live "captions" there.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Cut, captionPages, readTimeline, writeTimeline } from "../project.ts";
import type { Word } from "../schema.ts";
import { round } from "../tools.ts";
import { DIR, P, fail, inside } from "./context.ts";

/**
 * Keeps the given source ranges. Nothing is cut into a file: the ranges become "cuts" in
 * project/timeline.json (the Footage component plays the source through them), and the words
 * inside them become "captions" there, as live text timed to the source.
 */
export async function cut(keepFile: string) {
  const raw = JSON.parse(readFileSync(inside(keepFile), "utf8"));
  const keep: [number, number][] = (Array.isArray(raw) ? raw : raw.keep).map((r: any) => (Array.isArray(r) ? [r[0], r[1]] : [r.start, r.end]));
  if (!keep.length || keep.some(([s, e]) => !(e > s) || s < 0)) fail("keep.json must be a list of [start, end] source seconds with end > start");
  const cuts: Cut[] = keep.map(([s, e]) => ({ start: round(s, 3), end: round(e, 3) }));
  const transcript = join(P.notes, "transcript.json");
  const words = existsSync(transcript) ? ((JSON.parse(readFileSync(transcript, "utf8")).words as Word[]) ?? []) : [];
  const timeline = readTimeline(DIR);
  timeline.cuts = cuts;
  timeline.captions = captionPages(words, cuts);
  if (timeline.cutout && !cuts.every((c) => timeline.cutout!.ranges.some(([s, e]) => c.start >= s && c.end <= e))) console.log("note: the speaker cutout no longer covers every cut. Run cutout again if you use it.");
  writeTimeline(DIR, timeline);
  // For planning: every kept word on the OUTPUT timeline (derived, rewritten by every cut; not a source of truth).
  const cutWords: Word[] = [];
  let offset = 0;
  for (const { start: s, end: e } of cuts) {
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid >= s && mid < e) cutWords.push({ text: w.text, start: round(Math.max(w.start, s) - s + offset, 3), end: round(Math.min(w.end, e) - s + offset, 3) });
    }
    offset += e - s;
  }
  writeFileSync(join(P.notes, "cut-words.json"), JSON.stringify({ note: "derived from project/timeline.json cuts: word timings in seconds of the FINISHED video. Edit timeline.json, not this.", duration: round(offset, 3), words: cutWords }, null, 1));
  console.log(`project/timeline.json: ${cuts.length} cuts, ${round(offset, 2)} s, ${timeline.captions.length} caption pages (live text, source times). notes/cut-words.json: ${cutWords.length} words on the finished video's timeline.`);
}

