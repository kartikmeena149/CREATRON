// Loudness and the audio mix. Every export lands at -14 LUFS integrated with true peak at or
// under -1.5 dBTP, the level Instagram, YouTube and TikTok play at. One-pass loudnorm can't do
// this: when the needed gain would push peaks over the ceiling it falls back to dynamic mode and
// undershoots. Instead: measure the edited audio, apply a fixed gain, catch peaks with a limiter,
// measure again and correct the gain for whatever the limiter took away. Audio-only passes are fast.
//
// With voiceovers on A2, the original voice is first brought to the same speech level as the
// voiceovers (SPEECH_LUFS), dipped while a voiceover plays, mixed, and then the mix is levelled.
import { existsSync } from "node:fs";
import type { Analysis, EditPlan, Segment } from "./schema.ts";
import { round, run } from "./tools.ts";

export const TARGET_LUFS = -14;
/** The level generated voiceovers are made at, and that the original voice is matched to. */
export const SPEECH_LUFS = -18;
// alimiter works on sample peaks; the extra 1 dB covers inter-sample peaks and AAC encoding
// (layered voices make sharper peaks than a single voice).
const LIMIT_DB = -2.5;
const DUCK_RAMP = 0.25; // seconds to fade the original down/up around a voiceover

/** The per-segment audio chain: speed, 10 ms fades at every cut so joins don't click. */
export function segmentAudio(s: Segment, i: number): string {
  const fadeOut = Math.max((s.end - s.start) / s.speed - 0.01, 0).toFixed(3);
  const volume = (s.volume ?? 1) === 1 ? "" : `volume=${(s.volume ?? 1).toFixed(3)},`;
  return `[${i}:a]asetpts=PTS-STARTPTS,atempo=${s.speed},${volume}afade=t=in:d=0.01,afade=t=out:st=${fadeOut}:d=0.01,aresample=48000[a${i}]`;
}

/** Filter that takes the mix to the target level. */
export function levelFilter(gainDb: number): string {
  const limit = (10 ** (LIMIT_DB / 20)).toFixed(4);
  // level=disabled stops alimiter adding its own make-up gain on top of ours.
  return `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${limit}:attack=5:release=50:level=disabled`;
}

/** The voice tweaks from the plan, applied to the original audio. Empty when nothing is switched on. */
export function voiceFilter(plan: EditPlan): string {
  const parts: string[] = [];
  if (plan.audio.denoise) parts.push("highpass=f=80", "afftdn=nr=12:nf=-40:tn=1");
  if (plan.audio.clarity > 0) parts.push(`equalizer=f=3500:t=q:w=1:g=${plan.audio.clarity}`);
  return parts.join(",");
}

/** Voiceovers that will actually play (their file still exists). */
export const activeVoiceovers = (plan: EditPlan) => plan.voiceovers.filter((v) => existsSync(v.file));

/** ffmpeg volume expression that dips to duckDb while any voiceover plays, with short ramps. */
function duckExpression(plan: EditPlan): string {
  const vos = activeVoiceovers(plan);
  if (!vos.length || plan.audio.duckDb >= 0) return "";
  const r = DUCK_RAMP;
  const windows = vos.map(
    (v) => `clip((t-${(v.at - r).toFixed(3)})/${r},0,1)*clip((${(v.at + v.duration + r).toFixed(3)}-t)/${r},0,1)`,
  );
  const inside = windows.reduce((acc, w) => `max(${acc},${w})`);
  const g = (10 ** (plan.audio.duckDb / 20)).toFixed(4);
  return `volume='1-(1-${g})*${inside}':eval=frame`;
}

/**
 * From the joined original audio (src) and the voiceover inputs (starting at input index
 * firstVo) to one [mix]: voice tweaks, speech-level match, ducking, voiceovers placed in time.
 */
