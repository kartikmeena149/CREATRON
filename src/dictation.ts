// Dictation: what the user said into the mic, as text for a box in the app. The app records a
// 16 kHz mono WAV; this turns it into words on this Mac, through the toolchain wall like every
// other tool. First choice whisper.cpp, then HyperFrames' transcriber, then a one-line pointer to
// macOS's own dictation (Fn twice), which needs nothing from Creatro.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { find } from "./toolchain.ts";
import { run } from "./tools.ts";

/** Words Whisper should expect, so "B-roll" doesn't come back as "be roll". */
const VOCABULARY = "Creatro video edit. Hook, B-roll, captions, storyboard, cut, zoom, timeline, voiceover, LUFS, Remotion.";

const firstLine = (e: unknown) => String(e instanceof Error ? e.message : e).split("\n")[0]!.slice(0, 120);

/** Tidy up what a transcriber gives back: no [BLANK_AUDIO]-style tags, one line, single spaces. */
export function cleanSpeech(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]|\([^)]*(music|silence|blank|inaudible)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Where HyperFrames' transcriber left its words: the folder itself (now) or its assets/ (older versions). */
export function hyperframesTranscript(folder: string): string {
  const here = join(folder, "transcript.json");
  return existsSync(here) ? here : join(folder, "assets", "transcript.json");
}

export async function dictate(wav: Uint8Array): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "creatro-dictation-"));
  const file = join(dir, "speech.wav");
  writeFileSync(file, wav);
  const failed: string[] = [];
  try {
    const whisper = find("whisper");
    if (whisper) {
      try {
        await run("whisper-cli", ["-m", whisper.model!, "-f", file, "-l", "en", "-nt", "-np", "-otxt", "-of", join(dir, "speech"), "--prompt", VOCABULARY]);
        return cleanSpeech(readFileSync(join(dir, "speech.txt"), "utf8"));
      } catch (e) {
        failed.push(`Whisper failed (${firstLine(e)})`);
      }
    } else failed.push("Whisper isn't working");

    const hyperframes = find("hyperframes");
    if (hyperframes) {
      try {
        const folder = join(dir, "hf");
        await run(hyperframes.cmd, [...hyperframes.pre, "transcribe", file, "--dir", folder, "--model", "small.en"]);
        const words = JSON.parse(readFileSync(hyperframesTranscript(folder), "utf8")) as { text: string }[];
        return cleanSpeech(words.map((w) => w.text).join(" "));
      } catch (e) {
        failed.push(`HyperFrames' transcriber failed (${firstLine(e)})`);
      }
    }
    throw new Error(`${failed.join("; ")}. Press Fn twice to dictate with macOS instead.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
