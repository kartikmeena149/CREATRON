// From rendered pictures and sound to the delivered file, and what a viewer gets from it.
//
// The sound is levelled on the plain WAV the render made (no video to demux, nothing to decode),
// the pictures are joined and the levelled sound encoded in ONE ffmpeg pass, and the result is
// measured in ONE pass (loudness, true peak, sample peak and clipping together). The old way muxed
// a raw file, re-read it for every loudness pass, rewrote it to level it, and decoded it three more
// times to check it.
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TARGET_LUFS, levelFilter } from "../loudness.ts";
import { validateProject } from "../project.ts";
import { round, run } from "../tools.ts";
import { DIR, P, fail, firstLine, rel } from "./context.ts";

export type Measured = { lufs: number; truePeak: number; samplePeak: number; clipped: number };

/** Integrated loudness only (what the levelling passes need): the lightest meter. */
async function lufs(file: string, chain = ""): Promise<number> {
  const { stderr } = await run("ffmpeg", ["-v", "info", "-nostats", "-i", file, "-vn", "-af", `${chain ? `${chain},` : ""}ebur128`, "-f", "null", "-"]);
  return Number(stderr.slice(stderr.lastIndexOf("Summary:")).match(/I:\s+(-?[\d.]+|-inf) LUFS/)?.[1]);
}

/** Everything about a file's sound in one decode: loudness, true peak, sample peak, clipped samples. */
export async function measure(file: string): Promise<Measured> {
  const { stderr } = await run("ffmpeg", [
    "-v", "info", "-nostats", "-i", file, "-vn",
    "-af", "ebur128=peak=true,astats=measure_overall=Peak_level:measure_perchannel=none,volumedetect", "-f", "null", "-",
  ]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  return {
    lufs: Number(summary.match(/I:\s+(-?[\d.]+|-inf) LUFS/)?.[1]),
    truePeak: Number(summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/)?.[1]),
    samplePeak: Number(stderr.match(/Peak level dB:\s*(-?[\d.]+|-inf)/)?.[1]),
    clipped: Number(stderr.match(/histogram_0db:\s*(\d+)/)?.[1] ?? 0),
  };
}

/**
 * The gain that lands the mix at -14 LUFS through the limiter: a fixed gain, measured again with the
 * limiter in place and corrected for what it took. On a WAV each pass is a fraction of a second.
 */
async function levelGain(wav: string): Promise<{ gain: number; before: number } | undefined> {
  const before = await lufs(wav);
  if (!Number.isFinite(before)) return undefined; // silence: nothing to level
  let gain = TARGET_LUFS - before;
  for (let pass = 0; pass < 4; pass++) {
    const now = await lufs(wav, levelFilter(gain));
    if (!Number.isFinite(now) || Math.abs(TARGET_LUFS - now) <= 0.2) break;
    gain += TARGET_LUFS - now;
  }
  return { gain, before };
}

/**
 * The delivered file: `pictures` (render pieces in order, or one video) with `sound` (a WAV; taken
 * from the video when there is none), levelled, AAC, fast start. Returns the measurement of the
 * result, so `check` doesn't decode it again.
 */
