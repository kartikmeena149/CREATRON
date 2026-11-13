// Prepares the clip the browser demo opens: node website/make-sample.ts <video>
// Writes website/public/sample/: a small web copy of the video, its frame strip and sample.json
// (the same analysis, thumbnails and waveform the desktop app makes on import).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { analyze } from "../src/analyze.ts";
import { run, workDir } from "../src/tools.ts";

const video = process.argv[2] && resolve(process.argv[2]);
if (!video || !existsSync(video)) {
  console.error("usage: node website/make-sample.ts <video>");
  process.exit(1);
}
const out = join(import.meta.dirname, "public", "sample");
mkdirSync(out, { recursive: true });

const a = await analyze(video);
const work = workDir(video);

// Frame strip: the same sheet electron/media.ts makes for the video track.
const frameH = 72;
const frameW = Math.round((frameH * a.width) / a.height / 2) * 2;
const interval = Math.max(1, a.duration / 150);
const count = Math.max(1, Math.ceil(a.duration / interval));
const cols = 10;
const strip = join(work, "thumbs.jpg");
if (!existsSync(strip))
  await run("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", `fps=1/${interval},scale=${frameW}:${frameH},tile=${cols}x${Math.ceil(count / cols)}`, "-frames:v", "1", "-q:v", "4", strip]);
copyFileSync(strip, join(out, "thumbs.jpg"));

// Waveform: peaks of the 16 kHz mono wav made during analysis.
let wave = { rate: 1, peaks: [] as number[] };
const wavPath = join(work, "audio.wav");
if (a.hasAudio && existsSync(wavPath)) {
  const wav = readFileSync(wavPath);
  const dataAt = wav.indexOf("data") + 8;
  const samples = new Int16Array(wav.buffer, wav.byteOffset + dataAt, (wav.length - dataAt) >> 1);
  const per = Math.max(1, Math.floor(16000 / Math.min(50, 20000 / a.duration)));
  for (let i = 0; i < samples.length; i += per) {
    let max = 0;
    for (let j = i; j < Math.min(i + per, samples.length); j++) max = Math.max(max, Math.abs(samples[j]));
    wave.peaks.push(Math.round((max / 32768) * 1000) / 1000);
  }
  wave.rate = 16000 / per;
}

// A copy small enough to stream: 720p, starts playing before it has fully loaded.
await run("ffmpeg", [
  "-y", "-v", "error", "-i", video, "-vf", "scale=-2:720", "-c:v", "libx264", "-crf", "27", "-preset", "slow", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", join(out, "video.mp4"),
]);

// Only the file's name goes to the web, never where it sits on this Mac.
const name = basename(video);
writeFileSync(join(out, "sample.json"), JSON.stringify({ name, analysis: { ...a, source: name }, thumbs: { cols, frameW, frameH, interval, count }, wave }));
console.log(`Sample ready: ${out}`);
