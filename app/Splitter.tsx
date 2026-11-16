// Draggable dividers between the editor's sections. Sizes are remembered on this Mac;
// double-click a divider to put it back.
//
// The viewer in the middle always keeps room: the library, the chat and the timeline can only grow
// while the viewer stays at least VIEWER.w wide and VIEWER.h tall. When the window gets smaller,
// the side sections give way first (down to their own minimums), so nothing ever spills out.
import { useEffect, useLayoutEffect, useState } from "react";

const DEFAULTS = { left: 480, ai: 400, timeline: 320 };
type Sizes = typeof DEFAULTS;
/** The smallest each section gets. */
export const MIN = { left: 220, ai: 300, timeline: 150 };
/** The viewer's own minimum, which the other sections never take from. */
export const VIEWER = { w: 540, h: 430 };
/** What surrounds the sections: the rail on the left (56) and the top bar (48) with borders. */
const RAIL = 57;
const TOP = 49;
// A fresh key: the earlier sizes could squeeze the viewer, so everyone starts from the defaults once.
const KEY = "creatro.layout";

export function useLayoutSizes(): [Sizes, (patch: Partial<Sizes>) => void] {
  const [sizes, setSizes] = useState<Sizes>(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    } catch {
      return DEFAULTS;
    }
  });
  const update = (patch: Partial<Sizes>) =>
    setSizes((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return [sizes, update];
}

export const defaultSize = (k: keyof Sizes) => DEFAULTS[k];

/** The window's inner width and the editor area's height (top bar excluded), kept current. */
export function useLayoutRoom() {
  // A callback ref: the editor area can be rebuilt (a new tab), and the watcher follows it.
  const [editor, setEditor] = useState<HTMLDivElement | null>(null);
  const [room, setRoom] = useState(() => ({ w: window.innerWidth, h: window.innerHeight - TOP }));
  const measure = () => {
    // A hidden editor (Home is open) measures 0: keep the last real height until it shows again.
    const h = editor?.clientHeight || 0;
    setRoom((r) => {
      const next = { w: window.innerWidth, h: h || r.h };
      return next.w === r.w && next.h === r.h ? r : next; // unchanged: no redraw
    });
  };
  // After every redraw (Home closing, a tab opening), then on any change of size.
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener("resize", measure);
    const watch = new ResizeObserver(measure);
    if (editor) watch.observe(editor);
    watch.observe(document.documentElement);
    return () => (window.removeEventListener("resize", measure), watch.disconnect());
  }, [editor]);
  return [room, setEditor] as const;
}

/**
 * The sizes as drawn in a window of `win`, and how far each divider may go, so the viewer keeps its
 * room. Saved sizes are kept as they are: the window growing back gives them back.
 */
export function fitLayout(saved: Sizes, open: { left: boolean; ai: boolean }, win: { w: number; h: number }) {
  // Width shared by the library and the chat, beside a viewer of at least VIEWER.w.
  const spare = Math.max(0, win.w - RAIL - VIEWER.w);
  let left = open.left ? Math.max(MIN.left, saved.left) : 0;
  let ai = open.ai ? Math.max(MIN.ai, saved.ai) : 0;
  const over = left + ai - spare;
  if (over > 0) {
    // Both give way in proportion to what each has above its minimum.
    const roomL = open.left ? left - MIN.left : 0;
    const roomA = open.ai ? ai - MIN.ai : 0;
    const room = roomL + roomA;
    const cut = Math.min(over, room);
    if (room > 0) {
      left -= Math.round((cut * roomL) / room);
      ai -= Math.round((cut * roomA) / room);
    }
  }
  // win.h is the editor area: the viewer above the timeline keeps VIEWER.h of it.
  const timelineMax = Math.max(MIN.timeline, win.h - VIEWER.h);
  const timeline = Math.max(MIN.timeline, Math.min(saved.timeline, timelineMax));
  return {
    sizes: { left, ai, timeline },
    max: {
      left: Math.max(MIN.left, spare - ai),
      ai: Math.max(MIN.ai, spare - left),
      timeline: timelineMax,
    },
  };
}

/**
 * A divider. `dir` "x" resizes widths (drag left/right), "y" heights. `sign` is +1 when dragging
 * right/down makes the section bigger, -1 when it makes it smaller.
 */
export function Splitter(p: {
  dir: "x" | "y"; value: number; min: number; max: number; sign: 1 | -1; reset: number; onChange: (v: number) => void;
}) {
  const [active, setActive] = useState(false);
  const clamp = (v: number) => Math.round(Math.max(p.min, Math.min(p.max, v)));
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = p.dir === "x" ? e.clientX : e.clientY;
    const from = p.value;
    setActive(true);
    document.body.classList.add(p.dir === "x" ? "resizing-x" : "resizing-y");
    const move = (ev: PointerEvent) => {
      const d = (p.dir === "x" ? ev.clientX : ev.clientY) - start;
      p.onChange(clamp(from + p.sign * d));
    };
    const up = () => {
      setActive(false);
      document.body.classList.remove("resizing-x", "resizing-y");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className={`splitter ${p.dir} ${active ? "active" : ""}`} onDoubleClick={() => p.onChange(clamp(p.reset))}>
      <i onPointerDown={down} />
    </div>
  );
}
