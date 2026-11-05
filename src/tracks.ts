// Timeline tracks: Track 1 is the main video (the cut the AI edits and captions follow); every
// other lane is numbered by kind (Track 2, 3…, Text 1, 2…, Voiceover / Music / SFX 1, 2…) and
// can be renamed, muted or hidden. A track exists only while it has clips on it. Export and preview both play effectivePlan(), so what you
// switch off on the timeline is switched off in the video too.
import type { EditPlan } from "./schema.ts";

export type TrackKind = "video" | "text" | "voice" | "music" | "sfx";
export const TRACK_KINDS: TrackKind[] = ["video", "text", "voice", "music", "sfx"];
const LABEL: Record<TrackKind, string> = { video: "Track", text: "Text", voice: "Voiceover", music: "Music", sfx: "SFX" };

export const trackKey = (kind: TrackKind | "captions", n?: number) => (kind === "captions" ? "captions" : `${kind}:${n}`);

/** Track numbers clips of a kind sit on (B-roll starts at 2: Track 1 is the main video). */
function usedTracks(plan: EditPlan, kind: TrackKind): number[] {
  const list =
    kind === "video" ? plan.broll.map((b) => b.track ?? 2)
    : kind === "text" ? plan.motion.map((m) => m.track ?? 1)
    : plan.voiceovers.filter((v) => (v.kind ?? "voice") === kind).map((v) => v.track ?? 1);
  return [...new Set(list)].sort((a, b) => a - b);
}

/**
 * How many lanes of a kind the timeline shows. A track exists only while something is on it,
 * so this is the highest track in use (0 when there is none; Track 1 counts while the main
 * video has clips).
 */
export function trackCount(plan: EditPlan, kind: TrackKind): number {
  return Math.max(kind === "video" && plan.segments.length ? 1 : 0, ...usedTracks(plan, kind));
}

export function trackName(plan: EditPlan, kind: TrackKind | "captions", n?: number): string {
  const custom = plan.tracks?.settings?.[trackKey(kind, n)]?.name;
  if (custom) return custom;
  return kind === "captions" ? "Captions" : `${LABEL[kind]} ${n}`;
}

export function trackSetting(plan: EditPlan, key: string) {
  return plan.tracks?.settings?.[key] ?? {};
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
  return Math.max(count + 1, kind === "video" ? 2 : 1);
}

/**
 * Closes the gaps left when a track empties: Track 2, 4 become Track 2, 3, with each track's
 * name / mute / hide moving with it. Settings of tracks that no longer exist are dropped.
 * Returns the same plan when nothing changes.
 */
export function compactTracks(plan: EditPlan): EditPlan {
  const settings = plan.tracks?.settings ?? {};
  let next = plan;
  const kept: typeof settings = {};
  for (const [key, value] of Object.entries(settings)) if (key === "video:1" || key === "captions") kept[key] = value;
  for (const kind of TRACK_KINDS) {
    const base = kind === "video" ? 2 : 1;
    const used = usedTracks(plan, kind);
    const to = new Map(used.map((t, i) => [t, base + i]));
    for (const [from, n] of to) if (settings[`${kind}:${from}`]) kept[`${kind}:${n}`] = settings[`${kind}:${from}`];
    if (used.every((t, i) => t === base + i)) continue;
    const map = (t: number) => to.get(t) ?? t;
    if (kind === "video") next = { ...next, broll: next.broll.map((b) => ({ ...b, track: map(b.track ?? 2) })) };
    else if (kind === "text") next = { ...next, motion: next.motion.map((m) => ({ ...m, track: map(m.track ?? 1) })) };
    else next = { ...next, voiceovers: next.voiceovers.map((v) => ((v.kind ?? "voice") === kind ? { ...v, track: map(v.track ?? 1) } : v)) };
  }
  const same = Object.keys(kept).length === Object.keys(settings).length && Object.keys(kept).every((k) => kept[k] === settings[k]);
  if (next === plan && same) return plan;
  return { ...next, tracks: { settings: kept } };
}

export function setTrack(plan: EditPlan, key: string, patch: { name?: string; muted?: boolean; hidden?: boolean }): EditPlan {
  const settings = plan.tracks?.settings ?? {};
  return { ...plan, tracks: { settings: { ...settings, [key]: { ...settings[key], ...patch } } } };
}

/** A video the user brought in themselves (from the library or a pasted link), not one the AI found. */
export const userClip = (b: { source: string }) => b.source.startsWith("library:") || b.source.startsWith("link:");

/**
 * Whether a B-roll clip plays its own sound. Unset means: the user's own videos (library or
 * link) play their sound, stock and web B-roll the AI found stays silent. A muted track silences all.
 */
export function brollSound(plan: EditPlan, b: EditPlan["broll"][number]): boolean {
  if (trackSetting(plan, trackKey("video", b.track ?? 2)).muted) return false;
  return b.muted === undefined ? userClip(b) : !b.muted;
}

/**
 * The plan as it should play: hidden / muted clips and clips on hidden or muted tracks taken out, the main audio
 * silenced when Track 1 is muted, and video clips ordered so higher tracks draw on top.
 */
export function effectivePlan(plan: EditPlan): EditPlan {
  const s = (key: string) => trackSetting(plan, key);
  return {
    ...plan,
    segments: s("video:1").muted ? plan.segments.map((seg) => ({ ...seg, volume: 0 })) : plan.segments,
    broll: plan.broll
      .filter((b) => !b.hidden && !s(trackKey("video", b.track ?? 2)).hidden)
      .map((b) => ({ ...b, muted: !brollSound(plan, b) }))
      .map((b, i) => ({ b, i }))
      .sort((x, y) => (x.b.track ?? 2) - (y.b.track ?? 2) || x.i - y.i)
      .map(({ b }) => b),
    motion: plan.motion
      .filter((m) => !m.hidden && !s(trackKey("text", m.track ?? 1)).hidden)
      .map((m, i) => ({ m, i }))
      .sort((x, y) => (x.m.track ?? 1) - (y.m.track ?? 1) || x.i - y.i)
      .map(({ m }) => m),
    voiceovers: plan.voiceovers.filter((v) => !v.muted && !s(trackKey(v.kind ?? "voice", v.track ?? 1)).muted),
  };
}
