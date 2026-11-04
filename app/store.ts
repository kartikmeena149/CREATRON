// Editor state. The edit plan is the single source of truth: the viewer previews it, the
// timeline draws it, the inspector and the AI change it, and export renders it.
// Every change goes through history so anything (including an AI edit) can be undone.
import { create } from "zustand";
import { wholeVideo } from "../src/autocut.ts";
import { type Analysis, type Broll, type Caption, DEFAULT_CAPTIONS, type EditPlan, type Motion, type Segment, type Voiceover } from "../src/schema.ts";
import { captionsOf, outputDuration, toSourceTime } from "../src/timeline.ts";

export type Thumbs = { url: string; cols: number; frameW: number; frameH: number; interval: number; count: number };
export type LeftView = "media" | "clip" | "text" | "captions" | "audio";
export type Wave = { rate: number; peaks: number[] };
export type Project = { path: string; analysis: Analysis; videoUrl: string; thumbs: Thumbs; wave: Wave };

export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; before?: EditPlan; meta?: string }
  | { role: "error"; text: string };

type State = {
  project?: Project;
  plan: EditPlan;
  past: EditPlan[];
  future: EditPlan[];
  selected: number | null;
  /** Clips picked for the AI (⇧/⌘-click adds more); the request then changes only these. */
  picked: number[];
  time: number; // playhead, seconds on the OUTPUT timeline
  playing: boolean;
  pxPerSec: number;
  status: string;
  busy: boolean;
  messages: Message[];
  exporting: number | null; // 0..1 while exporting
  exported?: string;

  load(p: Project): void;
  /** Replace the plan and record the previous one for undo. */
  commit(plan: EditPlan): void;
  /** Save the current plan for undo before a live drag/slider change. */
  checkpoint(): void;
  /** Change the plan without a history entry (during drags; call checkpoint first). */
  live(plan: EditPlan): void;
  undo(): void;
  redo(): void;
  select(i: number | null): void;
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
  rightTab: "ai" | "captions" | "voice";
  /** Videos in this project's library (the main video and any added for B-roll), by path. */
  library: string[];
  addToLibrary(path: string): void;
  /** Which page the left panel shows (null: panel hidden). */
  leftView: LeftView | null;
  selectCue(i: number | null): void;
  /** Change caption style/position (not the captions themselves). */
  setCaptionStyle(patch: Partial<EditPlan["captions"]>, record?: boolean): void;
  /** Change one caption. The first edit turns auto captions into the user's own list. */
  editCaption(i: number, patch: Partial<Caption>, record?: boolean): void;
  deleteCaption(i: number): void;
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
  updateMotion(id: string, patch: Partial<Motion>, record?: boolean): void;
  deleteMotion(id: string): void;
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
};

const placeholder: EditPlan = {
  version: 1,
  segments: [{ start: 0, end: 1, speed: 1, zoom: 1, volume: 1 }],
  aspect: "source",
  transform: { scale: 1, x: 0, y: 0, rotate: 0 },
  captions: { ...DEFAULT_CAPTIONS },
  audio: { denoise: false, clarity: 0, normalize: true, volumeDb: 0, duckDb: -14 },
  voiceovers: [],
  broll: [],
  motion: [],
  notes: "",
  tracks: { count: {}, settings: {} },
};

/** Which segment the output time t falls in, and how far into the output that segment starts. */
export function locate(plan: EditPlan, t: number): { index: number; offset: number } {
  let offset = 0;
  for (let i = 0; i < plan.segments.length; i++) {
    const len = (plan.segments[i].end - plan.segments[i].start) / plan.segments[i].speed;
    if (t < offset + len || i === plan.segments.length - 1) return { index: i, offset };
    offset += len;
  }
  return { index: 0, offset: 0 };
}

