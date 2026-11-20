// The storyboard's files beside notes/storyboard.json: what the user drew on shots, as pictures.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Storyboard, arrowNote, parseStoryboard, withoutArrowNotes } from "./storyboard.ts";

/**
 * What the user drew on shots, as pictures Claude can look at: notes/storyboard-marks/<shot>.png,
 * named on each shot (`drawing`). The strokes themselves stay out of notes/storyboard.json: a picture
 * says it to Claude, a list of thousands of coordinates doesn't. `drawings` are PNG data URLs by shot id.
 */
export function withDrawings(board: Storyboard, dir: string, drawings: Record<string, string>): Storyboard {
  const folder = join(dir, "notes", "storyboard-marks");
  rmSync(folder, { recursive: true, force: true }); // last round's drawings are answered already
  const shots = board.shots.map((shot) => {
    const url = drawings[shot.id];
    const { marks: _, drawing: __, ...plain } = shot;
    // The arrows' notes, word for word too (the picture shows where they point).
    const notes = (shot.marks ?? []).filter((m) => m.tool === "arrow" && m.text?.trim()).map((m) => arrowNote(m.text!));
    const own = withoutArrowNotes(plain.ask);
    const rest = { ...plain, ask: [own, ...notes].filter(Boolean).join("; ") || undefined };
    if (!url?.startsWith("data:image/png;base64,") || !shot.marks?.length) return rest;
    const name = `${shot.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, name), Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    return { ...rest, drawing: `notes/storyboard-marks/${name}` };
  });
  return { ...board, shots };
}

/**
 * Every draft Claude made of this storyboard, oldest first: notes/storyboard-drafts/01.json, 02.json…
 * They are what Undo and Redo step through, and they stay when the storyboard is opened again later.
 */
export function storyboardDrafts(dir: string): Storyboard[] {
  const folder = join(dir, "notes", "storyboard-drafts");
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .flatMap((f) => parseStoryboard(readFileSync(join(folder, f), "utf8")).board ?? []);
}

/** Keeps a new draft (not the same one twice in a row) and returns all of them. */
export function saveDraft(dir: string, board: Storyboard): Storyboard[] {
  const drafts = storyboardDrafts(dir);
  const last = drafts.at(-1);
  if (last && JSON.stringify(last) === JSON.stringify(board)) return drafts;
  const folder = join(dir, "notes", "storyboard-drafts");
  mkdirSync(folder, { recursive: true });
  const n = readdirSync(folder).filter((f) => /^\d+\.json$/.test(f)).map((f) => parseInt(f)).reduce((a, b) => Math.max(a, b), 0) + 1;
  writeFileSync(join(folder, `${String(n).padStart(2, "0")}.json`), JSON.stringify(board, null, 2));
  return [...drafts, board];
}
