// The edit plan: the one contract between the AI, the timeline UI and the renderer.
// The model writes it, the user tweaks it, ffmpeg renders it. Times are in seconds
// of the SOURCE video unless a field says otherwise.
import { z } from "zod";

export const Segment = z
  .object({
    start: z.number().min(0).describe("Start of the kept part, seconds in the source"),
    end: z.number().positive().describe("End of the kept part, seconds in the source"),
    speed: z.number().min(0.5).max(2).default(1).describe("Playback speed, 0.5 to 2"),
    zoom: z.number().min(1).max(2).default(1).describe("Punch-in zoom, 1 = none, 1.2 = 20% closer"),
  })
  .refine((s) => s.end > s.start, { message: "end must be after start" });

/**
 * One caption, timed in SOURCE seconds so it stays on its words through any re-cut.
 * x / y, when set, move just this caption (added to the shared caption position).
 */
export const Caption = z.object({
  start: z.number().min(0),
  end: z.number().positive(),
  text: z.string(),
  x: z.number().min(-1).max(1).optional(),
  y: z.number().min(-1).max(1).optional(),
});
export type Caption = z.infer<typeof Caption>;

/** A generated voiceover clip on the A2 track. at/duration are output seconds; offset is seconds into the file. */
export const Voiceover = z.object({
  id: z.string(),
  file: z.string(),
  text: z.string().default(""),
  voice: z.string().default(""),
  at: z.number().min(0),
  offset: z.number().min(0).default(0),
  duration: z.number().positive(),
  length: z.number().positive().optional().describe("Full length of the file, so trims can't run past it"),
  volumeDb: z.number().min(-24).max(12).default(0),
});
export type Voiceover = z.infer<typeof Voiceover>;

/**
 * A stock clip shown over the main video on the V2 track (the original audio keeps playing).
 * at/duration are output seconds; offset is seconds into the clip. The AI sets source (a clip id
 * from search_broll), at and duration; the app downloads the clip and fills in file/length/credit.
 */
export const Broll = z.object({
  id: z.string().default(""),
  source: z.string().describe('Clip id from search_broll, e.g. "pexels:123456"'),
  atSource: z
    .number()
    .min(0)
    .optional()
    .describe("Transcript second where the B-roll should start (use this; the app converts it to the timeline)"),
  at: z.number().min(0).default(0).describe("Start on the edited timeline, seconds. Set by the app from atSource"),
  duration: z.number().min(0.5).max(15).describe("How long it shows, seconds (2-5 is typical)"),
  offset: z.number().min(0).default(0),
  file: z.string().optional(),
  length: z.number().positive().optional(),
  query: z.string().optional(),
  credit: z.string().optional(),
});
export type Broll = z.infer<typeof Broll>;

export const DEFAULT_CAPTIONS = {
  enabled: false,
  style: "bold" as const,
  wordsPerCaption: 3,
  x: 0,
  y: 0.2,
  size: 1,
  color: "#ffffff",
  uppercase: true,
};

export const EditPlan = z.object({
  version: z.literal(1),
  segments: z
    .array(Segment)
    .min(1)
    .describe("Parts of the source to keep, in playback order. Everything else is cut."),
  aspect: z
    .enum(["source", "9:16", "1:1", "16:9"])
    .default("source")
    .describe("Output frame shape. 9:16 for Reels/Shorts/TikTok."),
  // Where the video sits in the output frame. At scale 1 it exactly fills the frame (no bars);
  // x / y move it by a fraction of the frame's width / height, so 0.1 = 10% right / down.
  transform: z
    .object({
      scale: z.number().min(0.1).max(3).default(1).describe("1 = fill the frame, 1.5 = 50% bigger, 0.8 = smaller with bars"),
      x: z.number().min(-1).max(1).default(0).describe("Horizontal shift as a fraction of frame width; negative = left"),
      y: z.number().min(-1).max(1).default(0).describe("Vertical shift as a fraction of frame height; negative = up"),
      rotate: z.number().min(-180).max(180).default(0).describe("Rotation in degrees, clockwise"),
    })
    .default({ scale: 1, x: 0, y: 0, rotate: 0 }),
  captions: z
    .object({
      enabled: z.boolean(),
      style: z.enum(["bold", "minimal"]).default("bold"),
      wordsPerCaption: z.number().int().min(1).max(8).default(3),
      // Where captions sit: center of the text as a shift from the frame center, in fractions of the frame.
      x: z.number().min(-0.5).max(0.5).default(0),
      y: z.number().min(-0.5).max(0.5).default(0.2).describe("0.2 = a little below the middle; negative = higher"),
      size: z.number().min(0.4).max(3).default(1).describe("Text size multiplier"),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
      uppercase: z.boolean().default(true),
      // Absent = captions follow the transcript automatically. Present = the user's (or AI's) own captions.
      cues: z.array(Caption).optional().describe("Explicit captions in SOURCE seconds; set to fix wording or timing"),
    })
    .default(DEFAULT_CAPTIONS),
  audio: z
    .object({
      denoise: z.boolean().default(false).describe("Remove background hiss and hum from the voice"),
      clarity: z.number().min(0).max(6).default(0).describe("Presence boost in dB that makes speech cut through, 0-6"),
      normalize: z.boolean().default(true).describe("Level the export to -14 LUFS, the Reels/YouTube standard"),
      volumeDb: z.number().min(-12).max(12).default(0).describe("Extra volume in dB, used when normalize is off"),
      duckDb: z.number().min(-40).max(0).default(-14).describe("How much the original audio drops under a voiceover, dB"),
    })
    .default({ denoise: false, clarity: 0, normalize: true, volumeDb: 0, duckDb: -14 }),
  // Generated speech placed on the A2 track. Timed on the OUTPUT clock: it sits where you put it.
  voiceovers: z.array(Voiceover).default([]),
  broll: z.array(Broll).default([]).describe("Stock clips over the main video. Only use ids returned by search_broll."),
  notes: z.string().default("").describe("One or two sentences telling the user what you did and why"),
});

export type Segment = z.infer<typeof Segment>;
export type EditPlan = z.infer<typeof EditPlan>;

// What the analyze step learns about a video. Never leaves the user's machine as video;
// only this text goes to the model.
export type Word = { text: string; start: number; end: number };
export type Analysis = {
  source: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  words: Word[];
  silences: { start: number; end: number }[];
};

/** Checks a plan against the source it will be rendered from. Returns problems, empty when fine. */
export function checkPlan(plan: EditPlan, analysis: Analysis): string[] {
  const problems: string[] = [];
  plan.segments.forEach((s, i) => {
    if (s.end > analysis.duration + 0.05)
      problems.push(`segment ${i}: end ${s.end}s is past the video's end (${analysis.duration.toFixed(2)}s)`);
    if (s.end - s.start < 0.1) problems.push(`segment ${i}: shorter than 0.1s`);
  });
  return problems;
}