export async function finish(pictures: string[], sound: string | undefined, out: string): Promise<Measured | undefined> {
  const work = join(P.internal, "finish");
  mkdirSync(work, { recursive: true });
  try {
    let wav = sound;
    if (!wav) {
      wav = join(work, "sound.wav");
      await run("ffmpeg", ["-y", "-v", "error", "-i", pictures[0]!, "-vn", "-c:a", "pcm_s16le", "-ar", "48000", wav]);
    }
    // Levelling needs ffmpeg's loudness meter. Without it (the bundled backup ffmpeg has none) the
    // video is still exported, as mixed, and that is said in one line.
    let level: Awaited<ReturnType<typeof levelGain>>;
    try {
      level = await levelGain(wav);
    } catch (e) {
      console.log(`audio NOT levelled (${firstLine(e)}): exported as mixed. Keep speech clearly louder than music.`);
    }
    const input = pictures.length > 1 ? ["-f", "concat", "-safe", "0", "-i", list(work, pictures)] : ["-i", pictures[0]!];
    const part = `${out}.part.mp4`;
    const encode = (gain?: number) => run("ffmpeg", [
      "-y", "-v", "error", ...input, "-i", wav!, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
      ...(gain !== undefined ? ["-af", levelFilter(gain)] : []),
      "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest", "-movflags", "+faststart", part,
    ]);
    await encode(level?.gain);
    let m = await measure(part).catch(() => undefined);
    // AAC can push peaks back over the limiter's ceiling: give up a little loudness to stay under -1 dBTP.
    if (level && m && m.truePeak > -1) {
      level.gain -= m.truePeak + 1.2;
      await encode(level.gain);
      m = await measure(part).catch(() => undefined);
    }
    renameSync(part, out);
    if (level) console.log(`audio levelled: ${level.before} LUFS -> target ${TARGET_LUFS} (gain ${round(level.gain, 1)} dB)`);
    return m;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function list(work: string, files: string[]): string {
  const f = join(work, "pieces.txt");
  writeFileSync(f, files.map((x) => `file '${x.replace(/'/g, "'\\''")}'`).join("\n"));
  return f;
}

/** What a viewer gets: still editable?, length, loudness, peaks, clipping, and a sheet of frames to look at. */
export async function check(file: string, measured?: Measured) {
  const problems = validateProject(DIR);
  console.log(problems.length
    ? `EDITABLE: NO. Fix these (the result must stay hand-editable):\n${problems.map((p) => `- ${p}`).join("\n")}`
    : "EDITABLE: yes (source untouched, cuts and captions are values in project/timeline.json, all media local, README and render command present)");
  if (!existsSync(file)) fail(`${rel(file)} doesn't exist yet`);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]);
  const info = JSON.parse(stdout);
  const duration = Number(info.format.duration);
  const v = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  // The meters and the frame sheet read different parts of the file: side by side.
  const [m, sheet] = await Promise.all([
    measured ? Promise.resolve(measured) : measure(file).catch(() => undefined),
    frameSheet(file, duration),
  ]);
  console.log([
    `${rel(file)}: ${v ? `${v.width}x${v.height}, ` : ""}${round(duration, 2)} s`,
    m && Number.isFinite(m.lufs)
      ? `loudness ${m.lufs} LUFS (target ${TARGET_LUFS}), true peak ${m.truePeak} dBFS, sample peak ${m.samplePeak} dB, samples at 0 dB (clipped): ${m.clipped}`
      : "loudness: could not be measured with the ffmpeg in use (see `tools`)",
    sheet,
  ].join("\n"));
}

/**
 * 12 frames on one sheet. Each frame is read by seeking straight to it (a keyframe and a few frames
 * decoded), not by decoding the whole video to pick 12 frames out of it.
 */
async function frameSheet(file: string, duration: number): Promise<string> {
  mkdirSync(P.checks, { recursive: true });
  const out = join(P.checks, "sheet.jpg");
  const every = Math.max(1, duration / 12);
  const times = Array.from({ length: 12 }, (_, i) => Math.min(duration - 0.05, (i + 0.5) * (duration / 12)));
  const inputs = times.flatMap((t) => ["-ss", Math.max(0, t).toFixed(3), "-i", file]);
  const graph = `${times.map((_, i) => `[${i}:v]trim=end_frame=1,setpts=PTS-STARTPTS,scale=-2:480[f${i}]`).join(";")};${times.map((_, i) => `[f${i}]`).join("")}concat=n=12:v=1:a=0,tile=6x2:padding=6:color=white`;
  try {
    await run("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", graph, "-frames:v", "1", out]);
  } catch {
    // Some files don't seek cleanly: the slow way still works.
    try {
      await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-vf", `fps=1/${every.toFixed(3)},scale=-2:480,tile=6x2:padding=6:color=white`, "-frames:v", "1", out]);
    } catch (e) {
      return `no frame sheet (${firstLine(e)}): look at frames with \`still\` instead.`;
    }
  }
  return `notes/checks/sheet.jpg: 12 frames, one every ${round(every, 2)} s (left to right, top to bottom). Read it to look.`;
}
