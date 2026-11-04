/** 75.4 -> "01:15.40" */
export function timecode(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/** Ruler label: "0:05", "1:20" */
export function shortTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.round(t - m * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Music and sound-effect files (everything else in the library is video). */
export const isAudio = (path: string) => /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(path);

/** URL the app's media:// handler serves a local file at (same as electron/media.ts). */
export const mediaUrl = (path: string) => `media://local/?p=${encodeURIComponent(path)}`;
