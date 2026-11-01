// Whisper's word times can be off by ~0.2 s, so cuts placed on them leave dead air.
// This moves every segment edge onto the actual waveform: segment starts go to just before
// the voice begins, ends to just after it stops. Only edges next to a cut are touched.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Analysis, EditPlan } from "./schema.ts";
import { round, workDir } from "./tools.ts";

const FRAME = 0.01; // 10 ms loudness frames
const SEARCH = 0.4; // how far an edge may move, seconds
const PAD = 0.06; // breathing room kept around the voice
const QUIET_BELOW = 18; // dB under the clip's loud level counts as quiet

/** Loudness per 10 ms frame, in dBFS, from the 16 kHz mono wav made during analyze. */
function envelope(analysis: Analysis): Float32Array {
  const wav = readFileSync(join(workDir(analysis.source), "audio.wav"));
  const dataAt = wav.indexOf("data") + 8;
  const samples = new Int16Array(wav.buffer, wav.byteOffset + dataAt, (wav.length - dataAt) >> 1);
  const per = 16000 * FRAME;
  const out = new Float32Array(Math.floor(samples.length / per));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    for (let i = f * per; i < (f + 1) * per; i++) sum += (samples[i] / 32768) ** 2;
    out[f] = 10 * Math.log10(sum / per + 1e-10);
  }
  return out;
}

export function snapEdges(plan: EditPlan, analysis: Analysis): EditPlan {
  if (!analysis.hasAudio) return plan;
  const env = envelope(analysis);
  // "Loud" = the 90th percentile frame; quiet is relative to it, so music beds and quiet mics both work.
  const sorted = Array.from(env).sort((a, b) => a - b);
  const quiet = sorted[Math.floor(sorted.length * 0.9)] - QUIET_BELOW;
  const loud = (t: number) => (env[Math.round(t / FRAME)] ?? -100) > quiet;

  const segments = plan.segments.map((s, i) => {
    const prev = plan.segments[i - 1];
    const next = plan.segments[i + 1];
    let { start, end } = s;
    // A start is a cut unless it continues straight on from the previous segment.
    // Grow an edge only while the voice is still sounding at it (a clipped word);
    // otherwise shrink it onto the sound. Never reach into a neighbouring phrase.
    if (!(prev && Math.abs(prev.end - s.start) < 0.02)) {
      let t = start;
      if (loud(t)) while (t > start - SEARCH && t > 0 && loud(t - FRAME)) t -= FRAME;
      else while (t < start + SEARCH && !loud(t)) t += FRAME;
      if (loud(t) || t < start) start = Math.max(0, t - PAD);
    }
    if (!(next && Math.abs(next.start - s.end) < 0.02)) {
      let t = end;
      if (loud(t)) while (t < end + SEARCH && t < analysis.duration && loud(t + FRAME)) t += FRAME;
      else while (t > end - SEARCH && !loud(t)) t -= FRAME;
      if (loud(t) || t > end) end = Math.min(analysis.duration, t + PAD);
    }
    return end - start > 0.1 ? { ...s, start: round(start, 3), end: round(end, 3) } : s;
  });
  return { ...plan, segments };
}
