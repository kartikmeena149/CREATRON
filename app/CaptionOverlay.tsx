// The caption on top of the viewer. Click to select, drag to move it (hold ⌥ to move all captions;
// "Apply to all" gives every caption this one's place), double-click to edit its text in place.
// With `ghost` (animated captions, drawn by the Remotion layer) only the box is shown, not the text.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { captionsOf, captionWrapWidth, cueFontSize, lookBox, type Cue } from "../src/timeline.ts";
import { useEditor } from "./store.ts";
import { RansomText } from "../motion/Ransom.tsx";

/** How close (screen pixels) the caption's middle must come to the frame's centre line to snap onto it. */
const SNAP = 6;

export function CaptionOverlay({ cue, frame, ghost = false }: { cue: Cue; frame: { w: number; h: number }; ghost?: boolean }) {
  const { plan, project, selectedCue, selectCue, setPlaying } = useEditor();
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [guides, setGuides] = useState({ x: false, y: false });
  const textEl = useRef<HTMLSpanElement>(null);
  const boxEl = useRef<HTMLDivElement>(null);
  // While resizing: the screen point the pinned corner must stay on.
  const anchor = useRef<{ right: boolean; bottom: boolean; x: number; y: number; onlyThis: boolean } | null>(null);
  const caps = plan.captions;
  const look = cue.look;
  const selected = selectedCue === cue.index;

  // Captions are placed by their middle, so a new size moves the corners: after each resize step,
  // shift the caption so the pinned corner is back where it was (exact even when the text re-wraps).
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a || !boxEl.current) return;
    const r = boxEl.current.getBoundingClientRect();
    const dx = (a.x - (a.right ? r.right : r.left)) / frame.w;
    const dy = (a.y - (a.bottom ? r.bottom : r.top)) / frame.h;
    if (Math.abs(dx * frame.w) < 0.5 && Math.abs(dy * frame.h) < 0.5) return;
    const s = useEditor.getState();
    const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
    if (a.onlyThis) {
      const own = captionsOf(s.plan, project!.analysis.words)[cue.index];
      const x = clamp((own?.x ?? 0) + dx, 1);
      const y = clamp((own?.y ?? 0) + dy, 1);
      if (x !== (own?.x ?? 0) || y !== (own?.y ?? 0)) s.editCaption(cue.index, { x, y }, false);
    } else {
      const x = clamp(s.plan.captions.x + dx, 0.5);
      const y = clamp(s.plan.captions.y + dy, 0.5);
      if (x !== s.plan.captions.x || y !== s.plan.captions.y) s.setCaptionStyle({ x, y }, false);
    }
  });

  // Leaving the caption (playhead moved on) ends editing.
  useEffect(() => setEditing(false), [cue.index]);
  useEffect(() => {
    if (!editing || !textEl.current) return;
    const el = textEl.current;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }, [editing]);

  const startDrag = (e: React.PointerEvent) => {
    e.stopPropagation(); // don't move the video underneath
    if (editing || e.button !== 0) return;
    setPlaying(false); // hold the caption on screen while it's picked and dragged
    selectCue(cue.index);
    const st = useEditor.getState();
    const own = captionsOf(st.plan, project!.analysis.words)[cue.index];
    const start = { gx: st.plan.captions.x, gy: st.plan.captions.y, ox: own?.x ?? 0, oy: own?.y ?? 0 };
    const x0 = e.clientX;
    const y0 = e.clientY;
    const onlyThis = !e.altKey;
    let moved = false;
    const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
    const onMove = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
        moved = true;
        useEditor.getState().checkpoint();
        setDragging(true);
      }
      // Where the caption's middle lands (as a shift from the frame's middle); it snaps onto the
      // frame's centre lines when within a few pixels, and the matching guide shows.
      let cx = start.gx + start.ox + (ev.clientX - x0) / frame.w;
      let cy = start.gy + start.oy + (ev.clientY - y0) / frame.h;
      const snapX = !ev.metaKey && Math.abs(cx * frame.w) < SNAP;
      const snapY = !ev.metaKey && Math.abs(cy * frame.h) < SNAP;
      if (snapX) cx = 0;
      if (snapY) cy = 0;
      setGuides({ x: snapX, y: snapY });
      const s = useEditor.getState();
      if (onlyThis) s.editCaption(cue.index, { x: clamp(cx - start.gx, 1), y: clamp(cy - start.gy, 1) }, false);
      else s.setCaptionStyle({ x: clamp(cx - start.ox, 0.5), y: clamp(cy - start.oy, 0.5) }, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      setGuides({ x: false, y: false });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  // A corner handle: drag it to resize the text while the opposite corner stays where it is. Like
  // everything in the style bar it changes only this caption ("Apply to all" passes it on); hold ⌥
  // to resize all captions together.
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const corner = (["nw", "ne", "sw", "se"] as const).find((c) => e.currentTarget.classList.contains(c))!;
    const pin = { right: corner.endsWith("w"), bottom: corner.startsWith("n") };
    const ax = pin.right ? box.right : box.left;
    const ay = pin.bottom ? box.bottom : box.top;
    const d0 = Math.max(4, Math.hypot(e.clientX - ax, e.clientY - ay));
    const st = useEditor.getState();
    const all = captionsOf(st.plan, project!.analysis.words);
    const start = { size: st.plan.captions.size, own: look.size, cues: st.plan.captions.cues ? all : undefined };
    const onlyThis = !e.altKey;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 2) return;
        moved = true;
        useEditor.getState().checkpoint();
        setDragging(true);
        anchor.current = { ...pin, x: ax, y: ay, onlyThis };
      }
      const k = Math.hypot(ev.clientX - ax, ev.clientY - ay) / d0;
      const s = useEditor.getState();
      if (onlyThis) return s.setCaptionLook(cue.index, { size: Math.max(0.3, Math.min(4, start.own * k)) }, false);
      const cues = start.cues?.map((c) => (c.look?.size ? { ...c, look: { ...c.look, size: Math.max(0.3, Math.min(4, c.look.size * k)) } } : c));
      s.setCaptionStyle({ size: Math.max(0.4, Math.min(3, start.size * k)), ...(cues ? { cues } : {}) }, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      anchor.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  const finish = (save: boolean) => {
    const text = textEl.current?.innerText.replace(/\n+$/, "") ?? "";
    setEditing(false);
    if (save && text.trim() && text !== cue.text) useEditor.getState().editCaption(cue.index, { text });
  };

  return (
    <>
    {guides.x && <div className="snap-guide v" />}
    {guides.y && <div className="snap-guide h" />}
    <div
      ref={boxEl}
      className={`caption ${look.outline === "outline" ? "bold" : look.outline === "box" ? "minimal" : "plain"} ${selected ? "selected" : ""} ${editing ? "editing" : ""} ${ghost ? "ghost" : ""} ${dragging ? "dragging" : ""}`}
      style={{
        left: `${(0.5 + cue.x) * 100}%`,
        top: `${(0.5 + cue.y) * 100}%`,
        maxWidth: captionWrapWidth(look, frame.w),
        fontSize: cueFontSize(plan, look, frame.w, frame.h),
        color: look.color,
        // While editing, show the real letters so what you type is what gets saved.
        textTransform: caps.uppercase && !editing ? "uppercase" : "none",
      }}
      onPointerDown={startDrag}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setPlaying(false);
        setEditing(true);
      }}
      title="Drag to move this caption · drag a corner to resize it · hold ⌥ to do either to all captions · double-click to edit"
    >
      {selected && !editing && (["nw", "ne", "sw", "se"] as const).map((c) => (
        <i key={c} className={`cap-handle ${c}`} onPointerDown={startResize} />
      ))}
      <span
        ref={textEl}
        contentEditable={editing}
        suppressContentEditableWarning
        style={{
          fontFamily: `"${look.font}", Arial, sans-serif`,
          fontWeight: look.bold ? 700 : 400,
          fontStyle: look.italic ? "italic" : "normal",
          textDecoration: [look.underline && "underline", look.strike && "line-through"].filter(Boolean).join(" ") || "none",
          background: lookBox(look) || "transparent",
          padding: lookBox(look) ? "0.15em 0.5em" : undefined,
          borderRadius: lookBox(look) ? "0.3em" : undefined,
        }}
        onBlur={() => editing && finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation(); // typing must not trigger editor shortcuts (S, Space, ⌫)
          if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), finish(true));
          if (e.key === "Escape") finish(false);
        }}
      >
        {/* Paper cut-outs: each letter on its own scrap (plain text while typing). */}
        {look.outline === "ransom" && !editing && !ghost ? <RansomText text={caps.uppercase ? cue.text.toUpperCase() : cue.text} align={look.align} /> : cue.text}
      </span>
    </div>
    </>
  );
}
