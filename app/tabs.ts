// Project tabs: several videos open at once, one editor. The editor store always holds the
// active tab; switching parks its state here and brings the other tab's state back.
import { create } from "zustand";
import { useEditor } from "./store.ts";

type EditorState = ReturnType<typeof useEditor.getState>;
const KEYS = [
  "project", "plan", "past", "future", "messages", "time", "pxPerSec", "selected", "picked", "selectedCue",
  "selectedVo", "selectedBroll", "selectedMotion", "markers", "pointing", "leftView", "rightTab", "exported", "library",
] as const satisfies readonly (keyof EditorState)[];
type Snapshot = Pick<EditorState, (typeof KEYS)[number]>;

export type Tab = { id: number; snapshot?: Snapshot };

let nextId = 1;
const take = (): Snapshot => {
  const s = useEditor.getState();
  return Object.fromEntries(KEYS.map((k) => [k, s[k]])) as Snapshot;
};

// A blank tab: no video, empty chat. Taken when the app starts, before anything is loaded.
const blank = take();

export const useTabs = create<{
  tabs: Tab[];
  active: number;
  /** Opens an empty tab (the drop-a-video screen) and switches to it. */
  add(): void;
  switchTo(id: number): void;
  close(id: number): void;
}>((set, get) => ({
  tabs: [{ id: 0 }],
  active: 0,

  add: () => {
    if (!canSwitch()) return;
    const id = nextId++;
    park(get().active);
    useEditor.setState({ ...blank, playing: false });
    set((s) => ({ tabs: [...s.tabs, { id }], active: id }));
  },

  switchTo: (id) => {
    const { active, tabs } = get();
    if (id === active || !canSwitch()) return;
    park(active);
    const tab = tabs.find((t) => t.id === id);
    useEditor.setState({ ...(tab?.snapshot ?? blank), playing: false });
    set({ active: id });
  },

  close: (id) => {
    const { tabs, active } = get();
    if (id === active && !canSwitch()) return;
    const i = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    if (!rest.length) {
      // Closing the last tab leaves one empty tab.
      const id = nextId++;
      useEditor.setState({ ...blank, playing: false });
      set({ tabs: [{ id }], active: id });
      return;
    }
    set({ tabs: rest });
    if (id === active) {
      const next = rest[Math.min(i, rest.length - 1)];
      useEditor.setState({ ...(next.snapshot ?? blank), playing: false });
      set({ active: next.id });
    }
  },
}));

function park(id: number) {
  const snapshot = take();
  useTabs.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, snapshot } : t)) }));
}

/** Not while the AI or an export is working on the open project: the result would land in the wrong tab. */
function canSwitch() {
  const s = useEditor.getState();
  return !s.busy && s.exporting === null;
}
