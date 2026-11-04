// What you can do to one clip on the timeline: the right-click menu and its shortcuts
// (⌘C / ⌘V copy-paste, ⌘D duplicate, S split, M mute, ⇧S remove silences, ⌫ delete).
// Every action is one undo step.
import { removePauses } from "../src/autocut.ts";
import type { Broll, Motion, Segment, Voiceover } from "../src/schema.ts";
import { outputDuration } from "../src/timeline.ts";
import { freeTrack } from "../src/tracks.ts";
import { locate, selectionOf, useEditor } from "./store.ts";

export type ClipRef =
  | { kind: "segment"; index: number }
  | { kind: "broll"; id: string }
  | { kind: "motion"; id: string }
  | { kind: "audio"; id: string };

/** The clip that's selected on the timeline, if any. */
export function selectedClip(): ClipRef | null {
  const s = useEditor.getState();
  if (s.selected !== null) return { kind: "segment", index: s.selected };
  if (s.selectedBroll) return { kind: "broll", id: s.selectedBroll };
  if (s.selectedMotion) return { kind: "motion", id: s.selectedMotion };
  if (s.selectedVo) return { kind: "audio", id: s.selectedVo };
  return null;
}

export function select(ref: ClipRef) {
  const s = useEditor.getState();
  if (ref.kind === "segment") s.select(ref.index);
  else if (ref.kind === "broll") s.selectBroll(ref.id);
  else if (ref.kind === "motion") s.selectMotion(ref.id);
  else s.selectVo(ref.id);
}

const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
type Free = Broll | Motion | Voiceover;
const listOf = { broll: "broll", motion: "motion", audio: "voiceovers" } as const;

function find(ref: ClipRef): Segment | Free | undefined {
  const { plan } = useEditor.getState();
  if (ref.kind === "segment") return plan.segments[ref.index];
  return (plan[listOf[ref.kind]] as Free[]).find((c) => c.id === ref.id);
}

/** Puts free clips (B-roll, text, audio) back into the plan, one undo step. */
function commitFree(kind: Exclude<ClipRef["kind"], "segment">, items: Free[]) {
  const s = useEditor.getState();
  s.commit({ ...s.plan, [listOf[kind]]: items });
}

/** Where a copy goes: this track if it has room there, otherwise the first free one. */
function placeCopy(kind: Exclude<ClipRef["kind"], "segment">, c: Free, at: number): Free {
  const plan = useEditor.getState().plan;
  const total = outputDuration(plan);
  const start = Math.max(0, Math.min(at, total - 0.2));
  const duration = Math.max(0.2, Math.min(c.duration, total - start));
  const trackKind = kind === "broll" ? "video" : kind === "motion" ? "text" : ((c as Voiceover).kind ?? "voice");
  const sameTrack = (plan[listOf[kind]] as Free[]).filter((x) => x.track === c.track);
  const fits = !sameTrack.some((x) => x.at < start + duration && start < x.at + x.duration);
  const track = fits ? c.track : freeTrack(plan, trackKind, start, duration);
  return { ...c, id: newId(kind[0]), at: start, duration, track };
}

export function duplicate(ref: ClipRef) {
  const s = useEditor.getState();
  if (ref.kind === "segment") {
    const seg = s.plan.segments[ref.index];
    if (!seg) return;
    const segments = [...s.plan.segments];
    segments.splice(ref.index + 1, 0, { ...seg });
    s.commit({ ...s.plan, segments });
    return s.select(ref.index + 1);
  }
  const c = find(ref) as Free | undefined;
  if (!c) return;
  const copy = placeCopy(ref.kind, c, c.at + c.duration);
  commitFree(ref.kind, [...(s.plan[listOf[ref.kind]] as Free[]), copy]);
  select({ kind: ref.kind, id: copy.id } as ClipRef);
}

