// Position & Size: where the video sits in the frame. Scale, X/Y in output pixels, rotation.
// Every control saves one undo step per gesture (checkpoint on press, live while moving).
import { useEffect, useRef, useState } from "react";
import { isIdentity, outputSize } from "../src/frame.ts";
import type { EditPlan } from "../src/schema.ts";
import { useEditor } from "./store.ts";

type Transform = EditPlan["transform"];
const DEFAULT: Transform = { scale: 1, x: 0, y: 0, rotate: 0 };

export function PositionSize() {
  const { project, plan, commit, checkpoint, live } = useEditor();
  if (!project) return null;
  const t = plan.transform;
  const out = outputSize(plan, project.analysis);
  // Always read the latest plan so rapid gestures never undo each other.
  const set = (patch: Partial<Transform>) => {
    const p = useEditor.getState().plan;
    live({ ...p, transform: { ...p.transform, ...patch } });
  };
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  return (
    <section className="pos-size">
      <h3>
        Position & Size
        <button
          className="reset"
          title="Reset position and size"
          disabled={isIdentity(t)}
          onClick={() => commit({ ...plan, transform: DEFAULT })}
        >
          ↺
        </button>
      </h3>

      <div className="field-label">Scale</div>
      <div className="field-row">
        <input
          type="range"
          className="grow"
          min={10}
          max={300}
          step={1}
          value={Math.round(t.scale * 100)}
          onPointerDown={checkpoint}
          onChange={(e) => set({ scale: Number(e.target.value) / 100 })}
        />
        <NumberField
          value={t.scale * 100}
          format={(v) => `${Math.round(v)}%`}
          step={1}
          onStart={checkpoint}
          onChange={(v) => set({ scale: clamp(v, 10, 300) / 100 })}
        />
      </div>

      <div className="field-label">Position</div>
      <div className="field-row">
        <NumberField
          prefix="X"
          value={t.x * out.width}
          format={(v) => String(Math.round(v))}
          step={1}
          onStart={checkpoint}
          onChange={(v) => set({ x: clamp(v / out.width, -1, 1) })}
        />
        <NumberField
          prefix="Y"
          value={t.y * out.height}
          format={(v) => String(Math.round(v))}
          step={1}
          onStart={checkpoint}
          onChange={(v) => set({ y: clamp(v / out.height, -1, 1) })}
        />
      </div>

      <div className="field-label">Rotate</div>
      <div className="field-row">
        <NumberField
          value={t.rotate}
          format={(v) => `${Math.round(v)}°`}
          step={1}
          onStart={checkpoint}
          onChange={(v) => set({ rotate: clamp(Math.round(v), -180, 180) })}
        />
        <Dial value={t.rotate} onStart={checkpoint} onChange={(v) => set({ rotate: v })} />
      </div>
      <p className="hint">Tip: drag the video in the viewer to move it.</p>
    </section>
  );
}

/**
 * A number box like a pro editor's: type a value, use ↑/↓ (⇧ for ×10), click the arrows,
 * or drag the prefix letter left/right to scrub.
 */
function NumberField(p: {
  value: number;
  format: (v: number) => string;
  step: number;
  prefix?: string;
  onStart: () => void;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState<string | null>(null); // non-null while typing
  const input = useRef<HTMLInputElement>(null);

  const apply = () => {
    if (text === null) return;
    const v = parseFloat(text.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(v)) (p.onStart(), p.onChange(v));
    setText(null);
  };
  const nudge = (dir: number, big = false) => {
    p.onStart();
    p.onChange(p.value + dir * p.step * (big ? 10 : 1));
  };
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    p.onStart();
    const x0 = e.clientX;
    const v0 = p.value;
    const move = (ev: PointerEvent) => p.onChange(v0 + Math.round((ev.clientX - x0) * (ev.shiftKey ? 10 : 1)) * p.step);
    const up = () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="num-field">
      <div className="num-box">
        {p.prefix && <span className="num-prefix" onPointerDown={scrub} title="Drag to adjust">{p.prefix}</span>}
        <input
          ref={input}
          value={text ?? p.format(p.value)}
          onFocus={(e) => (setText(p.format(p.value)), requestAnimationFrame(() => e.target.select()))}
          onChange={(e) => setText(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => {
            if (e.key === "Enter") input.current?.blur();
            else if (e.key === "Escape") (setText(null), input.current?.blur());
            else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              setText(null);
              nudge(e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
            }
          }}
        />
      </div>
      <div className="stepper">
        <button tabIndex={-1} onClick={(e) => nudge(1, e.shiftKey)} title="Increase">
          <svg viewBox="0 0 10 6" width="9" height="6"><path d="M1 5l4-4 4 4" /></svg>
        </button>
        <button tabIndex={-1} onClick={(e) => nudge(-1, e.shiftKey)} title="Decrease">
          <svg viewBox="0 0 10 6" width="9" height="6"><path d="M1 1l4 4 4-4" /></svg>
        </button>
      </div>
    </div>
  );
}

/** A small rotation knob: drag around it to turn, double-click to reset. */
function Dial({ value, onStart, onChange }: { value: number; onStart: () => void; onChange: (v: number) => void }) {
  const knob = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const angleAt = (x: number, y: number) => {
    const r = knob.current!.getBoundingClientRect();
    // 0° points right (like the reference); clockwise is positive.
    const deg = (Math.atan2(y - (r.top + r.height / 2), x - (r.left + r.width / 2)) * 180) / Math.PI;
    return Math.round(deg);
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    onStart();
    setActive(true);
    onChange(angleAt(e.clientX, e.clientY));
    const move = (ev: PointerEvent) => onChange(angleAt(ev.clientX, ev.clientY));
    const up = () => (setActive(false), window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  useEffect(() => () => setActive(false), []);
  return (
    <div
      ref={knob}
      className={`dial ${active ? "active" : ""}`}
      onPointerDown={down}
      onDoubleClick={() => (onStart(), onChange(0))}
      title="Drag to rotate · double-click to reset"
    >
      <i style={{ transform: `rotate(${value}deg)` }} />
    </div>
  );
}
