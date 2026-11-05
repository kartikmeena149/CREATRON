// Every caption in one list, like a subtitle editor: click a time to jump there,
// type to fix any character, delete what you don't want.
import { useEffect, useRef, useState } from "react";
import { buildCues, captionsOf } from "../src/timeline.ts";
import { timecode } from "./format.ts";
import { useEditor } from "./store.ts";

export function CaptionList() {
  const { project, plan, selectedCue, time, selectCue, seek, setPlaying } = useEditor();
  const list = useRef<HTMLDivElement>(null);
  const words = project?.analysis.words ?? [];
  const all = captionsOf(plan, words);
  const placed = new Map(buildCues(plan, words).map((c) => [c.index, c]));
  const playing = [...placed.values()].find((c) => time >= c.start && time < c.end)?.index;

  // Keep the selected caption in view.
  useEffect(() => {
    list.current?.querySelector(".cap-row.selected")?.scrollIntoView({ block: "nearest" });
  }, [selectedCue]);

  // The on/off switch sits right above, in the caption style section.
  if (!project || !plan.captions.enabled) return null;

  return (
    <section className="cap-section">
      <h3>Caption text <span className="dim small">{all.length}</span></h3>
      <div className="cap-list" ref={list}>
        {all.map((c, i) => {
          const cue = placed.get(i);
          return (
            <div
              key={i}
              className={`cap-row ${selectedCue === i ? "selected" : ""} ${playing === i ? "playing" : ""} ${cue ? "" : "cut"}`}
              onClick={() => selectCue(i)}
            >
              <button
                className="cap-time"
                title={cue ? "Jump here" : "This part was cut from the edit"}
                disabled={!cue}
                onClick={(e) => {
                  e.stopPropagation();
                  setPlaying(false);
                  if (cue) seek(cue.start + 0.01);
                  selectCue(i);
                }}
              >
                {cue ? timecode(cue.start) : "cut"}
              </button>
              <CaptionText index={i} text={c.text} />
              <button className="cap-del" title="Delete caption" onClick={(e) => (e.stopPropagation(), useEditor.getState().deleteCaption(i))}>
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CaptionText({ index, text }: { index: number; text: string }) {
  const [value, setValue] = useState(text);
  useEffect(() => setValue(text), [text]);
  // Saves what's in the box right now (a quick type-then-Enter can beat React's re-render).
  const save = (now: string) => now.trim() && now !== text && useEditor.getState().editCaption(index, { text: now });
  return (
    <textarea
      className="cap-text"
      rows={1}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={() => useEditor.getState().selectCue(index)}
      onBlur={(e) => save(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), (e.target as HTMLTextAreaElement).blur());
        if (e.key === "Escape") {
          const box = e.target as HTMLTextAreaElement;
          box.value = text; // so the blur that follows saves nothing
          setValue(text);
          box.blur();
        }
      }}
    />
  );
}
