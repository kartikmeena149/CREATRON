// Serves local files to the editor over media://, with byte-range support so the
// <video> preview can seek. Also builds the timeline's thumbnail strip and waveform.
import { protocol } from "electron";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import type { Analysis } from "../src/schema.ts";
import { run, workDir } from "../src/tools.ts";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".mkv": "video/x-matroska", ".jpg": "image/jpeg", ".png": "image/png",
};

export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    // corsEnabled + the header below let Web Audio process the preview's sound (voice tweaks).
    { scheme: "media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

const CORS = { "Access-Control-Allow-Origin": "*" };

export const mediaUrl = (path: string) => `media://local/?p=${encodeURIComponent(path)}`;

export function handleMedia() {
  protocol.handle("media", (req) => {
    const path = new URL(req.url).searchParams.get("p");
    if (!path || !existsSync(path)) return new Response("not found", { status: 404 });
    const size = statSync(path).size;
    const type = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
    const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
    if (!range) {
      const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
      return new Response(body, { headers: { ...CORS, "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" } });
    }
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: {
        ...CORS,
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  });
}

export type Thumbs = { url: string; cols: number; frameW: number; frameH: number; interval: number; count: number };

/** One sprite sheet of small frames across the video, for the video track. Cached per video. */
export async function thumbnails(a: Analysis): Promise<Thumbs> {
  const frameH = 72;
  const frameW = Math.round((frameH * a.width) / a.height / 2) * 2;
  const interval = Math.max(1, a.duration / 150);
  const count = Math.max(1, Math.ceil(a.duration / interval));
  const cols = 10;
  const file = join(workDir(a.source), "thumbs.jpg");
  if (!existsSync(file))
    await run("ffmpeg", [
      "-y", "-v", "error", "-i", a.source,
      "-vf", `fps=1/${interval},scale=${frameW}:${frameH},tile=${cols}x${Math.ceil(count / cols)}`,
      "-frames:v", "1", "-q:v", "4", file,
    ]);
  return { url: mediaUrl(file), cols, frameW, frameH, interval, count };
}

export type Waveform = { rate: number; peaks: number[] };

/** Peak level per time slice (0..1) from the 16 kHz mono wav made during analysis. */
export function waveform(a: Analysis): Waveform {
  const wavPath = join(workDir(a.source), "audio.wav");
  if (!a.hasAudio || !existsSync(wavPath)) return { rate: 1, peaks: [] };
  const wav = readFileSync(wavPath);
  const dataAt = wav.indexOf("data") + 8;
  const samples = new Int16Array(wav.buffer, wav.byteOffset + dataAt, (wav.length - dataAt) >> 1);
  const rate = Math.min(50, 20000 / a.duration); // at most 20k points, even for long videos
  const per = Math.max(1, Math.floor(16000 / rate));
  const peaks: number[] = [];
  for (let i = 0; i < samples.length; i += per) {
    let max = 0;
    for (let j = i; j < Math.min(i + per, samples.length); j++) max = Math.max(max, Math.abs(samples[j]));
    peaks.push(Math.round((max / 32768) * 1000) / 1000);
  }
  return { rate: 16000 / per, peaks };
}
