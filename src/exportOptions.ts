// Export settings: the frame size, frame rate, quality and codec of the finished video. Shared by
// the export window (presets, the size estimate) and the renderer. Pure, no Node or browser APIs.

export type ExportOptions = {
  /** Short side of the frame in pixels (1080 = 1080×1920 for a reel). */
  resolution: 720 | 1080 | 1440 | 2160;
  fps: 24 | 30 | 60;
  quality: "small" | "balanced" | "best";
  codec: "h264" | "hevc";
  /** Also save the sound as an mp3 next to the video. */
  mp3: boolean;
};

export type ExportPreset = { id: string; name: string; blurb: string; options: Omit<ExportOptions, "mp3"> };

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "reels", name: "Reels & Shorts", blurb: "What Instagram, TikTok and YouTube want", options: { resolution: 1080, fps: 30, quality: "balanced", codec: "h264" } },
  { id: "master", name: "Best quality", blurb: "4K master to keep or re-edit", options: { resolution: 2160, fps: 30, quality: "best", codec: "hevc" } },
  { id: "draft", name: "Quick share", blurb: "Small file for a fast look", options: { resolution: 720, fps: 30, quality: "small", codec: "h264" } },
];

export const DEFAULT_EXPORT: ExportOptions = { ...EXPORT_PRESETS[0].options, mp3: false };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The base frame (from the plan's aspect) scaled so its short side is `resolution`. */
export function exportSize(base: { width: number; height: number }, resolution: number): { width: number; height: number } {
  const k = resolution / Math.min(base.width, base.height);
  return { width: even(base.width * k), height: even(base.height * k) };
}

/** x264 / x265 quality (CRF): lower is better and bigger. */
export const crfFor = (o: Pick<ExportOptions, "quality" | "codec">) => ({ small: 25, balanced: 20, best: 17 })[o.quality] + (o.codec === "hevc" ? 3 : 0);

/** ffmpeg video encoder arguments. HEVC is tagged hvc1 so QuickTime and iPhones play it. */
export const encoderArgs = (o: ExportOptions) =>
  o.codec === "hevc"
    ? ["-c:v", "libx265", "-preset", "medium", "-crf", String(crfFor(o)), "-tag:v", "hvc1", "-x265-params", "log-level=error"]
    : ["-c:v", "libx264", "-preset", "medium", "-crf", String(crfFor(o))];

/** A rough file size in bytes: typical talking-head bitrates for these settings, plus the sound. */
export function estimateBytes(o: ExportOptions, size: { width: number; height: number }, seconds: number, audio: boolean): number {
  const mbps = { small: 3.5, balanced: 8, best: 14 }[o.quality] * ((size.width * size.height) / (1080 * 1920)) ** 0.75 * (o.fps / 30) ** 0.5 * (o.codec === "hevc" ? 0.6 : 1);
  return ((mbps * 1e6 + (audio ? 192e3 : 0)) * seconds) / 8;
}