/** Cuts the clip in two at the playhead (only when the playhead is inside it). */
export function split(ref: ClipRef) {
  const s = useEditor.getState();
  if (ref.kind === "segment") {
    // The main track splits at the playhead; move the playhead into the clip first if it isn't.
    const { index } = locate(s.plan, s.time);
    if (index !== ref.index) return;
    return s.split();
  }
  const c = find(ref) as Free | undefined;
  if (!c) return;
  const cut = s.time - c.at;
  if (cut < 0.2 || c.duration - cut < 0.2) return;
  const first = { ...c, duration: cut };
  const second = { ...c, id: newId(ref.kind[0]), at: s.time, duration: c.duration - cut, ...("offset" in c ? { offset: c.offset + cut } : {}) };
  const list = (s.plan[listOf[ref.kind]] as Free[]).flatMap((x) => (x.id === c.id ? [first, second] : [x]));
  commitFree(ref.kind, list as Free[]);
  select({ kind: ref.kind, id: second.id } as ClipRef);
}

export function remove(ref: ClipRef) {
  const s = useEditor.getState();
  if (ref.kind === "segment") return s.select(ref.index), s.deleteSelected();
  if (ref.kind === "broll") return s.deleteBroll(ref.id);
  if (ref.kind === "motion") return s.deleteMotion(ref.id);
  return s.deleteVoiceover(ref.id);
}

/** Everything with sound can be muted: main-track clips, B-roll videos and audio clips. */
export const canMute = (ref: ClipRef) => ref.kind !== "motion";
export const canHide = (ref: ClipRef) => ref.kind === "broll" || ref.kind === "motion";

export function isMuted(ref: ClipRef): boolean {
  const c = find(ref);
  if (!c) return false;
  if (ref.kind === "segment") return ((c as Segment).volume ?? 1) === 0;
  if (ref.kind === "broll") {
    // Unset: the user's own videos play their sound, stock B-roll is silent.
    const b = c as Broll;
    return b.muted ?? !b.source.startsWith("library:");
  }
  return Boolean((c as Voiceover).muted);
}
export const isHidden = (ref: ClipRef) => Boolean((find(ref) as Broll | Motion | undefined)?.hidden);

export function toggleMute(ref: ClipRef) {
  const s = useEditor.getState();
  if (ref.kind === "segment") return s.updateSegment(ref.index, { volume: isMuted(ref) ? 1 : 0 });
  if (ref.kind === "broll") s.updateBroll(ref.id, { muted: !isMuted(ref) });
  if (ref.kind === "audio") s.updateVoiceover(ref.id, { muted: !isMuted(ref) });
}

export function toggleHide(ref: ClipRef) {
  const s = useEditor.getState();
  if (ref.kind === "broll") s.updateBroll(ref.id, { hidden: !isHidden(ref) });
  else if (ref.kind === "motion") s.updateMotion(ref.id, { hidden: !isHidden(ref) });
}

/** Cuts the pauses out of just this clip (main track only). */
export function removeSilences(ref: ClipRef) {
  const s = useEditor.getState();
  if (ref.kind !== "segment" || !s.project) return;
  const seg = s.plan.segments[ref.index];
  if (!seg) return;
  const parts = removePauses({ ...s.plan, segments: [seg] }, s.project.analysis).segments;
  const segments = [...s.plan.segments];
  segments.splice(ref.index, 1, ...parts);
  if (parts.length === 1 && parts[0].start === seg.start && parts[0].end === seg.end) return;
  s.commit({ ...s.plan, segments });
  s.select(null);
}

let clipboard: { kind: ClipRef["kind"]; item: Segment | Free } | null = null;
export const hasClipboard = () => clipboard !== null;

export function copy(ref: ClipRef) {
  const c = find(ref);
  if (c) clipboard = { kind: ref.kind, item: structuredClone(c) };
}

