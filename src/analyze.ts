// Step 1: learn what is in the video, locally. Metadata from ffprobe, word-timed transcript
// from whisper.cpp, pauses from ffmpeg's silencedetect. Results are cached per video.
import { hyperframesTranscript } from "./dictation.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Analysis, Word } from "./schema.ts";
import { find } from "./toolchain.ts";
import { round, run, workDir } from "./tools.ts";

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
    words = await transcribe(source, dir, log);
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
  const v = info.streams.find((s: any) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const hasAudio = info.streams.some((s: any) => s.codec_type === "audio");
  // Audio only (a podcast, a voice memo): width and height 0. Only Auto Edit takes these.
  if (!v && hasAudio) return { duration: round(Number(info.format.duration), 3), width: 0, height: 0, fps: 30, hasAudio };
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
    hasAudio,
  };
}

/**
 * Words with times. First choice whisper.cpp; if it's missing or fails, HyperFrames' transcriber;
 * if that fails too, no words (the edit goes on without a transcript: toolchain.ts FALLBACK).
 */
async function transcribe(source: string, dir: string, log: (m: string) => void): Promise<Word[]> {
  const wav = join(dir, "audio.wav");
  await run("ffmpeg", ["-y", "-v", "error", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  const whisper = find("whisper");
  if (whisper) {
    try {
      return await whisperWords(wav, join(dir, "transcript"), whisper.model!);
    } catch (e) {
      log(`analyze: Whisper failed (${String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 120)})`);
    }
  }
  const hyperframes = find("hyperframes");
  if (hyperframes) {
    log("analyze: Whisper isn't working, transcribing with HyperFrames instead");
    try {
      // It writes transcript.json ([{ text, start, end }]) into the folder it runs on.
      const folder = join(dir, "hf-transcribe");
      mkdirSync(folder, { recursive: true });
      await run(hyperframes.cmd, [...hyperframes.pre, "transcribe", wav, "--dir", folder, "--model", "small.en"]);
      const list = JSON.parse(readFileSync(hyperframesTranscript(folder), "utf8")) as Word[];
      return list.filter((w) => w.text?.trim()).map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }));
    } catch (e) {
      log(`analyze: HyperFrames' transcriber failed too (${String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 120)})`);
    }
  }
  log("analyze: no transcript (no working transcriber): captions are typed by hand and cuts follow the pauses");
  return [];
}

async function whisperWords(wav: string, outBase: string, model: string): Promise<Word[]> {
  await run("whisper-cli", ["-m", model, "-f", wav, "-ml", "1", "-sow", "-oj", "-of", outBase, "-np"]);
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
