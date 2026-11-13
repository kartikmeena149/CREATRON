// Creatron's timeline helper. It reads project/timeline.json (the plain, hand-editable values)
// and turns it into what the video components need. Don't put edit values in code: put them in
// timeline.json, so they stay editable by hand and in Creatron's timeline.
//
// All times in timeline.json are SOURCE seconds (seconds of the original recording). Because of
// that, changing a cut never breaks a caption: captions are placed through the cuts every time.
import data from "../../timeline.json";

export type Cut = { start: number; end: number };
export type Caption = { text: string; start: number; end: number; accent?: string };
export type Sound = { file: string; volume: number; at?: number };
export type Cutout = { file: string; ranges: [sourceStart: number, sourceEnd: number, fileStart: number][] };
export type Timeline = {
  name: string;
  width: number;
  height: number;
  fps: number;
  /** The original recording, relative to the project folder ("source/talk.mp4"). Never modified. */
  source: string;
  hasVideo: boolean;
  /** The parts of the source that are kept, in order. */
  cuts: Cut[];
  /** Captions as live text, timed to the source speech. */
  captions: Caption[];
  music: Sound | null;
  /** Sound effects: `at` is the moment they play, in OUTPUT seconds. */
  sfx: Sound[];
  cutout?: Cutout | null;
  colors: Record<string, string>;
  captionStyle: { font: string; size: number; bottom: number; uppercase: boolean; outline: number };
};

export const timeline = data as unknown as Timeline;
export const { fps, width, height, colors, captionStyle } = timeline;

/** Each cut on the output: its first frame and how many frames it runs. */
export const cutFrames = (() => {
  let from = 0;
  return timeline.cuts.map((c) => {
    const frames = Math.max(1, Math.round((c.end - c.start) * fps));
    const at = { cut: c, from, frames };
    from += frames;
    return at;
  });
})();

/** Length of the video in frames and seconds (the sum of the cuts). */
export const durationInFrames = Math.max(1, cutFrames.reduce((n, c) => n + c.frames, 0));
export const duration = durationInFrames / fps;

/** A moment of the source on the output, in seconds. Undefined when that moment was cut out. */
export function toOutput(sourceSeconds: number): number | undefined {
  for (const c of cutFrames) if (sourceSeconds >= c.cut.start && sourceSeconds < c.cut.end) return c.from / fps + (sourceSeconds - c.cut.start);
  return undefined;
}

/** The captions on the output timeline (seconds). A caption whose words were cut out is dropped. */
export const captions: Caption[] = timeline.captions.flatMap((c) => {
  const mid = toOutput((c.start + c.end) / 2);
  if (mid === undefined) return [];
  const start = toOutput(c.start) ?? mid - (c.end - c.start) / 2;
  return [{ ...c, start: Math.max(0, start), end: Math.min(duration, start + (c.end - c.start)) }];
});