export function mixFilters(plan: EditPlan, src: string, firstVo: number, origGainDb: number): string[] {
  const vos = activeVoiceovers(plan);
  const orig = [voiceFilter(plan), origGainDb ? `volume=${origGainDb.toFixed(2)}dB` : "", duckExpression(plan)]
    .filter(Boolean)
    .join(",");
  if (!vos.length) return [`${src}${orig || "anull"}[mix]`];
  const filters = [`${src}${orig || "anull"},aformat=channel_layouts=stereo[orig]`];
  vos.forEach((v, k) => {
    const delay = Math.round(v.at * 1000);
    filters.push(
      `[${firstVo + k}:a]atrim=start=${v.offset.toFixed(3)}:duration=${v.duration.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `aresample=48000,aformat=channel_layouts=stereo,volume=${v.volumeDb}dB,adelay=${delay}:all=1[vo${k}]`,
    );
  });
  filters.push(`[orig]${vos.map((_, k) => `[vo${k}]`).join("")}amix=inputs=${vos.length + 1}:normalize=0:duration=first[mix]`);
  return filters;
}

/** Inputs for the voiceover files, in the order mixFilters expects them. */
export const voiceoverInputs = (plan: EditPlan) => activeVoiceovers(plan).flatMap((v) => ["-i", v.file]);

/** What the renderer needs: the original's speech-match gain and the final level filter for [mix]. */
export async function prepareAudio(plan: EditPlan, analysis: Analysis, log = console.error) {
  // Level the voice as recorded; each clip's own volume then applies on top. Otherwise a clip turned
  // down to 20% (or a muted one) would just make the leveling turn everything else up to compensate.
  const asRecorded = { ...plan, segments: plan.segments.map((s) => ({ ...s, volume: 1 })) };
  let origGainDb = 0;
  if (activeVoiceovers(plan).length && plan.audio.normalize) {
    // Match the original voice to the voiceovers so neither sounds louder than the other.
    const orig = await measure(asRecorded, analysis, { withVoiceovers: false, origGainDb: 0, tail: "" });
    if (Number.isFinite(orig.lufs)) origGainDb = SPEECH_LUFS - orig.lufs;
  }
  const level = plan.audio.normalize
    ? levelFilter(await gainForTarget(asRecorded, analysis, origGainDb, log))
    : levelFilter(plan.audio.volumeDb);
  return { origGainDb, level };
}

/** Measures the edited mix (with a chain applied after it): integrated LUFS and peak. */
async function measure(plan: EditPlan, analysis: Analysis, opts: { withVoiceovers: boolean; origGainDb: number; tail: string }) {
  const args: string[] = ["-v", "info", "-nostats"];
  for (const s of plan.segments) args.push("-ss", String(s.start), "-to", String(s.end), "-i", analysis.source);
  const p = opts.withVoiceovers ? plan : { ...plan, voiceovers: [] };
  args.push(...voiceoverInputs(p));
  const filters = plan.segments.map(segmentAudio);
  const pads = plan.segments.map((_, i) => `[a${i}]`).join("");
  filters.push(`${pads}concat=n=${plan.segments.length}:v=0:a=1[acat]`);
  filters.push(...mixFilters(p, "[acat]", plan.segments.length, opts.origGainDb));
  filters.push(`[mix]${opts.tail ? `${opts.tail},` : ""}ebur128=peak=true[m]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[m]", "-f", "null", "-");
  const { stderr } = await run("ffmpeg", args);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const lufs = Number(summary.match(/I:\s+(-?[\d.]+|-inf) LUFS/)?.[1]);
  const peak = Number(summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/)?.[1]);
  return { lufs, peak };
}

/** Works out the gain that lands the whole mix on TARGET_LUFS after limiting. */
export async function gainForTarget(plan: EditPlan, analysis: Analysis, origGainDb = 0, log = console.error): Promise<number> {
  const at = (tail: string) => measure(plan, analysis, { withVoiceovers: true, origGainDb, tail });
  const before = await at("");
  if (!Number.isFinite(before.lufs)) return 0; // silent edit: nothing to level
  let gain = TARGET_LUFS - before.lufs;
  // The limiter eats more loudness the harder it is pushed, so correct until within 0.2 LU.
  let result = before.lufs;
  for (let pass = 0; pass < 4; pass++) {
    result = (await at(levelFilter(gain))).lufs;
    if (!Number.isFinite(result) || Math.abs(TARGET_LUFS - result) <= 0.2) break;
    gain += TARGET_LUFS - result;
  }
  log(`loudness: ${before.lufs} LUFS -> ${result} LUFS (gain ${gain >= 0 ? "+" : ""}${round(gain, 1)} dB)`);
  return gain;
}
