// The storyboard: the first step of every full edit. Before building anything, Claude draws the
// video as shots: every spoken line, what is on screen while it's said, the look, the motion, the
// sound. Creatro shows it to the user as sketches made from their own footage; the edit waits until
// they approve it (or ask for changes). It is plain data in notes/storyboard.json, read by the app and
// by Claude, so the user's edits to it are what Claude builds from.
// Pure: no Node or browser APIs, the app imports it too.
import { z } from "zod";

export const SHOT_KINDS = ["talking", "broll", "image", "split", "cutout", "text", "graphic"] as const;
export const CAMERAS = ["still", "zoom-in", "zoom-out", "punch-in", "pan-left", "pan-right", "shake"] as const;
export const TRANSITIONS = ["cut", "whip", "zoom", "fade", "slide", "glitch", "flash"] as const;
export const LAYER_KINDS = ["text", "caption", "image", "footage", "box", "arrow", "sticker", "chart"] as const;

const unit = z.coerce.number().catch(0).transform((v) => Math.min(1, Math.max(0, v)));
const str = (fallback = "") => z.coerce.string().catch(fallback);
const pick = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) => z.enum(values).catch(fallback);

/** One thing drawn in a shot's frame. Boxes are fractions of the frame (0..1, from the top left). */
export const Layer = z.object({
  kind: pick(LAYER_KINDS, "box"),
  x: unit, y: unit, w: unit, h: unit,
  text: str().optional(),
  color: str().optional(),
  note: str().optional(),
});
export type Layer = z.infer<typeof Layer>;

export const Shot = z.object({
  id: str(),
  /** The words said during the shot, exactly as in the transcript. Empty for a silent shot. */
  line: str(),
  /** Source seconds of the recording this shot plays. */
  from: z.coerce.number().catch(0),
  to: z.coerce.number().catch(0),
  kind: pick(SHOT_KINDS, "talking"),
  /** What the picture comes from: "main" (the recording) or a project file (assets/clips/x.mp4), and when. */
  source: z.object({ file: str("main"), at: z.coerce.number().optional().catch(undefined) }).optional().catch(undefined),
  /** For B-roll still to be found: what it must show. */
  query: str().optional(),
  layers: z.array(Layer).catch([]),
  camera: pick(CAMERAS, "still"),
  transition: pick(TRANSITIONS, "cut"),
  sound: str().optional(),
  /** Why this shot: one short sentence for the user. */
  why: str().optional(),
  /** The user's note to Claude about this shot (from the storyboard view). */
  ask: str().optional(),
  /** The user took this line out of the video. */
  dropped: z.boolean().optional().catch(undefined),
});
export type Shot = z.infer<typeof Shot>;

export const Storyboard = z.object({
  title: str("Untitled"),
  /** The idea of the video in one sentence. */
  idea: str(),
  format: pick(["9:16", "16:9", "1:1", "4:5"] as const, "9:16"),
  look: z.object({
    palette: z.array(str()).catch([]).transform((p) => p.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c.trim())).slice(0, 5)),
    font: str("SF Pro Display"),
    mood: str(),
    captions: str(),
  }).catch({ palette: [], font: "SF Pro Display", mood: "", captions: "" }),
  music: str().optional(),
  shots: z.array(Shot).catch([]),
});
export type Storyboard = z.infer<typeof Storyboard>;

/** A storyboard from JSON text, made usable (ids, order, sane times), or the reason it can't be. */
export function parseStoryboard(text: string): { board?: Storyboard; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { problems: [`notes/storyboard.json isn't valid JSON: ${(e as Error).message}`] };
  }
  const r = Storyboard.safeParse(raw);
  if (!r.success) return { problems: [`notes/storyboard.json doesn't match the format: ${r.error.issues[0]?.message ?? "unknown"}`] };
  const board = r.data;
  board.shots = board.shots
    .map((s, i) => ({ ...s, id: s.id || `s${i + 1}`, to: Math.max(s.to, s.from) }))
    .sort((a, b) => a.from - b.from);
  return { board, problems: checkStoryboard(board) };
}

/** What makes a storyboard unusable for the user (things Claude must fix). */
export function checkStoryboard(b: Storyboard): string[] {
  const out: string[] = [];
  if (b.shots.length < 3) out.push(`only ${b.shots.length} shot(s): a storyboard needs a shot for every line or beat (usually one every 2-4 s)`);
  const ids = new Set<string>();
  for (const s of b.shots) {
    if (ids.has(s.id)) out.push(`shot id "${s.id}" is used twice`);
    ids.add(s.id);
    if (!s.layers.length && s.kind !== "talking" && s.kind !== "broll") out.push(`shot ${s.id} (${s.kind}) has no layers: draw what is on screen`);
    if (s.kind === "broll" && !s.query && s.source?.file === "main") out.push(`shot ${s.id} is B-roll but says neither what it must show (query) nor which file`);
  }
  return out;
}

/** Seconds the shots that stay add up to (the finished video's length, roughly). */
export const boardLength = (b: Storyboard) => b.shots.filter((s) => !s.dropped).reduce((a, s) => a + Math.max(0, s.to - s.from), 0);

/** The plain name of a shot kind, a camera move, a transition. */
export const KIND_LABEL: Record<Shot["kind"], string> = {
  talking: "On camera", broll: "B-roll", image: "Image", split: "Split screen", cutout: "Cutout", text: "Title card", graphic: "Graphic",
};
export const CAMERA_LABEL: Record<Shot["camera"], string> = {
  still: "Still", "zoom-in": "Slow zoom in", "zoom-out": "Zoom out", "punch-in": "Punch in", "pan-left": "Pan left", "pan-right": "Pan right", shake: "Shake",
};
export const TRANSITION_LABEL: Record<Shot["transition"], string> = {
  cut: "Cut", whip: "Whip", zoom: "Zoom", fade: "Fade", slide: "Slide", glitch: "Glitch", flash: "Flash",
};

/** What Claude is told about the user's answer, to build from (or to redraw). */
export function approvedPrompt(b: Storyboard): string {
  const dropped = b.shots.filter((s) => s.dropped).map((s) => s.id);
  const asks = b.shots.filter((s) => s.ask?.trim()).map((s) => `- ${s.id}: ${s.ask!.trim()}`);
  return [
    "The user approved the storyboard. notes/storyboard.json now holds their version (they may have changed shots): it is the plan.",
    "Build the video from it shot by shot: the same lines, order, layouts, looks, camera moves, transitions and sounds. Improve details freely, never the structure.",
    dropped.length ? `They took these shots out: ${dropped.join(", ")}. Leave their lines out of the cut.` : "",
    asks.length ? `Their notes on single shots:\n${asks.join("\n")}` : "",
    "Skip the plan step (the storyboard is the plan) and go on with the steps after it.",
  ].filter(Boolean).join("\n");
}

export function redrawPrompt(b: Storyboard, changes: string): string {
  const asks = b.shots.filter((s) => s.ask?.trim()).map((s) => `- ${s.id}: ${s.ask!.trim()}`);
  return [
    `The user looked at the storyboard and wants changes: ${changes.trim() || "(see their notes on shots)"}`,
    asks.length ? `Their notes on single shots:\n${asks.join("\n")}` : "",
    "notes/storyboard.json holds their version (they may have edited shots, or dropped some: keep those edits). Redraw it with the changes, same format, then stop and reply with one sentence on what changed. Don't build anything yet.",
  ].filter(Boolean).join("\n");
}
