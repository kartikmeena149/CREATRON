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
  reframeX: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe("When cropping to a narrower aspect, horizontal center of the crop: 0 = left, 0.5 = middle, 1 = right"),
  captions: z
    .object({
      enabled: z.boolean(),
      style: z.enum(["bold", "minimal"]).default("bold"),
      wordsPerCaption: z.number().int().min(1).max(8).default(3),
    })
    .default({ enabled: false, style: "bold", wordsPerCaption: 3 }),
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
