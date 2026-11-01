// Loudness: every export lands at -14 LUFS integrated with true peak at or under -1.5 dBTP,
// the level Instagram, YouTube and TikTok play at. One-pass loudnorm can't do this: when the
// needed gain would push peaks over the ceiling it falls back to dynamic mode and undershoots.
// Instead: measure the edited audio, apply a fixed gain, catch peaks with a limiter, measure
// again and correct the gain for whatever the limiter took away. Audio-only passes are fast.
import type { Analysis, EditPlan, Segment } from "./schema.ts";
import { round, run } from "./tools.ts";

export const TARGET_LUFS = -14;
// alimiter works on sample peaks; the extra 0.5 dB covers inter-sample peaks and AAC encoding.
const LIMIT_DB = -2;

/** The per-segment audio chain: speed, 10 ms fades at every cut so joins don't click. */
export function segmentAudio(s: Segment, i: number): string {
  const fadeOut = Math.max((s.end - s.start) / s.speed - 0.01, 0).toFixed(3);
  return `[${i}:a]asetpts=PTS-STARTPTS,atempo=${s.speed},afade=t=in:d=0.01,afade=t=out:st=${fadeOut}:d=0.01,aresample=48000[a${i}]`;
}

/** Filter that takes the joined audio to the target level. */
export function levelFilter(gainDb: number): string {
  const limit = (10 ** (LIMIT_DB / 20)).toFixed(4);
  // level=disabled stops alimiter adding its own make-up gain on top of ours.
  return `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${limit}:attack=5:release=50:level=disabled`;
}

/** The voice tweaks from the plan, applied before levelling. Empty when nothing is switched on. */
export function voiceFilter(plan: EditPlan): string {
  const parts: string[] = [];
  if (plan.audio.denoise) parts.push("highpass=f=80", "afftdn=nr=12:nf=-40:tn=1");
  if (plan.audio.clarity > 0) parts.push(`equalizer=f=3500:t=q:w=1:g=${plan.audio.clarity}`);
  return parts.join(",");
}

/** Everything that happens to the joined audio: voice tweaks, then levelling (or manual volume). */
export async function audioChain(plan: EditPlan, analysis: Analysis, log = console.error): Promise<string> {
  const voice = voiceFilter(plan);
  const level = plan.audio.normalize
    ? levelFilter(await gainForTarget(plan, analysis, log))
    : levelFilter(plan.audio.volumeDb);
  return voice ? `${voice},${level}` : level;
}

/** Measures the edited audio (with an optional chain applied) and returns integrated LUFS and true peak. */
async function measureChain(plan: EditPlan, analysis: Analysis, chain: string) {
  const args: string[] = ["-v", "info", "-nostats"];
  for (const s of plan.segments) args.push("-ss", String(s.start), "-to", String(s.end), "-i", analysis.source);
  const filters = plan.segments.map(segmentAudio);
  const pads = plan.segments.map((_, i) => `[a${i}]`).join("");
  filters.push(`${pads}concat=n=${plan.segments.length}:v=0:a=1${chain ? `,${chain}` : ""},ebur128=peak=true[m]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[m]", "-f", "null", "-");
  const { stderr } = await run("ffmpeg", args);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const lufs = Number(summary.match(/I:\s+(-?[\d.]+|-inf) LUFS/)?.[1]);
  const peak = Number(summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/)?.[1]);
  return { lufs, peak };
}

/** Works out the gain that lands the edit on TARGET_LUFS after limiting. */
export async function gainForTarget(plan: EditPlan, analysis: Analysis, log = console.error): Promise<number> {
  // Measure after the voice tweaks so denoise and clarity are levelled too.
  const voice = voiceFilter(plan);
  const measure = (chain: string) => measureChain(plan, analysis, [voice, chain].filter(Boolean).join(","));
  const before = await measure("");
  if (!Number.isFinite(before.lufs)) return 0; // silent edit: nothing to level
  let gain = TARGET_LUFS - before.lufs;
  // The limiter eats more loudness the harder it is pushed, so correct until within 0.2 LU.
  let result = before.lufs;
  for (let pass = 0; pass < 4; pass++) {
    result = (await measure(levelFilter(gain))).lufs;
    if (!Number.isFinite(result) || Math.abs(TARGET_LUFS - result) <= 0.2) break;
    gain += TARGET_LUFS - result;
  }
  log(`loudness: ${before.lufs} LUFS -> ${result} LUFS (gain ${gain >= 0 ? "+" : ""}${round(gain, 1)} dB)`);
  return gain;
}
