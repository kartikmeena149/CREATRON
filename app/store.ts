// Editor state. The edit plan is the single source of truth: the viewer previews it, the
// timeline draws it, the inspector and the AI change it, and export renders it.
// Every change goes through history so anything (including an AI edit) can be undone.
import { create } from "zustand";
import { wholeVideo } from "../src/autocut.ts";
import { type Analysis, type Broll, type Caption, type CaptionLook, DEFAULT_CAPTIONS, type EditPlan, type Motion, type Segment, type Voiceover } from "../src/schema.ts";
import { captionLook, captionsOf, clipLength, clipStarts, editDuration, outputDuration, toSourceTime } from "../src/timeline.ts";
import { compactTracks, freeTrack, isEffectsTrack, spanFree, userClip } from "../src/tracks.ts";
import { effectDef, registerPresets } from "../motion/Effects.tsx";
import type { EffectPreset } from "../src/sceneEffects.ts";
import { nearestCut } from "./cuts.ts";
import type { Storyboard, Verdict } from "../src/storyboard.ts";
import { useFx } from "./fxState.ts";
import { AUDIO_KEYS, BROLL_KEYS, SEGMENT_KEYS, routeToKeys, shiftKeys } from "../src/keyframes.ts";
import { type LayerEdit, type Scene, voiceOf } from "../src/scene.ts";
import { loadFont } from "../motion/Overlay.tsx";
import type { ChatEvent, FullEditProgress, FullEditResult, Question, Step } from "../src/chatTypes.ts";

export type Thumbs = { url: string; cols: number; frameW: number; frameH: number; interval: number; count: number };
/** A generated voiceover; voiceId and speed say how it was made (older takes don't have them). */
export type VoiceTake = { file: string; duration: number; text: string; voice: string; at: number; language?: string; voiceId?: string; speed?: number };
export type LeftView = "media" | "clip" | "text" | "captions" | "audio" | "voice" | "sfx" | "effects";
export type Wave = { rate: number; peaks: number[] };
export type Project = { path: string; analysis: Analysis; videoUrl: string; thumbs: Thumbs; wave: Wave };

export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; before?: EditPlan; meta?: string }
  | { role: "error"; text: string }
  | AgentMessage;

/** A live Claude turn in the chat: its words and its steps in the order they happened. */
export type AgentMessage = {
  role: "agent";
  items: ({ kind: "text"; text: string } | { kind: "steps"; steps: Step[] })[];
  status: "working" | "waiting" | "done" | "error" | "stopped";
  started: number;
  ended?: number;
  question?: Question;
  /** What the user picked or typed for the question. */
  answer?: string;
  /** The timeline before and after this turn changed it (for Compare and Revert). */
  before?: EditPlan;
  after?: EditPlan;
  /** Reverted by the user (Restore brings the change back). */
  reverted?: boolean;
  model: string;
  error?: string;
  /** A full edit running in this turn: where it is (and when that was said, for the clock). */
  job?: FullEditProgress & { at: number };
  /** The finished full edit this turn made. */
  result?: FullEditResult;
  /** This turn's full edit drew a storyboard (round n): the card that opens it. */
  board?: number;
};

/** The storyboard of a full edit: what Claude drew, the user's edited copy, and where it stands. */
export type BoardState = {
  video: string;
  dir: string;
  round: number;
  draft: Storyboard;
  status: "waiting" | "redrawing" | "approved" | "closed";
  /** Made by the Storyboard creator from a script: no recording behind it (video is its job's key). */
  plan?: boolean;
  /** Every draft Claude made, oldest first, and the one shown: Undo and Redo step through them. */
  versions?: Storyboard[];
  at?: number;
  /** While redrawing: the shots being redrawn (none = the whole storyboard). */
  only?: string[];
  /** After a redraw: what Claude changed, and what it couldn't make and why; `saidFor` = the shots it was about. */
  said?: Verdict;
  saidFor?: string[];
  /** Why it stopped waiting, when it wasn't the user (Claude's usage limit, a failed run). */
  error?: string;
};

/**
 * The board state for a new draft from Claude: the newest of its drafts, shown. After a redraw of
 * picked shots, every other shot is the user's own as they left it (drawings and notes still on it),
 * and a picked shot Claude couldn't change keeps the user's drawing, to try another way.
 */
export function boardFromEvent(
  e: { board: Storyboard; dir: string; round: number; video: string; drafts?: Storyboard[]; said?: Verdict }, plan?: boolean, prev?: BoardState | null,
): BoardState {
  const versions = e.drafts?.length ? e.drafts : [e.board];
  const sent = prev?.status === "redrawing" && prev.dir === e.dir ? prev : undefined;
  let draft = e.board;
  if (sent?.only?.length) {
    const mine = new Map(sent.draft.shots.map((s) => [s.id, s]));
    const keepMine = (id: string) => !sent.only!.includes(id) || (e.said?.declined && !e.said.changed);
    draft = { ...draft, shots: draft.shots.map((s) => (keepMine(s.id) && mine.has(s.id) ? mine.get(s.id)! : s)) };
  }
  return { video: e.video, dir: e.dir, round: e.round, draft, status: "waiting", plan, versions, at: versions.length - 1, said: e.said, saidFor: sent ? sent.only ?? [] : undefined };
}

