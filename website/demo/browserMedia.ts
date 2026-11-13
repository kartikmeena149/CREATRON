// What the desktop app learns about a video with ffmpeg, done in the page instead: size, length,
// frame strip, sound wave and the pauses in it. No transcript: speech-to-text needs the desktop app.
import type { Analysis } from "../../src/schema.ts";
import type { Thumbs, Wave } from "../../app/store.ts";

function openVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((done, fail) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.onloadedmetadata = () => (Number.isFinite(v.duration) && v.videoWidth ? done(v) : fail(new Error("That file has no picture this browser can read.")));
    v.onerror = () => fail(new Error("This browser can't play that file. Try an MP4."));
    v.src = url;
  });
}

const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((done) => {
    v.onseeked = () => done();
    v.currentTime = t;
  });

/** One sheet of small frames across the video, like electron/media.ts makes (fewer frames: each is a seek). */
async function strip(v: HTMLVideoElement): Promise<Thumbs> {
  const frameH = 72;
  const frameW = Math.round((frameH * v.videoWidth) / v.videoHeight / 2) * 2;
  const count = Math.min(60, Math.max(1, Math.ceil(v.duration)));
  const interval = v.duration / count;
  const cols = 10;
  const canvas = document.createElement("canvas");
  canvas.width = cols * frameW;
  canvas.height = Math.ceil(count / cols) * frameH;
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < count; i++) {
    await seek(v, Math.min(v.duration - 0.05, i * interval + 0.05));
    ctx.drawImage(v, (i % cols) * frameW, Math.floor(i / cols) * frameH, frameW, frameH);
  }
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.7));
  return { url: blob ? URL.createObjectURL(blob) : "", cols, frameW, frameH, interval, count };
}

const strips = new Map<string, Promise<Thumbs>>();
/** The frame strip of any video the page can play, made once per URL. */
export function filmstrip(url: string): Promise<Thumbs> {
  let p = strips.get(url);
  if (!p) strips.set(url, (p = openVideo(url).then(strip)));
  return p;
}

/** Peak level per time slice. Empty for files too big to decode in a tab, or with no sound. */
async function soundWave(file: Blob, duration: number): Promise<Wave> {
  if (file.size > 400e6) return { rate: 1, peaks: [] };
  try {
    const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await file.arrayBuffer());
    const per = Math.max(1, Math.floor(audio.sampleRate / Math.min(50, 20000 / duration)));
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    const peaks: number[] = [];
    for (let i = 0; i < audio.length; i += per) {
      let max = 0;
      for (const ch of channels) for (let j = i; j < Math.min(i + per, audio.length); j++) max = Math.max(max, Math.abs(ch[j]));
      peaks.push(Math.round(Math.min(1, max) * 1000) / 1000);
    }
    return { rate: audio.sampleRate / per, peaks };
  } catch {
    return { rate: 1, peaks: [] };
  }
}

/** Stretches of half a second or more where the sound stays quiet. */
function pauses(wave: Wave): Analysis["silences"] {
  const out: Analysis["silences"] = [];
  let from = -1;
  wave.peaks.forEach((p, i) => {
    const quiet = p < 0.03;
    if (quiet && from < 0) from = i;
    if ((!quiet || i === wave.peaks.length - 1) && from >= 0) {
      if ((i - from) / wave.rate >= 0.5) out.push({ start: from / wave.rate, end: i / wave.rate });
      from = -1;
    }
  });
  return out;
}

/** Everything the editor needs to open a video the visitor chose. The file never leaves the tab. */
export async function readVideo(url: string, name: string, file: Blob, say: (status: string) => void) {
  say("Reading the video");
  const v = await openVideo(url);
  say("Making thumbnails");
  const thumbs = await filmstrip(url);
  say("Reading the sound");
  const wave = await soundWave(file, v.duration);
  const analysis: Analysis = { source: name, duration: v.duration, width: v.videoWidth, height: v.videoHeight, fps: 30, hasAudio: wave.peaks.length > 0, words: [], silences: pauses(wave) };
  return { analysis, thumbs, wave };
}