export const useEditor = create<State>((set, get) => ({
  plan: placeholder,
  past: [],
  future: [],
  selected: null,
  picked: [],
  time: 0,
  playing: false,
  pxPerSec: 20,
  status: "",
  busy: false,
  messages: [],
  exporting: null,

  load: (project) =>
    set((s) => ({ library: s.library.includes(project.path) ? s.library : [project.path, ...s.library], project, plan: wholeVideo(project.analysis), markers: [], pointing: false, past: [], future: [], selected: null, picked: [], selectedCue: null, selectedVo: null, selectedBroll: null, time: 0, playing: false })),
  commit: (plan) => set((s) => ({ plan, past: [...s.past, s.plan].slice(-200), future: [] })),
  checkpoint: () => set((s) => ({ past: [...s.past, s.plan].slice(-200), future: [] })),
  live: (plan) => set({ plan }),
  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev) return s;
      return { plan: prev, past: s.past.slice(0, -1), future: [s.plan, ...s.future], selected: null, picked: [], selectedCue: null, selectedVo: null, selectedBroll: null, selectedMotion: null };
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return { plan: next, past: [...s.past, s.plan], future: s.future.slice(1), selected: null, picked: [], selectedCue: null, selectedVo: null, selectedBroll: null, selectedMotion: null };
    }),
  select: (selected) =>
    set(selected === null ? { selected, picked: [] } : { selected, picked: [selected], selectedCue: null, selectedVo: null, selectedBroll: null, selectedMotion: null }),
  togglePick: (i) =>
    set((s) => {
      const picked = s.picked.includes(i) ? s.picked.filter((n) => n !== i) : [...s.picked, i].sort((a, b) => a - b);
      return { picked, selected: picked.length ? (picked.includes(i) ? i : picked.at(-1)!) : null, selectedCue: null, selectedVo: null, selectedBroll: null, selectedMotion: null };
    }),
  seek: (t) => set((s) => ({ time: Math.max(0, Math.min(t, outputDuration(s.plan))) })),
  setPlaying: (playing) => set({ playing }),
  setZoom: (pxPerSec) => set({ pxPerSec: Math.max(2, Math.min(400, pxPerSec)) }),

  updateSegment: (i, patch, record = true) => {
    const { plan } = get();
    const segments = plan.segments.map((s, n) => (n === i ? { ...s, ...patch } : s));
    (record ? get().commit : get().live)({ ...plan, segments });
  },

  // Cut the clip under the playhead in two (like pressing S in a pro editor).
  split: () => {
    const { plan, time } = get();
    const { index, offset } = locate(plan, time);
    const s = plan.segments[index];
    const at = s.start + (time - offset) * s.speed;
    if (at - s.start < 0.1 || s.end - at < 0.1) return;
    const segments = [...plan.segments];
    segments.splice(index, 1, { ...s, end: at }, { ...s, start: at });
    get().commit({ ...plan, segments });
    set({ selected: index + 1, picked: [index + 1] });
  },

  // Remove the selected clip; everything after it slides left (ripple delete).
  deleteSelected: () => {
    const { plan, selected } = get();
    if (selected === null || plan.segments.length <= 1) return;
    get().commit({ ...plan, segments: plan.segments.filter((_, i) => i !== selected) });
    set((s) => ({ selected: null, picked: [], time: Math.min(s.time, outputDuration(s.plan)) }));
  },

  selectedCue: null,
  rightTab: "ai",
  leftView: "media",
  library: [],
  addToLibrary: (path) => set((s) => (s.library.includes(path) ? s : { library: [...s.library, path] })),
  selectCue: (selectedCue) => set(selectedCue === null ? { selectedCue } : { selectedCue, selected: null, picked: [], selectedVo: null, selectedBroll: null, selectedMotion: null }),

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
    const start = toSourceTime(plan, time);
    const end = Math.min(seg.end, start + 2 * seg.speed);
    if (end - start < 0.2) return;
    const cues = [...captionsOf(plan, project.analysis.words), { start, end, text: "New caption" }].sort((a, b) => a.start - b.start);
    get().setCaptionStyle({ cues, enabled: true });
    set({ selectedCue: cues.findIndex((c) => c.start === start && c.text === "New caption"), rightTab: "captions" });
  },

  resetCaptions: () => {
    const { plan } = get();
    const { cues: _, ...rest } = plan.captions;
    get().commit({ ...plan, captions: rest });
    set({ selectedCue: null });
  },

  selectedBroll: null,
  selectBroll: (selectedBroll) =>
    set(selectedBroll === null ? { selectedBroll } : { selectedBroll, selected: null, picked: [], selectedCue: null, selectedVo: null, selectedMotion: null }),
  updateBroll: (id, patch, record = true) => {
    const { plan } = get();
    const broll = plan.broll.map((b) => (b.id === id ? { ...b, ...patch } : b));
    (record ? get().commit : get().live)({ ...plan, broll });
  },
  addBroll: (b) => {
    const { plan, time } = get();
    const at = Math.max(0, Math.min(b.at ?? time, outputDuration(plan) - 0.5));
    // AI picks are kept short; a video dragged in from the library keeps its full length.
    const cap = b.source.startsWith("library:") ? Infinity : 15;
    const duration = Math.max(0.5, Math.min(b.duration ?? 5, b.length, cap, outputDuration(plan) - at));
    const id = `b${Math.random().toString(36).slice(2, 10)}`;
    const clip: Broll = { id, track: b.track ?? 2, source: b.source, at, duration, offset: 0, file: b.file, length: b.length, query: b.query, credit: b.credit };
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

  selectedMotion: null,
  selectMotion: (selectedMotion) =>
    set(selectedMotion === null ? { selectedMotion } : { selectedMotion, selected: null, picked: [], selectedCue: null, selectedVo: null, selectedBroll: null }),
  addMotion: (template, track = 1) => {
    const { plan, time } = get();
    const total = outputDuration(plan);
    const id = `m${Math.random().toString(36).slice(2, 10)}`;
    const at = Math.max(0, Math.min(time, total - 0.5));
    const item: Motion = {
      id, track, template, props: {}, at, duration: Math.max(0.5, Math.min(3, total - at)), color: "#facc15",
      text: template === "title" ? "Your title" : "Your name", subtext: template === "title" ? "" : "What you do",
    };
    get().commit({ ...plan, motion: [...plan.motion, item] });
    set({ selectedMotion: id, selected: null, picked: [], selectedCue: null, selectedVo: null, selectedBroll: null });
  },
  updateMotion: (id, patch, record = true) => {
    const { plan } = get();
    const motion = plan.motion.map((m) => (m.id === id ? { ...m, ...patch } : m));
    (record ? get().commit : get().live)({ ...plan, motion });
  },
  deleteMotion: (id) => {
    const { plan } = get();
    get().commit({ ...plan, motion: plan.motion.filter((m) => m.id !== id) });
    set({ selectedMotion: null });
  },

  selectedVo: null,
  selectVo: (selectedVo) => set(selectedVo === null ? { selectedVo } : { selectedVo, selected: null, picked: [], selectedCue: null, selectedBroll: null, selectedMotion: null }),

  addVoiceover: (v) => {
    const { plan, time } = get();
    const id = Math.random().toString(36).slice(2, 10);
    const at = Math.max(0, v.at ?? time);
    // Music and sound effects stop at the end of the video; voiceovers keep their full length.
    const duration = v.kind && v.kind !== "voice" ? Math.max(0.2, Math.min(v.duration, outputDuration(plan) - at)) : v.duration;
    const vo: Voiceover = {
      id, kind: v.kind ?? "voice", track: v.track ?? 1, file: v.file, text: v.text, voice: v.voice,
      at, offset: 0, duration, length: v.duration, volumeDb: v.volumeDb ?? 0,
    };
    get().commit({ ...plan, voiceovers: [...plan.voiceovers, vo] });
    set({ selectedVo: id, selected: null, picked: [], selectedCue: null });
  },

  updateVoiceover: (id, patch, record = true) => {
    const { plan } = get();
    const voiceovers = plan.voiceovers.map((v) => (v.id === id ? { ...v, ...patch } : v));
    (record ? get().commit : get().live)({ ...plan, voiceovers });
  },

  deleteVoiceover: (id) => {
    const { plan } = get();
    get().commit({ ...plan, voiceovers: plan.voiceovers.filter((v) => v.id !== id) });
    set({ selectedVo: null });
  },

  set: (partial) => set(partial),
  say: (m) => set((s) => ({ messages: [...s.messages, m] })),
}));