/** Pastes at the playhead: a main-track clip goes in after the clip under the playhead. */
export function paste() {
  if (!clipboard) return;
  const s = useEditor.getState();
  if (clipboard.kind === "segment") {
    const segments = [...s.plan.segments];
    const at = segments.length ? locate(s.plan, s.time).index + 1 : 0;
    segments.splice(at, 0, { ...(clipboard.item as Segment) });
    s.commit({ ...s.plan, segments });
    return s.select(at);
  }
  const kind = clipboard.kind;
  const copy = placeCopy(kind, clipboard.item as Free, s.time);
  commitFree(kind, [...(s.plan[listOf[kind]] as Free[]), copy]);
  select({ kind, id: copy.id } as ClipRef);
}

/** Audio clips: a 1 s fade in or out, on or off. */
export const hasFade = (ref: ClipRef, which: "fadeIn" | "fadeOut") =>
  ref.kind === "audio" && ((find(ref) as Voiceover | undefined)?.[which] ?? 0) > 0;
export function toggleFade(ref: ClipRef, which: "fadeIn" | "fadeOut") {
  if (ref.kind !== "audio") return;
  const v = find(ref) as Voiceover | undefined;
  if (v) useEditor.getState().updateVoiceover(v.id, { [which]: hasFade(ref, which) ? 0 : Math.min(1, v.duration / 2) });
}

/** Text: switch between a big title and a lower third (custom animations keep their own look). */
export function setTextStyle(ref: ClipRef, template: "title" | "lower-third") {
  if (ref.kind === "motion") useEditor.getState().updateMotion(ref.id, { template });
}
export const textStyle = (ref: ClipRef) => (ref.kind === "motion" ? (find(ref) as Motion | undefined)?.template : undefined);

/** Every selected clip, when more than one is selected (box-select or ⇧-click). */
export function groupRefs(): ClipRef[] {
  const s = useEditor.getState();
  const { segments, ids } = selectionOf(s);
  if (segments.length + ids.length < 2) return [];
  const kindOf = (id: string): ClipRef =>
    s.plan.broll.some((b) => b.id === id) ? { kind: "broll", id } : s.plan.motion.some((m) => m.id === id) ? { kind: "motion", id } : { kind: "audio", id };
  return [...segments.map((index) => ({ kind: "segment" as const, index })), ...ids.map(kindOf)];
}

/** Mutes everything selected that has sound, or unmutes it all when it's all muted already. One undo step. */
export function toggleMuteGroup(refs = groupRefs()) {
  const s = useEditor.getState();
  const sound = refs.filter(canMute);
  if (!sound.length) return;
  const mute = sound.some((r) => !isMuted(r));
  const segs = new Set(sound.flatMap((r) => (r.kind === "segment" ? [r.index] : [])));
  const ids = new Set(sound.flatMap((r) => (r.kind === "segment" ? [] : [r.id])));
  s.commit({
    ...s.plan,
    segments: s.plan.segments.map((seg, i) => (segs.has(i) ? { ...seg, volume: mute ? 0 : 1 } : seg)),
    broll: s.plan.broll.map((b) => (ids.has(b.id) ? { ...b, muted: mute } : b)),
    voiceovers: s.plan.voiceovers.map((v) => (ids.has(v.id) ? { ...v, muted: mute } : v)),
  });
}

/** One volume for everything selected with a level: main-track clips (0–200%) and audio clips. */
export function setGroupVolume(percent: number, refs = groupRefs()) {
  const s = useEditor.getState();
  const segs = new Set(refs.flatMap((r) => (r.kind === "segment" ? [r.index] : [])));
  const ids = new Set(refs.flatMap((r) => (r.kind === "audio" ? [r.id] : [])));
  const db = percent <= 0 ? -24 : Math.max(-24, Math.min(12, 20 * Math.log10(percent / 100)));
  s.live({
    ...s.plan,
    segments: s.plan.segments.map((seg, i) => (segs.has(i) ? { ...seg, volume: percent / 100 } : seg)),
    voiceovers: s.plan.voiceovers.map((v) => (ids.has(v.id) ? { ...v, volumeDb: Math.round(db * 2) / 2 } : v)),
  });
}