type State = {
  project?: Project;
  plan: EditPlan;
  past: EditPlan[];
  future: EditPlan[];
  selected: number | null;
  /** Clips picked for the AI (⇧/⌘-click adds more); the request then changes only these. */
  picked: number[];
  /** B-roll, text and audio clips in a multi-selection (box-select or ⇧-click), by id. */
  pickedIds: string[];
  /** Selects exactly these clips (main-track indices and clip ids); one clip is a normal selection. */
  setSelection(segments: number[], ids: string[]): void;
  /** ⇧-click: adds a clip to the selection or takes it out. */
  toggleInSelection(ref: { segment: number } | { id: string }): void;
  /** Deletes everything selected, one undo step. */
  deleteSelection(): void;
  time: number; // playhead, seconds on the OUTPUT timeline
  playing: boolean;
  pxPerSec: number;
  status: string;
  busy: boolean;
  messages: Message[];
  exporting: number | null; // 0..1 while exporting
  exported?: string;
  exportError?: string;

  load(p: Project): void;
  /** Replace the plan and record the previous one for undo. */
  commit(plan: EditPlan): void;
  /** Save the current plan for undo before a live drag/slider change. */
  checkpoint(): void;
  /** Change the plan without a history entry (during drags; call checkpoint first). */
  live(plan: EditPlan): void;
  undo(): void;
  redo(): void;
  select(i: number | null, part?: "picture" | "sound"): void;
  /** Which half of the selected main-track clip was clicked: its picture (Track 1) or its sound (Audio). */
  selectedPart: "picture" | "sound";
  /** ⇧/⌘-click: add a clip to (or take it out of) the picked set. */
  togglePick(i: number): void;
  seek(t: number): void;
  setPlaying(p: boolean): void;
  setZoom(pxPerSec: number): void;
  updateSegment(i: number, patch: Partial<Segment>, record?: boolean): void;
  split(): void;
  deleteSelected(): void;

  /** Selected caption (index into captionsOf), and which right-panel tab shows. */
  selectedCue: number | null;
  /** Videos in this project's library (the main video and any added for B-roll), by path. */
  library: string[];
  addToLibrary(path: string): void;
  /** Voiceovers made in the Voice page for this project, newest first. */
  voiceTakes: VoiceTake[];
  /** What's typed in the Voice page, kept while you switch pages or tabs. */
  voiceDraft: { text: string; speed: number; voiceId: string; language: string };
  /** Which page the left panel shows (null: panel hidden). */
  leftView: LeftView | null;
  selectCue(i: number | null): void;
  /** Change caption style/position (not the captions themselves). */
  setCaptionStyle(patch: Partial<EditPlan["captions"]>, record?: boolean): void;
  /** Change one caption. The first edit turns auto captions into the user's own list. */
  editCaption(i: number, patch: Partial<Caption>, record?: boolean): void;
  deleteCaption(i: number): void;
  /** Changes how one caption looks (font, size, colour, B/I/U/S, outline, behind the person). */
  setCaptionLook(i: number, patch: CaptionLook, record?: boolean): void;
  /** Gives every caption the look of caption i. */
  applyLookToAll(i: number): void;
  /** The person cut out of the main video (see-through), for "behind me" captions in the preview. */
  cutoutUrl: string | null;
  /** What's happening while the cutout is made ("finding you in the video"), or "" when idle. */
  cutoutStatus: string;
  /** Makes the cutout for the main video if it doesn't exist yet. */
  prepareCutout(): Promise<void>;
  /** New caption at the playhead, 2 s long (cut short if the clip ends sooner). */
  addCaption(): void;
  /** Throw away caption edits and follow the transcript again. */
  resetCaptions(): void;

  /** Selected B-roll clip on V2 (by id). */
  selectedBroll: string | null;
  selectBroll(id: string | null): void;
  updateBroll(id: string, patch: Partial<Broll>, record?: boolean): void;
  /** Puts a downloaded clip on V2 at `at` (default: the playhead), up to 5 s or what's left of the video. */
  addBroll(b: { file: string; length: number; source: string; query?: string; credit?: string; at?: number; duration?: number; track?: number }): void;
  deleteBroll(id: string): void;
  /** Spots pointed at on the video, sent with the next AI request. */
  markers: { n: number; time: number; x: number; y: number }[];
  /** Point mode: a click on the video drops a marker instead of moving the video. */
  pointing: boolean;
  addMarker(m: { time: number; x: number; y: number }): void;
  removeMarker(n: number): void;
  /** Selected title / lower third on M1 (by id). */
  selectedMotion: string | null;
  selectMotion(id: string | null): void;
  /** New text item at the playhead, 3 s long. */
  addMotion(template: Motion["template"], track?: number): void;
  /**
   * Adds an effect at `at` (default: the playhead) on an effects track with room, a new one when
   * there's none. Transition effects (flash, dip, blinds) are centred on the nearest cut within a
   * second and a half. Returns its id.
   */
  addEffect(effect: string, at?: number, opts?: { track?: number }): string;
  /** Changes a transition laid over a cut (one undo step unless record is false). */
  updateCutEffect(id: string, patch: Partial<EditPlan["cutEffects"][number]>, record?: boolean): void;
  removeCutEffect(id: string): void;
  updateMotion(id: string, patch: Partial<Motion>, record?: boolean): void;
  deleteMotion(id: string): void;
  /** Imported Claude edits by scene.json path (loaded once, never changed: edits live in the plan). */
  scenes: Record<string, Scene>;
  /** Families in Creatro's font library (fonts edits brought in), loaded into the page. */
  libraryFonts: string[];
  /** Loads the font library into the page (again after an import added fonts). */
  loadFontLibrary(): Promise<void>;
  /** Effects taken out of imported Claude edits (work/effects). */
  effectLibrary: EffectPreset[];
  loadEffectLibrary(): Promise<void>;
  /** A Claude edit waiting in the import dialog (its folder or .html). */
  sceneImport: string | null;
  /** The full edit's storyboard (the sheet shows it while boardOpen). */
  board: BoardState | null;
  boardOpen: boolean;
  /** Puts an imported edit on a Text track at `at` (default: the playhead), its sounds on SFX tracks, one undo step. Returns the clip's id. */
  addScene(file: string, scene: Scene, at?: number, opts?: { withoutVoice?: boolean }): string;
  /** Changes one layer of a scene clip: `fn` gets its current changes and returns the new ones. */
  editLayer(motionId: string, layerId: string, fn: (e: LayerEdit) => LayerEdit, record?: boolean): void;
  /** A clip inside an imported Claude edit (a shot, title, graphic): its scene clip and its id. */
  selectedClip: { scene: string; clip: string } | null;
  selectClip(sel: { scene: string; clip: string } | null): void;
  /** Selected voiceover clip on A2 (by id). */
  selectedVo: string | null;
  selectVo(id: string | null): void;
  /** Drops a generated voiceover onto A2 at the playhead. */
  /** An audio clip: a generated voiceover, or music / a sound effect from the library. */
  addVoiceover(v: { file: string; duration: number; text: string; voice: string; kind?: Voiceover["kind"]; track?: number; at?: number; volumeDb?: number }): void;
  updateVoiceover(id: string, patch: Partial<Voiceover>, record?: boolean): void;
  deleteVoiceover(id: string): void;

  set(partial: Partial<State>): void;
  say(m: Message): void;
  /** One event from the live chat with Claude, applied to its message (and the timeline). */
  agentEvent(e: ChatEvent, model: string): void;
  /** Records the answer to the open question. */
  answerQuestion(answer: string): void;
};

