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

/** Music and sound-effect files. */
export const isAudio = (path: string) => /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(path);

/** Photos and pictures (PNG, JPEG, WebP, GIF): they go on video tracks as stills. Everything else in the library is video. */
/** A storyboard, script or notes the AI reads (not media). Matches src/documents.ts. */
export const isDocument = (path: string) => /\.(xlsx|xlsm|csv|tsv|txt|md|markdown|json|docx|doc|rtf|rtfd|odt|pages|pdf)$/i.test(path);
export const isImage = (path: string) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(path);

/** A voiceover made in the Voice page (saved in work/voiceovers). */
export const isGeneratedVoice = (path: string) => path.includes("/work/voiceovers/");

/**
 * URL the app's media:// handler serves a local file at (same as electron/media.ts). The browser
 * demo (website/demo) has no such handler and says where each file is itself.
 */
export const mediaUrl = (path: string) => window.creatron.mediaUrl?.(path) ?? `media://local/?p=${encodeURIComponent(path)}`;
