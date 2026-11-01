// Step 1: learn what is in the video, locally. Metadata from ffprobe, word-timed transcript
// from whisper.cpp, pauses from ffmpeg's silencedetect. Results are cached per video.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Analysis, Word } from "./schema.ts";
import { round, run, whisperModel, workDir } from "./tools.ts";

export async function analyze(video: string, log = console.error): Promise<Analysis> {
  const source = resolve(video);
  const dir = workDir(source);
  const cached = join(dir, "analysis.json");
  if (existsSync(cached)) {
    log("analyze: using cached analysis");
    return JSON.parse(readFileSync(cached, "utf8")) as Analysis;
  }

  log("analyze: reading video info");
  const meta = await probe(source);

  let words: Word[] = [];
  let silences: Analysis["silences"] = [];
  if (meta.hasAudio) {
    log("analyze: transcribing with Whisper");
    words = await transcribe(source, dir);
    log(`analyze: ${words.length} words; finding pauses`);
    silences = await findSilences(source);
  }

  const analysis: Analysis = { source, ...meta, words, silences };
  writeFileSync(cached, JSON.stringify(analysis, null, 2));
  return analysis;
}

async function probe(source: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", source]);
  const info = JSON.parse(stdout);
  const v = info.streams.find((s: any) => s.codec_type === "video");
  if (!v) throw new Error("no video stream found");
  const [num, den] = String(v.avg_frame_rate || v.r_frame_rate).split("/").map(Number);
  // Phone footage often stores rotation as metadata; swap so width/height match what people see.
  const rotation = Math.abs(Number(v.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? 0));
  const turned = rotation === 90 || rotation === 270;
  return {
    duration: round(Number(info.format.duration), 3),
    width: turned ? v.height : v.width,
    height: turned ? v.width : v.height,
    fps: round(den ? num / den : num || 30, 3),
    hasAudio: info.streams.some((s: any) => s.codec_type === "audio"),
  };
}

async function transcribe(source: string, dir: string): Promise<Word[]> {
  const wav = join(dir, "audio.wav");
  await run("ffmpeg", ["-y", "-v", "error", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  const outBase = join(dir, "transcript");
  await run("whisper-cli", ["-m", whisperModel(), "-f", wav, "-ml", "1", "-sow", "-oj", "-of", outBase, "-np"]);
  const json = JSON.parse(readFileSync(`${outBase}.json`, "utf8"));

  // With -ml 1 each entry is roughly one word; pieces without a leading space continue the previous word.
  const words: Word[] = [];
  for (const t of json.transcription as { offsets: { from: number; to: number }; text: string }[]) {
    const raw = t.text;
    const text = raw.trim();
    if (!text || /^\[.*\]$/.test(text)) continue; // [BLANK_AUDIO], [Music] and the like
    const start = t.offsets.from / 1000;
    const end = t.offsets.to / 1000;
    const prev = words.at(-1);
    if (prev && !raw.startsWith(" ")) {
      prev.text += text;
      prev.end = end;
    } else words.push({ text, start, end });
  }
  return words;
}

async function findSilences(source: string): Promise<Analysis["silences"]> {
  const { stderr } = await run("ffmpeg", [
    "-v", "info", "-i", source, "-vn", "-af", "silencedetect=noise=-35dB:duration=0.4", "-f", "null", "-",
  ]);
  const silences: Analysis["silences"] = [];
  let start: number | undefined;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start !== undefined) {
      silences.push({ start: round(start), end: round(Number(e[1])) });
      start = undefined;
    }
  }
  return silences;
}