const placeholder: EditPlan = {
  version: 1,
  segments: [{ start: 0, end: 1, speed: 1, zoom: 1, volume: 1 }],
  aspect: "source",
  cutEffects: [],
  transform: { scale: 1, x: 0, y: 0, rotate: 0 },
  captions: { ...DEFAULT_CAPTIONS },
  audio: { denoise: false, clarity: 0, normalize: true, volumeDb: 0, duckDb: -14 },
  voiceovers: [],
  broll: [],
  motion: [],
  notes: "",
  tracks: { settings: {} },
};

/** Which segment the output time t falls in, and how far into the output that segment starts. */
/** Everything selected now: main-track clip indices and B-roll / text / audio clip ids. */
export function selectionOf(s: Pick<State, "picked" | "selected" | "pickedIds" | "selectedBroll" | "selectedMotion" | "selectedVo">) {
  const segments = s.picked.length ? s.picked : s.selected !== null ? [s.selected] : [];
  const single = [s.selectedBroll, s.selectedMotion, s.selectedVo].filter((x): x is string => Boolean(x));
  return { segments, ids: s.pickedIds.length ? s.pickedIds : single };
}

/**
 * The main-track clip at output time `t` and where it starts. In the gap before a clip it's that
 * clip, with `t` before `offset` (the caller shows black there).
 */
export function locate(plan: EditPlan, t: number): { index: number; offset: number } {
  const starts = clipStarts(plan);
  for (let i = 0; i < plan.segments.length; i++)
    if (t < starts[i] + clipLength(plan.segments[i]) || i === plan.segments.length - 1) return { index: i, offset: starts[i] };
  return { index: 0, offset: 0 };
}

