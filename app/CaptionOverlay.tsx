// The caption on top of the viewer. Click to select, drag to move all captions
// (hold ⌥ to move only this one), double-click to edit its text in place.
import { useEffect, useRef, useState } from "react";
import { captionsOf, cueFontSize, lookBox, type Cue } from "../src/timeline.ts";
import { useEditor } from "./store.ts";

export function CaptionOverlay({ cue, frame }: { cue: Cue; frame: { w: number; h: number } }) {
  const { plan, project, selectedCue, selectCue, setPlaying } = useEditor();
  const [editing, setEditing] = useState(false);
  const textEl = useRef<HTMLSpanElement>(null);
  const caps = plan.captions;
  const look = cue.look;
  const selected = selectedCue === cue.index;

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
    selectCue(cue.index);
    const st = useEditor.getState();
    const own = captionsOf(st.plan, project!.analysis.words)[cue.index];
    const start = { gx: st.plan.captions.x, gy: st.plan.captions.y, ox: own?.x ?? 0, oy: own?.y ?? 0 };
    const x0 = e.clientX;
    const y0 = e.clientY;
    const onlyThis = e.altKey;
    let moved = false;
    const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / frame.w;
      const dy = (ev.clientY - y0) / frame.h;
      if (!moved) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
        moved = true;
        useEditor.getState().checkpoint();
      }
      const s = useEditor.getState();
      if (onlyThis) s.editCaption(cue.index, { x: clamp(start.ox + dx, 1), y: clamp(start.oy + dy, 1) }, false);
      else s.setCaptionStyle({ x: clamp(start.gx + dx, 0.5), y: clamp(start.gy + dy, 0.5) }, false);
    };
    const up = () => (window.removeEventListener("pointermove", onMove), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  const finish = (save: boolean) => {
    const text = textEl.current?.innerText.replace(/\n+$/, "") ?? "";
    setEditing(false);
    if (save && text.trim() && text !== cue.text) useEditor.getState().editCaption(cue.index, { text });
  };

  return (
    <div
      className={`caption ${look.outline === "outline" ? "bold" : look.outline === "box" ? "minimal" : "plain"} ${selected ? "selected" : ""} ${editing ? "editing" : ""}`}
      style={{
        left: `${(0.5 + cue.x) * 100}%`,
        top: `${(0.5 + cue.y) * 100}%`,
        maxWidth: frame.w * 0.86,
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
      title="Drag to move all captions · ⌥ drag moves only this one · double-click to edit"
    >
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
        {cue.text}
      </span>
    </div>
  );
}
