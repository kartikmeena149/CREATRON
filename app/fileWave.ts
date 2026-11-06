// The sound wave of an audio file (music, sound effect, voiceover) for its clips on the timeline:
// decoded once per file in the page, kept only as peaks (like the main track's, 50 a second).
import { useEffect, useState } from "react";
import { mediaUrl } from "./format.ts";
import type { Wave } from "./store.ts";

const RATE = 50;
const waves = new Map<string, Promise<Wave>>();

async function decode(path: string): Promise<Wave> {
  const data = await (await fetch(mediaUrl(path))).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const audio = await ctx.decodeAudioData(data);
  const per = Math.max(1, Math.floor(audio.sampleRate / RATE));
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const peaks: number[] = [];
  for (let i = 0; i < audio.length; i += per) {
    let max = 0;
    for (const ch of channels) for (let j = i; j < Math.min(i + per, audio.length); j++) max = Math.max(max, Math.abs(ch[j]));
    peaks.push(Math.round(Math.min(1, max) * 1000) / 1000);
  }
  return { rate: audio.sampleRate / per, peaks };
}

/** The file's wave, once it's decoded (undefined until then, or if it can't be read). */
export function useFileWave(path: string): Wave | undefined {
  const [wave, setWave] = useState<Wave>();
  useEffect(() => {
    let gone = false;
    let p = waves.get(path);
    if (!p) {
      p = decode(path);
      waves.set(path, p);
      p.catch(() => waves.delete(path)); // try again next time
    }
    p.then((w) => !gone && setWave(w), () => {});
    return () => void (gone = true);
  }, [path]);
  return wave;
}
