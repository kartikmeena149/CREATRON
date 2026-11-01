// Editor state. The edit plan is the single source of truth: the viewer previews it, the
// timeline draws it, the inspector and the AI change it, and export renders it.
// Every change goes through history so anything (including an AI edit) can be undone.
import { create } from "zustand";
import { wholeVideo } from "../src/autocut.ts";
import type { Analysis, EditPlan, Segment } from "../src/schema.ts";
import { outputDuration } from "../src/timeline.ts";

export type Thumbs = { url: string; cols: number; frameW: number; frameH: number; interval: number; count: number };
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
  seek(t: number): void;
  setPlaying(p: boolean): void;
  setZoom(pxPerSec: number): void;
  updateSegment(i: number, patch: Partial<Segment>, record?: boolean): void;
  split(): void;
  deleteSelected(): void;
  set(partial: Partial<State>): void;
  say(m: Message): void;
};

const placeholder: EditPlan = {
  version: 1,
  segments: [{ start: 0, end: 1, speed: 1, zoom: 1 }],
  aspect: "source",
  reframeX: 0.5,
  captions: { enabled: false, style: "bold", wordsPerCaption: 3 },
  audio: { denoise: false, clarity: 0, normalize: true, volumeDb: 0 },
  notes: "",
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
  time: 0,
  playing: false,
  pxPerSec: 20,
  status: "",
  busy: false,
  messages: [],
  exporting: null,

  load: (project) =>
    set({ project, plan: wholeVideo(project.analysis), past: [], future: [], selected: null, time: 0, playing: false }),
  commit: (plan) => set((s) => ({ plan, past: [...s.past, s.plan].slice(-200), future: [] })),
  checkpoint: () => set((s) => ({ past: [...s.past, s.plan].slice(-200), future: [] })),
  live: (plan) => set({ plan }),
  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev) return s;
      return { plan: prev, past: s.past.slice(0, -1), future: [s.plan, ...s.future], selected: null };
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return { plan: next, past: [...s.past, s.plan], future: s.future.slice(1), selected: null };
    }),
  select: (selected) => set({ selected }),
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
    set({ selected: index + 1 });
  },

  // Remove the selected clip; everything after it slides left (ripple delete).
  deleteSelected: () => {
    const { plan, selected } = get();
    if (selected === null || plan.segments.length <= 1) return;
    get().commit({ ...plan, segments: plan.segments.filter((_, i) => i !== selected) });
    set((s) => ({ selected: null, time: Math.min(s.time, outputDuration(s.plan)) }));
  },

  set: (partial) => set(partial),
  say: (m) => set((s) => ({ messages: [...s.messages, m] })),
}));
