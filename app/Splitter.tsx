// Draggable dividers between the editor's sections. Sizes are remembered on this Mac;
// double-click a divider to put it back.
import { useState } from "react";

const DEFAULTS = { left: 400, ai: 400, timeline: 320 };
type Sizes = typeof DEFAULTS;
const KEY = "creatron.layout";

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

/**
 * A divider. `dir` "x" resizes widths (drag left/right), "y" heights. `sign` is +1 when dragging
 * right/down makes the section bigger, -1 when it makes it smaller.
 */
export function Splitter(p: {
  dir: "x" | "y"; value: number; min: number; max: number; sign: 1 | -1; reset: number; onChange: (v: number) => void;
}) {
  const [active, setActive] = useState(false);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = p.dir === "x" ? e.clientX : e.clientY;
    const from = p.value;
    setActive(true);
    document.body.classList.add(p.dir === "x" ? "resizing-x" : "resizing-y");
    const move = (ev: PointerEvent) => {
      const d = (p.dir === "x" ? ev.clientX : ev.clientY) - start;
      p.onChange(Math.round(Math.max(p.min, Math.min(p.max, from + p.sign * d))));
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
    <div className={`splitter ${p.dir} ${active ? "active" : ""}`} onDoubleClick={() => p.onChange(p.reset)}>
      <i onPointerDown={down} />
    </div>
  );
}
