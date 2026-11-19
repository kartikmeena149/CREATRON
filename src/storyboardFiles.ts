// The storyboard's files beside notes/storyboard.json: what the user drew on shots, as pictures.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Storyboard } from "./storyboard.ts";

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
    const { marks: _, drawing: __, ...rest } = shot;
    if (!url?.startsWith("data:image/png;base64,") || !shot.marks?.length) return rest;
    const name = `${shot.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, name), Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    return { ...rest, drawing: `notes/storyboard-marks/${name}` };
  });
  return { ...board, shots };
}
