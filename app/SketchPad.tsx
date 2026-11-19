// Drawing on a storyboard shot: the user's pencil and eraser over Claude's sketch, to show "not like
// that, like this". Their strokes are kept on the shot (shot.marks), drawn on every view of it (cards,
// animatic, PDF), and when they answer, each drawn shot goes to Claude as a picture to look at.
// The sketch and the strokes are two canvases: the eraser only ever rubs out the user's own lines.
// The arrow points from a note in the user's words to what it's about ("move the logo here").
import { useEffect, useRef, useState } from "react";
import { MARK_COLORS, type Mark, type Shot } from "../src/storyboard.ts";
import { Icon } from "./icons.tsx";
import type { BoardState } from "./store.ts";
import { type SketchTheme, aspect, drawShot, noteBox, strokeMarks } from "./storyboardSketch.ts";

type Tool = Mark["tool"];
/** The size slider (0..1) as a line width, a fraction of the frame's shorter side: the eraser is broader. */
const widthOf = (tool: Tool, v: number) => (tool === "eraser" ? 0.02 + v * 0.16 : 0.003 + v * 0.037);
const COLOR_NAMES: Record<string, string> = { "#ffd60a": "Yellow", "#f5f5f5": "White", "#4cc9f0": "Blue", "#4ade80": "Green" };

let open = 0;
/** True while the drawing view is open: the storyboard's own keys (esc, arrows, space) leave it alone. */
export const sketching = () => open > 0;

const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;

