// Choosing the frame shape. Every shape is drawn at its true proportion, the same area each, so you
// compare shapes rather than read numbers. Hovering one shows it live in the viewer; clicking keeps it
// (one undo step); leaving puts the old shape back. The chosen one carries the red recording light.
import { useEffect, useRef, useState } from "react";
import { ASPECTS, outputSize } from "../src/frame.ts";
import type { EditPlan } from "../src/schema.ts";
import { Icon } from "./icons.tsx";
import { useEditor } from "./store.ts";

type Aspect = EditPlan["aspect"];

/** A shape's box inside a `box`-sized square: equal area for every shape, nothing past the edges. */
function shapeBox(w: number, h: number, box: number): { w: number; h: number } {
  const r = w / h;
  const side = box * 0.78;
  let bw = side * Math.sqrt(r);
  let bh = side / Math.sqrt(r);
  const fit = Math.min(1, box / bw, box / bh);
  return { w: (bw *= fit), h: (bh *= fit) };
}

function Shape({ w, h, box, on, original }: { w: number; h: number; box: number; on?: boolean; original?: boolean }) {
  const s = shapeBox(w, h, box);
  return (
    <span className="fp-shape" style={{ width: box, height: box }}>
      <i className={`${on ? "on" : ""} ${original ? "original" : ""}`} style={{ width: s.w, height: s.h }}>
        {on && <b />}
      </i>
    </span>
  );
}

/** The frame shapes as tiles. `onHover` previews (undefined when the pointer leaves). */
export function FrameTiles({ value, onPick, onHover, focus }: { value: Aspect; onPick: (a: Aspect) => void; onHover?: (a?: Aspect) => void; focus?: Aspect }) {
  const project = useEditor((s) => s.project);
  const source = project?.analysis ?? { width: 1920, height: 1080 };
  return (
    <div className="fp-tiles" role="radiogroup" aria-label="Frame" onMouseLeave={() => onHover?.()}>
      {ASPECTS.map((a) => {
        const size = outputSize({ aspect: a.id }, source);
        return (
          <button
            key={a.id}
            role="radio"
            aria-checked={a.id === value}
            className={`fp-tile ${a.id === value ? "on" : ""} ${a.id === focus ? "focus" : ""}`}
            title={`${a.use} · ${size.width} × ${size.height}`}
            onMouseEnter={() => onHover?.(a.id)}
            onFocus={() => onHover?.(a.id)}
            onClick={() => onPick(a.id)}
          >
            <Shape w={size.width} h={size.height} box={40} on={a.id === value} original={a.id === "source"} />
            <span className="fp-name">{a.name}</span>
            <span className="fp-use">{a.use}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The top bar's frame button and its panel. */
export function FramePicker() {
  const plan = useEditor((s) => s.plan);
  const project = useEditor((s) => s.project);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<Aspect>();
  // The plan as it was when the panel opened: previews are drawn from it and it comes back on leave.
  const base = useRef<EditPlan | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const source = project?.analysis ?? { width: 1920, height: 1080 };

  const preview = (a?: Aspect) => {
    setHover(a);
    const b = base.current;
    if (b) useEditor.getState().live(a ? { ...b, aspect: a } : b);
  };
  const close = () => {
    const b = base.current;
    if (b) useEditor.getState().live(b);
    base.current = null;
    setHover(undefined);
    setOpen(false);
  };
  const pick = (a: Aspect) => {
    const b = base.current ?? useEditor.getState().plan;
    base.current = null;
    setHover(undefined);
    setOpen(false);
    const s = useEditor.getState();
    s.live(b);
    if (a !== b.aspect) s.commit({ ...b, aspect: a });
  };
  const toggle = () => {
    if (open) return close();
    base.current = useEditor.getState().plan;
    setOpen(true);
  };

  // Outside click and Esc put the old shape back; arrows walk the shapes, Enter keeps one.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => {
      const ids = ASPECTS.map((a) => a.id);
      const at = ids.indexOf(hover ?? base.current?.aspect ?? "source");
      if (e.key === "Escape") (e.preventDefault(), close());
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        preview(ids[(at + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length]);
      } else if (e.key === "Enter" && hover) (e.preventDefault(), pick(hover));
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => (window.removeEventListener("mousedown", onDown), window.removeEventListener("keydown", onKey, true));
  }, [open, hover]);

  const kept = base.current?.aspect ?? plan.aspect;
  const shown = hover ?? kept;
  const size = outputSize({ aspect: shown }, source);
  const current = outputSize({ aspect: kept }, source);
  const label = ASPECTS.find((a) => a.id === kept)?.name ?? kept;
  const info = ASPECTS.find((a) => a.id === shown)!;

  return (
    <div className="fp" ref={root}>
      <button className={`fp-trigger ${open ? "open" : ""}`} title="Frame" aria-expanded={open} onClick={toggle}>
        <Shape w={current.width} h={current.height} box={16} />
        <span>{label}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="fp-panel" role="dialog" aria-label="Frame">
          <div className="fp-head">
            <span className="fp-label">Frame</span>
            <span className="fp-size">{size.width} × {size.height}</span>
          </div>
          <FrameTiles value={kept} focus={hover} onPick={pick} onHover={preview} />
          <div className="fp-foot">
            <span>{hover && hover !== kept ? <>Previewing <b>{info.name}</b> · {info.use}</> : "Hover to preview in the viewer"}</span>
            <span className="fp-keys"><kbd>←</kbd><kbd>→</kbd><kbd>↵</kbd></span>
          </div>
        </div>
      )}
    </div>
  );
}
