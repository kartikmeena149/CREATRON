// Timeline tracks: Track 1 is the main video (the cut the AI edits and captions follow); every
// other lane is numbered by kind (Track 2, 3…, Text 1, 2…, Voiceover / Music / SFX 1, 2…) and
// can be renamed, muted or hidden. Export and preview both play effectivePlan(), so what you
// switch off on the timeline is switched off in the video too.
import type { EditPlan } from "./schema.ts";

export type TrackKind = "video" | "text" | "voice" | "music" | "sfx";
export const TRACK_KINDS: TrackKind[] = ["video", "text", "voice", "music", "sfx"];
const LABEL: Record<TrackKind, string> = { video: "Track", text: "Text", voice: "Voiceover", music: "Music", sfx: "SFX" };

export const trackKey = (kind: TrackKind | "captions", n?: number) => (kind === "captions" ? "captions" : `${kind}:${n}`);

/** Highest track number any clip of this kind sits on. */
function highestUsed(plan: EditPlan, kind: TrackKind): number {
  if (kind === "video") return Math.max(1, ...plan.broll.map((b) => b.track ?? 2));
  if (kind === "text") return Math.max(1, ...plan.motion.map((m) => m.track ?? 1));
  return Math.max(1, ...plan.voiceovers.filter((v) => (v.kind ?? "voice") === kind).map((v) => v.track ?? 1));
}

/** How many lanes of a kind the timeline shows: what the user added, or more if clips need them. */
export function trackCount(plan: EditPlan, kind: TrackKind): number {
  return Math.max(plan.tracks?.count?.[kind] ?? (kind === "video" ? 2 : 1), highestUsed(plan, kind));
}

export function trackName(plan: EditPlan, kind: TrackKind | "captions", n?: number): string {
  const custom = plan.tracks?.settings?.[trackKey(kind, n)]?.name;
  if (custom) return custom;
  return kind === "captions" ? "Captions" : `${LABEL[kind]} ${n}`;
}

export function trackSetting(plan: EditPlan, key: string) {
  return plan.tracks?.settings?.[key] ?? {};
}

/** True when a track has nothing on it (the main video track never counts as empty). */
export function trackEmpty(plan: EditPlan, kind: TrackKind, n: number): boolean {
  if (kind === "video") return n > 1 && !plan.broll.some((b) => (b.track ?? 2) === n);
  if (kind === "text") return !plan.motion.some((m) => (m.track ?? 1) === n);
  return !plan.voiceovers.some((v) => (v.kind ?? "voice") === kind && (v.track ?? 1) === n);
}

/** The lowest track of a kind with room from `at` for `length` seconds; a new track when all are busy. */
export function freeTrack(plan: EditPlan, kind: TrackKind, at: number, length: number): number {
  const busy = (n: number) => {
    const spans =
      kind === "video" ? plan.broll.filter((b) => (b.track ?? 2) === n)
      : kind === "text" ? plan.motion.filter((m) => (m.track ?? 1) === n)
      : plan.voiceovers.filter((v) => (v.kind ?? "voice") === kind && (v.track ?? 1) === n);
    return spans.some((c) => c.at < at + length && at < c.at + c.duration);
  };
  const count = trackCount(plan, kind);
  for (let n = kind === "video" ? 2 : 1; n <= count; n++) if (!busy(n)) return n;
  return count + 1;
}

/** Adds an empty lane of a kind at the top of its group. */
export function addTrack(plan: EditPlan, kind: TrackKind): EditPlan {
  const tracks = plan.tracks ?? { count: {}, settings: {} };
  return { ...plan, tracks: { ...tracks, count: { ...tracks.count, [kind]: trackCount(plan, kind) + 1 } } };
}

/** Removes an empty lane; clips on higher lanes of the same kind move down one. */
export function removeTrack(plan: EditPlan, kind: TrackKind, n: number): EditPlan {
  const min = kind === "video" ? 2 : 1;
  if (n < min || !trackEmpty(plan, kind, n)) return plan;
  const down = (t: number) => (t > n ? t - 1 : t);
  const tracks = plan.tracks ?? { count: {}, settings: {} };
  // Settings above the removed lane move down with their clips.
  const settings: typeof tracks.settings = {};
  for (const [key, value] of Object.entries(tracks.settings)) {
    const [k, num] = key.split(":");
    if (k !== kind) settings[key] = value;
    else if (Number(num) !== n) settings[`${k}:${down(Number(num))}`] = value;
  }
  return {
    ...plan,
    broll: kind === "video" ? plan.broll.map((b) => ({ ...b, track: down(b.track ?? 2) })) : plan.broll,
    motion: kind === "text" ? plan.motion.map((m) => ({ ...m, track: down(m.track ?? 1) })) : plan.motion,
    voiceovers: plan.voiceovers.map((v) => ((v.kind ?? "voice") === kind ? { ...v, track: down(v.track ?? 1) } : v)),
    tracks: { count: { ...tracks.count, [kind]: Math.max(min, trackCount(plan, kind) - 1) }, settings },
  };
}

export function setTrack(plan: EditPlan, key: string, patch: { name?: string; muted?: boolean; hidden?: boolean }): EditPlan {
  const tracks = plan.tracks ?? { count: {}, settings: {} };
  return { ...plan, tracks: { ...tracks, settings: { ...tracks.settings, [key]: { ...tracks.settings[key], ...patch } } } };
}

/**
 * The plan as it should play: clips on hidden or muted tracks taken out, the main audio
 * silenced when Track 1 is muted, and video clips ordered so higher tracks draw on top.
 */
export function effectivePlan(plan: EditPlan): EditPlan {
  const s = (key: string) => trackSetting(plan, key);
  return {
    ...plan,
    segments: s("video:1").muted ? plan.segments.map((seg) => ({ ...seg, volume: 0 })) : plan.segments,
    broll: plan.broll
      .filter((b) => !s(trackKey("video", b.track ?? 2)).hidden)
      .map((b, i) => ({ b, i }))
      .sort((x, y) => (x.b.track ?? 2) - (y.b.track ?? 2) || x.i - y.i)
      .map(({ b }) => b),
    motion: plan.motion
      .filter((m) => !s(trackKey("text", m.track ?? 1)).hidden)
      .map((m, i) => ({ m, i }))
      .sort((x, y) => (x.m.track ?? 1) - (y.m.track ?? 1) || x.i - y.i)
      .map(({ m }) => m),
    voiceovers: plan.voiceovers.filter((v) => !s(trackKey(v.kind ?? "voice", v.track ?? 1)).muted),
  };
}