export function SketchPad({ b, shot, index, picture, editable, onChange, onClose, theme = "dark" }: {
  b: BoardState; shot: Shot; index: number; picture: HTMLImageElement | null | undefined; editable: boolean; theme?: SketchTheme;
  onChange: (marks: Mark[]) => void; onClose: () => void;
}) {
  const ratio = aspect(b.draft.format);
  const fit = () => {
    const maxH = window.innerHeight - 48 - 170;
    const maxW = window.innerWidth - 160;
    let h = maxH;
    let w = h * ratio;
    if (w > maxW) (w = maxW), (h = w / ratio);
    return { w: Math.round(w), h: Math.round(h) };
  };
  const [box, setBox] = useState(fit);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(MARK_COLORS[0]);
  const [size, setSize] = useState(0.25);
  const [note, setNote] = useState<{ index: number; text: string } | null>(null); // an arrow's note being typed
  const noteOpened = useRef(0);
  useEffect(() => void (note && (noteOpened.current = performance.now())), [note?.index]);
  const [undone, setUndone] = useState<Mark[][]>([]); // for redo
  const [history, setHistory] = useState<Mark[][]>([]); // for undo
  const base = useRef<HTMLCanvasElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const live = useRef<Mark | null>(null);
  const marks = shot.marks ?? [];
  const scale = Math.min(3, window.devicePixelRatio || 2);

  useEffect(() => {
    open++;
    const onResize = () => setBox(fit());
    window.addEventListener("resize", onResize);
    return () => (open--, window.removeEventListener("resize", onResize));
  }, []);

  // The sketch under the drawing (without the user's strokes: those are the layer on top).
  const plain = JSON.stringify({ ...shot, marks: undefined });
  useEffect(() => {
    if (base.current && picture !== undefined) drawShot(base.current, box.w, box.h, scale, { ...shot, marks: undefined }, b.draft, picture, theme);
  }, [plain, picture, box.w, box.h, JSON.stringify(b.draft.look), theme]);

  // The strokes, drawn again whenever they change (undo, redo, clear, another size of window).
  const paint = (list: Mark[]) => {
    const c = ink.current;
    if (!c) return;
    c.width = Math.round(box.w * scale);
    c.height = Math.round(box.h * scale);
    const g = c.getContext("2d")!;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    strokeMarks(g, box.w, box.h, list, theme);
  };
  useEffect(() => paint(marks), [JSON.stringify(marks), box.w, box.h, theme]);

  const commit = (next: Mark[]) => {
    setHistory((h) => [...h.slice(-49), marks]);
    setUndone([]);
    onChange(next);
  };
  const undo = () => {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setUndone((u) => [...u, marks]);
    onChange(prev);
  };
  const redo = () => {
    const next = undone.at(-1);
    if (!next) return;
    setUndone((u) => u.slice(0, -1));
    setHistory((h) => [...h, marks]);
    onChange(next);
  };
  const clear = () => marks.length && commit([]);

  // Keys while drawing: P pencil, E eraser, [ ] size, ⌘Z undo, ⇧⌘Z redo, esc or return to finish.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return; // typing a note, or the slider
      const k = e.key.toLowerCase();
      const used = () => (e.preventDefault(), e.stopImmediatePropagation());
      if ((e.metaKey || e.ctrlKey) && k === "z") return used(), e.shiftKey ? redo() : undo();
      if (e.metaKey || e.ctrlKey) return;
      if (k === "escape" || k === "enter") return used(), onClose();
      if (k === "p" || k === "b") return used(), setTool("pen");
      if (k === "e") return used(), setTool("eraser");
      if (k === "a") return used(), setTool("arrow");
      if (k === "[") return used(), setSize((v) => Math.max(0, Math.round((v - 0.1) * 100) / 100));
      if (k === "]") return used(), setSize((v) => Math.min(1, Math.round((v + 0.1) * 100) / 100));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const at = (e: { clientX: number; clientY: number }) => {
    const r = ink.current!.getBoundingClientRect();
    return [round((e.clientX - r.left) / r.width), round((e.clientY - r.top) / r.height)] as const;
  };
  const moveCursor = (e: React.PointerEvent) => {
    const c = cursor.current;
    if (!c) return;
    const r = ink.current!.getBoundingClientRect();
    const d = Math.max(3, widthOf(tool, size) * Math.min(box.w, box.h));
    Object.assign(c.style, { width: `${d}px`, height: `${d}px`, transform: `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`, opacity: "1" });
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable || e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keep the stroke going outside the frame
    } catch {}
    if (note) return saveNote(); // a click outside the note box finishes it
    const [x, y] = at(e);
    live.current = { tool, color, size: widthOf(tool, size), points: tool === "arrow" ? [x, y, x, y] : [x, y] };
    paint([...marks, live.current]);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    moveCursor(e);
    const m = live.current;
    if (!m) return;
    if (m.tool === "arrow") {
      // The arrow follows the pointer from where it started.
      const [x, y] = at(e);
      m.points[2] = x;
      m.points[3] = y;
      return paint([...marks, m]);
    }
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const g = ink.current!.getContext("2d")!;
    for (const ev of events) {
      const [x, y] = at(ev);
      const px = m.points[m.points.length - 2]!;
      const py = m.points[m.points.length - 1]!;
      if (Math.hypot((x - px) * box.w, (y - py) * box.h) < 1.5) continue;
      m.points.push(x, y);
      // Just the new bit, straight away; the whole stroke is smoothed when it's done.
      g.save();
      g.globalCompositeOperation = m.tool === "eraser" ? "destination-out" : "source-over";
      g.strokeStyle = m.color;
      g.lineCap = "round";
      g.lineWidth = Math.max(1, m.size * Math.min(box.w, box.h));
      g.beginPath();
      g.moveTo(px * box.w, py * box.h);
      g.lineTo(x * box.w, y * box.h);
      g.stroke();
      g.restore();
    }
  };
  const up = () => {
    const m = live.current;
    live.current = null;
    if (!m) return;
    if (m.tool === "arrow") {
      // Too short to be an arrow: nothing. Otherwise kept, and its note box opens at the tail.
      if (Math.hypot((m.points[2]! - m.points[0]!) * box.w, (m.points[3]! - m.points[1]!) * box.h) < 14) return paint(marks);
      commit([...marks, { ...m, text: "" }]);
      return setNote({ index: marks.length, text: "" });
    }
    commit([...marks, m]);
  };
  // The note's words go on the arrow; one edit is one undo step.
  const saveNote = () => {
    if (!note) return;
    const current = shot.marks ?? [];
    const k = current[note.index];
    setNote(null);
    if (!k || (k.text ?? "") === note.text.trim()) return;
    commit(current.map((x, i) => (i === note.index ? { ...x, text: note.text.trim() } : x)));
  };
  // Double-click a note to change it.
  const editNote = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = ink.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const g = document.createElement("canvas").getContext("2d")!;
    const i = marks.findLastIndex((k) => {
      if (k.tool !== "arrow") return false;
      const nb = noteBox(g, box.w, box.h, k) ?? { x: k.points[0]! * box.w - 12, y: k.points[1]! * box.h - 12, w: 24, h: 24 };
      return px >= nb.x && px <= nb.x + nb.w && py >= nb.y && py <= nb.y + nb.h;
    });
    if (i >= 0) setNote({ index: i, text: marks[i]!.text ?? "" });
  };
  const noteAt = note && marks[note.index] ? { x: marks[note.index]!.points[0]! * box.w, y: marks[note.index]!.points[1]! * box.h } : null;

  return (
    <div className="sb-pad" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sb-pad-bar" role="toolbar" aria-label="Drawing tools">
        <span className="sb-pad-title"><b>Shot {String(index + 1).padStart(2, "0")}</b> Draw what you want instead</span>
        <div className="sb-pad-group">
          <button className={tool === "pen" ? "on" : ""} disabled={!editable} onClick={() => setTool("pen")} title="Pencil (P)"><Icon name="pencil" size={15} /> Pencil</button>
          <button className={tool === "arrow" ? "on" : ""} disabled={!editable} onClick={() => setTool("arrow")} title="Arrow with a note (A): drag from where the note goes to what it's about, then type"><Icon name="arrowNote" size={15} /> Arrow</button>
          <button className={tool === "eraser" ? "on" : ""} disabled={!editable} onClick={() => setTool("eraser")} title="Eraser (E): rubs out your lines, never the sketch"><Icon name="eraser" size={15} /> Eraser</button>
        </div>
        <div className="sb-pad-group colors">
          {MARK_COLORS.map((c) => (
            <button key={c} className={`sb-pad-color ${color === c && tool !== "eraser" ? "on" : ""}`} style={{ ["--c" as string]: c }} disabled={!editable}
              onClick={() => (setColor(c), tool === "eraser" && setTool("pen"))} title={COLOR_NAMES[c]} aria-label={COLOR_NAMES[c]} />
          ))}
        </div>
        <label className="sb-pad-group sb-pad-size" title="Size: slide left for thin, right for thick ([ and ])">
          <i className="sb-pad-size-dot" style={{ width: 4 + size * 14, height: 4 + size * 14, background: tool === "eraser" ? "transparent" : color }} />
          <input
            type="range" min={0} max={1} step={0.01} value={size} disabled={!editable} aria-label="Size"
            style={{ ["--v" as string]: `${size * 100}%` }} onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>
        <div className="sb-pad-group">
          <button className="icon" disabled={!editable || !history.length} onClick={undo} title="Undo (⌘Z)"><Icon name="undo" size={15} /></button>
          <button className="icon" disabled={!editable || !undone.length} onClick={redo} title="Redo (⇧⌘Z)"><Icon name="redo" size={15} /></button>
          <button disabled={!editable || !marks.length} onClick={clear} title="Rub out all your lines on this shot">Clear</button>
        </div>
        <button className="export-btn sb-pad-done" onClick={onClose}>Done <kbd>esc</kbd></button>
      </div>
      <div className={`sb-pad-stage ${tool}`} style={{ width: box.w, height: box.h }}>
        <canvas ref={base} style={{ width: box.w, height: box.h }} />
        <canvas
          ref={ink} className="sb-pad-ink" style={{ width: box.w, height: box.h }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={editNote}
          onPointerLeave={() => cursor.current && (cursor.current.style.opacity = "0")}
        />
        {editable && tool !== "arrow" && <div ref={cursor} className={`sb-pad-cursor ${tool}`} style={{ ["--c" as string]: color }} />}
        {note && noteAt && (
          <input
            className="sb-pad-note" autoFocus value={note.text} placeholder="What should change here?" maxLength={80}
            style={{ left: Math.min(box.w - 230, Math.max(4, noteAt.x - 115)), top: Math.min(box.h - 40, Math.max(4, noteAt.y - 18)), ["--c" as string]: marks[note.index]?.color }}
            onChange={(e) => setNote({ ...note, text: e.target.value })}
            // A box that loses focus the moment it opens (the click that made the arrow) keeps it; later, leaving it saves it.
            onBlur={(e) => (performance.now() - noteOpened.current < 250 ? requestAnimationFrame(() => e.target.focus()) : saveNote())}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") saveNote();
              if (e.key === "Escape") setNote(null);
            }}
          />
        )}
      </div>
      <p className="sb-pad-hint">
        {editable
          ? tool === "arrow"
            ? "Drag from where your note goes to what it's about, then type. Double-click a note to change it."
            : "Circle it, cross it out, sketch where it goes, or point at it with a note. Claude reads all of it when you press Redraw or Approve."
          : "This storyboard isn't waiting for an answer, so drawing is off."}
      </p>
    </div>
  );
}