export const useEditor = create<State>((set, get) => ({
  plan: placeholder,
  past: [],
  future: [],
  selected: null,
  picked: [],
  pickedIds: [],
  setSelection: (segments, ids) => {
    const s = get();
    if (segments.length + ids.length === 0) return set({ selected: null, picked: [], pickedIds: [], selectedBroll: null, selectedMotion: null, selectedClip: null, selectedVo: null, selectedCue: null });
    if (segments.length + ids.length === 1) {
      set({ pickedIds: [] });
      if (segments.length) return s.select(segments[0]);
      const id = ids[0];
      if (s.plan.broll.some((b) => b.id === id)) return s.selectBroll(id);
      if (s.plan.motion.some((m) => m.id === id)) return s.selectMotion(id);
      return s.selectVo(id);
    }
    set({ picked: [...segments].sort((a, b) => a - b), pickedIds: ids, selected: null, selectedBroll: null, selectedMotion: null, selectedClip: null, selectedVo: null, selectedCue: null });
  },
  toggleInSelection: (ref) => {
    const { segments, ids } = selectionOf(get());
    if ("segment" in ref) get().setSelection(segments.includes(ref.segment) ? segments.filter((i) => i !== ref.segment) : [...segments, ref.segment], ids);
    else get().setSelection(segments, ids.includes(ref.id) ? ids.filter((i) => i !== ref.id) : [...ids, ref.id]);
  },
  deleteSelection: () => {
    const s = get();
    const { segments, ids } = selectionOf(s);
    if (!segments.length && !ids.length) return;
    const gone = new Set(ids);
    s.commit({
      ...s.plan,
      segments: s.plan.segments.filter((_, i) => !segments.includes(i)),
      broll: s.plan.broll.filter((b) => !gone.has(b.id)),
      motion: s.plan.motion.filter((m) => !gone.has(m.id)),
      voiceovers: s.plan.voiceovers.filter((v) => !gone.has(v.id)),
    });
    set((st) => ({ selected: null, picked: [], pickedIds: [], selectedBroll: null, selectedMotion: null, selectedClip: null, selectedVo: null, time: Math.min(st.time, editDuration(st.plan)) }));
  },
  time: 0,
  playing: false,
  pxPerSec: 20,
  status: "",
  busy: false,
  messages: [],
  exporting: null,

  load: (project) =>
    set((s) => ({ library: s.library.includes(project.path) ? s.library : [project.path, ...s.library], project, plan: wholeVideo(project.analysis), markers: [], pointing: false, past: [], future: [], selected: null, picked: [], pickedIds: [], cutoutUrl: null, selectedCue: null, selectedVo: null, selectedBroll: null, time: 0, playing: false })),
  // Every change closes the gaps left by tracks that emptied, so tracks exist only while they hold clips.
  commit: (plan) => set((s) => ({ plan: compactTracks(plan), past: [...s.past, s.plan].slice(-200), future: [] })),
  checkpoint: () => set((s) => ({ past: [...s.past, s.plan].slice(-200), future: [] })),
  live: (plan) => set({ plan: compactTracks(plan) }),
  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev) return s;
      return { plan: prev, past: s.past.slice(0, -1), future: [s.plan, ...s.future], selected: null, picked: [], pickedIds: [], selectedCue: null, selectedVo: null, selectedBroll: null, selectedMotion: null, selectedClip: null };
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return { plan: next, past: [...s.past, s.plan], future: s.future.slice(1), selected: null, picked: [], pickedIds: [], selectedCue: null, selectedVo: null, selectedBroll: null, selectedMotion: null, selectedClip: null };
    }),
  selectedPart: "picture",
  select: (selected, part = "picture") =>
    set(selected === null ? { selected, picked: [], pickedIds: [] } : { selected, selectedPart: part, picked: [selected], pickedIds: [], selectedCue: null, selectedVo: null, selectedBroll: null, selectedMotion: null, selectedClip: null }),
  togglePick: (i) =>
    set((s) => {
      const picked = s.picked.includes(i) ? s.picked.filter((n) => n !== i) : [...s.picked, i].sort((a, b) => a - b);
      return { picked, selected: picked.length ? (picked.includes(i) ? i : picked.at(-1)!) : null, selectedCue: null, selectedVo: null, selectedBroll: null, selectedMotion: null, selectedClip: null };
    }),
  seek: (t) => set((s) => ({ time: Math.max(0, Math.min(t, editDuration(s.plan))) })),
  setPlaying: (playing) => set({ playing }),
  setZoom: (pxPerSec) => set({ pxPerSec: Math.max(2, Math.min(400, pxPerSec)) }),

  updateSegment: (i, patch, record = true) => {
    const { plan, time } = get();
    const at = clipStarts(plan)[i] ?? 0;
    const segments = plan.segments.map((s, n) => (n === i ? { ...s, ...routeToKeys(s, patch, SEGMENT_KEYS, time - at, clipLength(s)) } : s));
    (record ? get().commit : get().live)({ ...plan, segments });
  },

  // Cut the clip under the playhead in two (like pressing S in a pro editor).
  split: () => {
    const { plan, time } = get();
    const { index, offset } = locate(plan, time);
    const s = plan.segments[index];
    if (!s || time < offset) return; // in a gap: nothing to cut
    const at = s.start + (time - offset) * s.speed;
    if (at - s.start < 0.1 || s.end - at < 0.1) return;
    const segments = [...plan.segments];
    // The second half starts with no gap and no transition (those belong before the first half);
    // its keyframes move with the picture.
    const { gap: _, transition: __, ...rest } = s;
    segments.splice(index, 1, { ...s, end: at }, { ...rest, start: at, keys: shiftKeys(s.keys, -(time - offset)) });
    get().commit({ ...plan, segments });
    set({ selected: index + 1, picked: [index + 1] });
  },

  // Remove the selected clips (all ⇧-picked ones); everything after slides left (ripple delete).
  // Removing the last one leaves an empty timeline.
  // Deleting a main-track clip takes away only the half that was selected, like an editor with
  // picture and sound unlinked: its picture (black there, the sound plays on and nothing moves) or
  // its sound (silent there). Each leaves a gap on its lane. When the other half is already gone,
  // the whole clip goes and the rest closes up.
  deleteSelected: () => {
    const { plan, selected, picked, selectedPart, project } = get();
    if (selected === null) return;
    const chosen = new Set([selected, ...picked]);
    const hasSound = (s: Segment) => Boolean(project?.analysis.hasAudio) && s.sound !== false;
    const hasPicture = (s: Segment) => Boolean(project?.analysis.width) && s.picture !== false;
    const segments = plan.segments.flatMap((s, i) => {
      if (!chosen.has(i)) return [s];
      if (selectedPart === "picture" && hasPicture(s) && hasSound(s)) return [{ ...s, picture: false }];
      if (selectedPart === "sound" && hasSound(s) && hasPicture(s)) return [{ ...s, sound: false }];
      return [];
    });
    get().commit({ ...plan, segments });
    set((s) => ({ selected: null, picked: [], time: Math.min(s.time, editDuration(s.plan)) }));
  },

  selectedCue: null,
  leftView: "media",
  voiceTakes: [],
  voiceDraft: { text: "", speed: 1.067, voiceId: "kartik", language: "english" },
  library: [],
  addToLibrary: (path) => set((s) => (s.library.includes(path) ? s : { library: [...s.library, path] })),
  selectCue: (selectedCue) => set(selectedCue === null ? { selectedCue } : { selectedCue, selected: null, picked: [], pickedIds: [], selectedVo: null, selectedBroll: null, selectedMotion: null, selectedClip: null }),

  setCaptionStyle: (patch, record = true) => {
    const { plan } = get();
    (record ? get().commit : get().live)({ ...plan, captions: { ...plan.captions, ...patch } });
  },

  editCaption: (i, patch, record = true) => {
    const { plan, project } = get();
    if (!project) return;
    const cues = captionsOf(plan, project.analysis.words).map((c, n) => (n === i ? { ...c, ...patch } : c));
    get().setCaptionStyle({ cues }, record);
  },

  cutoutUrl: null,
  cutoutStatus: "",
  prepareCutout: async () => {
    const { project, cutoutUrl, cutoutStatus } = get();
    if (!project || cutoutUrl || cutoutStatus || !project.analysis.width) return;
    set({ cutoutStatus: "Finding you in the video…" });
    const r = await window.creatron.personCutout(project.path);
    // Only if the same video is still open (the tab may have changed meanwhile).
    if (get().project?.path !== project.path) return set({ cutoutStatus: "" });
    if (r.ok) set({ cutoutUrl: r.value.cutoutUrl, cutoutStatus: "" });
    else set({ cutoutStatus: "", messages: [...get().messages, { role: "error", text: r.error }] });
  },
  setCaptionLook: (i, patch, record = true) => {
    const { plan, project } = get();
    if (!project) return;
    const own = captionsOf(plan, project.analysis.words)[i]?.look ?? {};
    get().editCaption(i, { look: { ...own, ...patch } }, record);
  },
  applyLookToAll: (i) => {
    const { plan, project } = get();
    if (!project) return;
    const cues = captionsOf(plan, project.analysis.words);
    const { highlight: _, background, ...look } = captionLook(plan, cues[i]?.look, i);
    // The background colour has no captions-wide setting, so every caption carries it; so does a
    // spoken-word colour set on this caption itself (not one it takes from the accent palette).
    const highlight = cues[i]?.look?.highlight;
    const extra = { ...(highlight !== undefined ? { highlight } : {}), ...(background ? { background } : {}) };
    const keep = Object.keys(extra).length > 0;
    // Its place too: this caption's spot becomes everyone's, and their own nudges are cleared.
    const x = Math.max(-0.5, Math.min(0.5, plan.captions.x + (cues[i]?.x ?? 0)));
    const y = Math.max(-0.5, Math.min(0.5, plan.captions.y + (cues[i]?.y ?? 0)));
    get().setCaptionStyle({ ...look, x, y, cues: cues.map(({ look: _, x: _x, y: _y, ...c }) => (keep ? { ...c, look: extra } : c)) });
  },
  deleteCaption: (i) => {
    const { plan, project } = get();
    if (!project) return;
    const cues = captionsOf(plan, project.analysis.words).filter((_, n) => n !== i);
    get().setCaptionStyle({ cues });
    set({ selectedCue: null });
  },

  addCaption: () => {
    const { plan, project, time } = get();
    if (!project) return;
    const seg = plan.segments[locate(plan, time).index];
    if (!seg) return;
    const start = toSourceTime(plan, time);
    const end = Math.min(seg.end, start + 2 * seg.speed);
    if (end - start < 0.2) return;
    const cues = [...captionsOf(plan, project.analysis.words), { start, end, text: "New caption" }].sort((a, b) => a.start - b.start);
    get().setCaptionStyle({ cues, enabled: true });
    set({ selectedCue: cues.findIndex((c) => c.start === start && c.text === "New caption"), leftView: "captions" });
  },

  resetCaptions: () => {
    const { plan } = get();
    const { cues: _, ...rest } = plan.captions;
    get().commit({ ...plan, captions: rest });
    set({ selectedCue: null });
  },

  selectedBroll: null,
  selectBroll: (selectedBroll) =>
    set(selectedBroll === null ? { selectedBroll, pickedIds: [] } : { selectedBroll, selected: null, picked: [], pickedIds: [], selectedCue: null, selectedVo: null, selectedMotion: null, selectedClip: null }),
  updateBroll: (id, patch, record = true) => {
    const { plan, time } = get();
    const broll = plan.broll.map((b) => (b.id === id ? { ...b, ...routeToKeys(b, patch, BROLL_KEYS, time - b.at, b.duration) } : b));
    (record ? get().commit : get().live)({ ...plan, broll });
  },
  addBroll: (b) => {
    const { plan, time } = get();
    // Your own videos (library, pasted link) keep their full length, even past the end of the main
    // track (the edit gets longer). AI picks are kept short and inside the main track.
    const own = userClip(b);
    const at = Math.max(0, own ? (b.at ?? time) : Math.min(b.at ?? time, outputDuration(plan) - 0.5));
    const duration = Math.max(0.5, Math.min(b.duration ?? 5, b.length, own ? Infinity : Math.min(15, outputDuration(plan) - at)));
    const id = `b${Math.random().toString(36).slice(2, 10)}`;
    // Never on top of another clip: a busy spot on the asked-for track sends it to a free track.
    const want = b.track ?? 2;
    const track = spanFree(plan, "video", want, at, duration) ? want : freeTrack(plan, "video", at, duration);
    const clip: Broll = { id, track, source: b.source, at, duration, offset: 0, file: b.file, length: b.length, query: b.query, credit: b.credit };
    get().commit({ ...plan, broll: [...plan.broll, clip] });
    set({ selectedBroll: id, selected: null, picked: [], selectedCue: null, selectedVo: null });
  },
  deleteBroll: (id) => {
    const { plan } = get();
    get().commit({ ...plan, broll: plan.broll.filter((b) => b.id !== id) });
    set({ selectedBroll: null });
  },

  markers: [],
  pointing: false,
  addMarker: (m) => set((s) => ({ markers: [...s.markers, { ...m, n: Math.max(0, ...s.markers.map((x) => x.n)) + 1 }] })),
  removeMarker: (n) => set((s) => ({ markers: s.markers.filter((m) => m.n !== n) })),

  selectedMotion: null, selectedClip: null,
  selectMotion: (selectedMotion) =>
    set(selectedMotion === null ? { selectedMotion, pickedIds: [] } : { selectedMotion, selected: null, picked: [], pickedIds: [], selectedCue: null, selectedVo: null, selectedBroll: null, selectedClip: null }),
  addEffect: (effect, at0, opts) => {
    const { plan, time } = get();
    const def = effectDef(effect);
    if (!def) return "";
    const duration = def.duration;
    let at = Math.max(0, at0 ?? time);
    // A transition goes on the nearest cut (within a second and a half), as a mark on that cut:
    // no clip, no track. One cut holds one of them; a new one replaces it.
    if (def.category === "transition") {
      const near = nearestCut(plan, get().scenes, at);
      const cut = near !== undefined && Math.abs(near - at) <= 1.5 ? near : at;
      const id = `c${Math.random().toString(36).slice(2, 10)}`;
      const others = (plan.cutEffects ?? []).filter((c) => Math.abs(c.at - cut) > 0.02);
      get().commit({ ...plan, cutEffects: [...others, { id, effect, at: Math.round(cut * 1000) / 1000, duration, ...(def.color ? { color: def.color } : {}), intensity: 1 }] });
      useFx.setState({ cutFx: id, cut: null, tab: "transitions" });
      set({ selectedMotion: null, selectedClip: null, leftView: "effects" });
      return id;
    }
    // An effects track with room there (one that holds only effects), else a new one on top.
    const fxTracks = [...new Set(plan.motion.map((m) => m.track ?? 1))].filter((t) => isEffectsTrack(plan, t)).sort((a, b) => a - b);
    const free = (t: number) => plan.motion.filter((m) => (m.track ?? 1) === t).every((m) => at + duration <= m.at + 1e-3 || at >= m.at + m.duration - 1e-3);
    const track = opts?.track !== undefined && isEffectsTrack(plan, opts.track) && free(opts.track) ? opts.track
      : fxTracks.find(free) ?? Math.max(0, ...plan.motion.map((m) => m.track ?? 1)) + 1;
    const id = `m${Math.random().toString(36).slice(2, 10)}`;
    const item: Motion = { id, track, template: "effect", effect, props: { intensity: 1 }, at, duration, color: def.color ?? "#000000", text: def.name, subtext: "" };
    get().commit({ ...plan, motion: [...plan.motion, item] });
    set({ selectedMotion: id, selected: null, picked: [], pickedIds: [], selectedCue: null, selectedVo: null, selectedBroll: null, selectedClip: null, leftView: "effects" });
    return id;
  },
  updateCutEffect: (id, patch, record = true) => {
    const { plan } = get();
    (record ? get().commit : get().live)({ ...plan, cutEffects: (plan.cutEffects ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  },
  removeCutEffect: (id) => {
    const { plan } = get();
    get().commit({ ...plan, cutEffects: (plan.cutEffects ?? []).filter((c) => c.id !== id) });
    useFx.setState({ cutFx: null });
  },
  addMotion: (template, track) => {
    const { plan, time } = get();
    const id = `m${Math.random().toString(36).slice(2, 10)}`;
    const at = Math.max(0, time);
    const item: Motion = {
      id, track: track && spanFree(plan, "text", track, at, 3) ? track : freeTrack(plan, "text", at, 3), template, props: {}, at, duration: 3, color: "#facc15",
      text: template === "title" ? "Your title" : "Your name", subtext: template === "title" ? "" : "What you do",
    };
    get().commit({ ...plan, motion: [...plan.motion, item] });
    set({ selectedMotion: id, selected: null, picked: [], selectedCue: null, selectedVo: null, selectedBroll: null });
  },
  updateMotion: (id, patch, record = true) => {
    const { plan } = get();
    const before = plan.motion.find((m) => m.id === id);
    const motion = plan.motion.map((m) => (m.id === id ? { ...m, ...patch } : m));
    // A scene's own sounds (ids "<scene id>-a…") move with it.
    // Its content starts at `at - offset`: a trim at the start (both change) leaves them in place.
    const shift = before?.template === "scene" && patch.at !== undefined ? patch.at - before.at - ((patch.offset ?? before.offset ?? 0) - (before.offset ?? 0)) : 0;
    const voiceovers = shift ? plan.voiceovers.map((v) => (v.id.startsWith(`${id}-a`) ? { ...v, at: Math.max(0, v.at + shift) } : v)) : plan.voiceovers;
    (record ? get().commit : get().live)({ ...plan, motion, voiceovers });
  },
  deleteMotion: (id) => {
    const { plan, selectedClip } = get();
    const gone = plan.motion.find((m) => m.id === id)?.template === "scene";
    get().commit({ ...plan, motion: plan.motion.filter((m) => m.id !== id), voiceovers: gone ? plan.voiceovers.filter((v) => !v.id.startsWith(`${id}-a`)) : plan.voiceovers });
    set({ selectedMotion: null, ...(selectedClip?.scene === id ? { selectedClip: null } : {}) });
  },

  scenes: {},
  sceneImport: null,
  board: null,
  boardOpen: false,
  libraryFonts: [],
  effectLibrary: [],
  loadEffectLibrary: async () => {
    const list = await window.creatron.effectLibrary();
    registerPresets(list);
    set({ effectLibrary: list });
  },
  loadFontLibrary: async () => {
    const list = await window.creatron.fontLibrary();
    await Promise.all(list.map(loadFont));
    set({ libraryFonts: [...new Set(list.map((f) => f.family))].sort() });
  },
  addScene: (file, scene, at, opts) => {
    const { plan, time } = get();
    const id = `m${Math.random().toString(36).slice(2, 10)}`;
    const start = Math.max(0, at ?? time);
    const item: Motion = {
      id, track: freeTrack(plan, "text", start, scene.duration), template: "scene", scene: file, layers: {}, offset: 0, props: {},
      at: start, duration: Math.max(0.5, scene.duration), color: "#7c5cff", text: scene.name.slice(0, 200), subtext: "",
    };
    const dir = file.replace(/\/[^/]*$/, "");
    let next = { ...plan, motion: [...plan.motion, item] };
    // Each sound on the first SFX track with room at its time.
    // The voiceover is left out when it's already the main track's sound (a new project made from the edit).
    const voice = opts?.withoutVoice ? voiceOf(scene) : undefined;
    scene.audio.forEach((a, i) => {
      if (a === voice) return;
      const vo: Voiceover = {
        id: `${id}-a${i}`, kind: "sfx", track: freeTrack(next, "sfx", start + a.at, a.duration), file: `${dir}/${a.file}`, text: a.name, voice: "",
        at: start + a.at, offset: a.offset, duration: a.duration, volumeDb: Math.max(-24, Math.min(12, Math.round(20 * Math.log10(Math.max(0.01, a.volume)) * 10) / 10)),
      };
      next = { ...next, voiceovers: [...next.voiceovers, vo] };
    });
    set((s) => ({ scenes: { ...s.scenes, [file]: scene } }));
    get().commit(next);
    // Its flashes, wipes and looks join the effects library (the ones the library doesn't have).
    void window.creatron.extractEffects(file).then(() => get().loadEffectLibrary());
    set({ selectedMotion: id, selected: null, picked: [], pickedIds: [], selectedCue: null, selectedVo: null, selectedBroll: null });
    return id;
  },
  selectClip: (selectedClip) =>
    set(selectedClip === null ? { selectedClip } : { selectedClip, selected: null, picked: [], pickedIds: [], selectedCue: null, selectedVo: null, selectedBroll: null, selectedMotion: null }),
  editLayer: (motionId, layerId, fn, record = true) => {
    const { plan } = get();
    const motion = plan.motion.map((m) => {
      if (m.id !== motionId) return m;
      const layers = { ...m.layers };
      const e = fn(layers[layerId] ?? {});
      if (Object.values(e).every((v) => v === undefined)) delete layers[layerId];
      else layers[layerId] = e;
      return { ...m, layers };
    });
    (record ? get().commit : get().live)({ ...plan, motion });
  },

  selectedVo: null,
  selectVo: (selectedVo) => set(selectedVo === null ? { selectedVo, pickedIds: [] } : { selectedVo, selected: null, picked: [], pickedIds: [], selectedCue: null, selectedBroll: null, selectedMotion: null, selectedClip: null }),

  addVoiceover: (v) => {
    const { plan, time } = get();
    const id = Math.random().toString(36).slice(2, 10);
    const at = Math.max(0, v.at ?? time);
    // Music stops where the edit ends (a long song shouldn't make the video longer); voiceovers and
    // sound effects keep their full length, even past the end.
    const end = editDuration(plan);
    const duration = v.kind === "music" && end - at > 1 ? Math.min(v.duration, end - at) : v.duration;
    const kind = v.kind ?? "voice";
    const want = v.track ?? 1;
    const track = spanFree(plan, kind, want, at, duration) ? want : freeTrack(plan, kind, at, duration);
    const vo: Voiceover = {
      id, kind, track, file: v.file, text: v.text, voice: v.voice,
      at, offset: 0, duration, length: v.duration, volumeDb: v.volumeDb ?? 0,
    };
    get().commit({ ...plan, voiceovers: [...plan.voiceovers, vo] });
    set({ selectedVo: id, selected: null, picked: [], selectedCue: null });
  },

  updateVoiceover: (id, patch, record = true) => {
    const { plan, time } = get();
    const voiceovers = plan.voiceovers.map((v) => (v.id === id ? { ...v, ...routeToKeys(v, patch, AUDIO_KEYS, time - v.at, v.duration) } : v));
    (record ? get().commit : get().live)({ ...plan, voiceovers });
  },

  deleteVoiceover: (id) => {
    const { plan } = get();
    get().commit({ ...plan, voiceovers: plan.voiceovers.filter((v) => v.id !== id) });
    set({ selectedVo: null });
  },

  set: (partial) => set(partial),
  say: (m) => set((s) => ({ messages: [...s.messages, m] })),
  agentEvent: (e, model) => {
    const s = get();
    const msgs = [...s.messages];
    if (e.type === "start") return set({ busy: true, messages: [...msgs, { role: "agent", items: [], status: "working", started: Date.now(), model }] });
    const i = msgs.findLastIndex((m) => m.role === "agent");
    if (i < 0) return;
    const m = { ...(msgs[i] as AgentMessage) };
    m.items = [...m.items];
    const last = m.items.at(-1);
    if (e.type === "text") {
      if (last?.kind === "text") m.items[m.items.length - 1] = { kind: "text", text: last.text + e.delta };
      else if (e.delta.trim()) m.items.push({ kind: "text", text: e.delta.trimStart() });
    } else if (e.type === "step") {
      const at = m.items.findIndex((it) => it.kind === "steps" && it.steps.some((x) => x.id === e.step.id));
      if (at >= 0) {
        const it = m.items[at] as { kind: "steps"; steps: Step[] };
        m.items[at] = { kind: "steps", steps: it.steps.map((x) => (x.id === e.step.id ? e.step : x)) };
      } else if (last?.kind === "steps") m.items[m.items.length - 1] = { kind: "steps", steps: [...last.steps, e.step] };
      else m.items.push({ kind: "steps", steps: [e.step] });
    } else if (e.type === "job") {
      m.job = { ...e.progress, at: Date.now() };
    } else if (e.type === "result") {
      m.result = e.result;
      m.job = undefined;
      if (s.board?.status === "waiting" || s.board?.status === "redrawing") set({ board: { ...s.board, status: "closed" } });
    } else if (e.type === "storyboard") {
      m.board = e.round;
      set({ board: boardFromEvent(e, false, s.board), boardOpen: true });
    } else if (e.type === "plan") {
      // The first change of a turn is one undo step; after that the timeline follows Claude live.
      if (!m.before) (m.before = s.plan), get().checkpoint();
      get().live(e.plan);
    } else if (e.type === "done") {
      if (e.plan) get().live(e.plan);
      Object.assign(m, { status: e.question ? "waiting" : "done", question: e.question, ended: Date.now(), after: m.before ? get().plan : undefined });
    } else if (e.type === "error") {
      Object.assign(m, { status: "error", error: e.error, ended: Date.now() });
      if (s.board && s.board.status !== "approved") set({ board: { ...s.board, status: "closed", error: e.error } });
    }
    msgs[i] = m;
    set({ messages: msgs, busy: e.type === "done" || e.type === "error" ? false : s.busy });
  },
  answerQuestion: (answer) =>
    set((s) => {
      const msgs = [...s.messages];
      const i = msgs.findLastIndex((m) => m.role === "agent");
      if (i >= 0) msgs[i] = { ...(msgs[i] as AgentMessage), answer, status: "done" };
      return { messages: msgs };
    }),
}));
