// Captions in the inspector: look (style, size, colour, case), where they sit, and the
// selected caption's own text and position.
import { useEffect, useState } from "react";
import { outputSize } from "../src/frame.ts";
import { buildCues, captionsOf } from "../src/timeline.ts";
import { timecode } from "./format.ts";
import { NumberField } from "./PositionSize.tsx";
import { useEditor } from "./store.ts";

const SWATCHES = ["#ffffff", "#ffe14d", "#6ef59a", "#5ee1ff", "#ff7ac6", "#ff5a5a"];

export function CaptionStyle() {
  const { project, plan, checkpoint, setCaptionStyle, selectedCue, addCaption, resetCaptions } = useEditor();
  if (!project) return null;
  const caps = plan.captions;
  const out = outputSize(plan, project.analysis);
  const clamp = (v: number) => Math.max(-0.5, Math.min(0.5, v));

  return (
    <section className="caption-style">
      <h3>
        Captions
        <Switch value={caps.enabled} onChange={(enabled) => setCaptionStyle({ enabled })} />
      </h3>
      {caps.enabled && (
        <>
          <div className="segmented">
            {(["bold", "minimal"] as const).map((s) => (
              <button key={s} className={caps.style === s ? "on" : ""} onClick={() => caps.style !== s && setCaptionStyle({ style: s })}>
                {s === "bold" ? "Bold" : "Minimal"}
              </button>
            ))}
          </div>

          <div className="field-label">Animation</div>
          <div className="segmented">
            {([["none", "None"], ["pop", "Pop"], ["highlight", "Highlight"], ["word", "1 word"]] as const).map(([a, label]) => (
              <button key={a} className={caps.animation === a ? "on" : ""} onClick={() => caps.animation !== a && setCaptionStyle({ animation: a })}>
                {label}
              </button>
            ))}
          </div>
          {(caps.animation === "highlight" || caps.animation === "word") && (
            <>
              <div className="field-label">Spoken word colour</div>
              <div className="swatches">
                {SWATCHES.map((c) => (
                  <button key={c} className={`swatch ${caps.highlight.toLowerCase() === c ? "on" : ""}`} style={{ background: c }}
                    title={c} onClick={() => setCaptionStyle({ highlight: c })} />
                ))}
              </div>
            </>
          )}

          <div className="field-label">Size</div>
          <div className="field-row">
            <input type="range" className="grow" min={40} max={300} step={1} value={Math.round(caps.size * 100)}
              onPointerDown={checkpoint} onChange={(e) => setCaptionStyle({ size: Number(e.target.value) / 100 }, false)} />
            <NumberField value={caps.size * 100} format={(v) => `${Math.round(v)}%`} step={5} onStart={checkpoint}
              onChange={(v) => setCaptionStyle({ size: Math.max(40, Math.min(300, v)) / 100 }, false)} />
          </div>

          <div className="field-label">Colour</div>
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button key={c} className={`swatch ${caps.color.toLowerCase() === c ? "on" : ""}`} style={{ background: c }}
                title={c} onClick={() => setCaptionStyle({ color: c })} />
            ))}
            <label className="swatch custom" title="Pick any colour">
              <input type="color" value={caps.color} onPointerDown={checkpoint}
                onChange={(e) => setCaptionStyle({ color: e.target.value }, false)} />
            </label>
          </div>

          <div className="row">
            <div>UPPERCASE</div>
            <Switch value={caps.uppercase} onChange={(uppercase) => setCaptionStyle({ uppercase })} />
          </div>

          <div className="field-label">Position</div>
          <div className="field-row">
            <NumberField prefix="X" value={caps.x * out.width} format={(v) => String(Math.round(v))} step={1}
              onStart={checkpoint} onChange={(v) => setCaptionStyle({ x: clamp(v / out.width) }, false)} />
            <NumberField prefix="Y" value={caps.y * out.height} format={(v) => String(Math.round(v))} step={1}
              onStart={checkpoint} onChange={(v) => setCaptionStyle({ y: clamp(v / out.height) }, false)} />
          </div>
          <p className="hint">Drag captions in the viewer to move them all. Hold ⌥ to move just one.</p>

          {caps.cues ? (
            <div className="row">
              <div>
                <div>Edited captions</div>
                <div className="hint">{caps.cues.length} captions, your own wording</div>
              </div>
              <button className="small-btn" onClick={resetCaptions} title="Throw away caption edits and re-caption from your speech">
                Regenerate
              </button>
            </div>
          ) : (
            <label className="slider">
              <span className="slider-head"><span>Words per caption</span><span className="value">{caps.wordsPerCaption}</span></span>
              <input type="range" min={1} max={8} step={1} value={caps.wordsPerCaption}
                onPointerDown={checkpoint} onChange={(e) => setCaptionStyle({ wordsPerCaption: Number(e.target.value) }, false)} />
            </label>
          )}

          <button className="wide-btn" onClick={addCaption}>＋ Add caption at playhead</button>

          {selectedCue !== null && <SelectedCaption index={selectedCue} />}
        </>
      )}
    </section>
  );
}

function SelectedCaption({ index }: { index: number }) {
  const { project, plan, editCaption, deleteCaption, selectCue } = useEditor();
  const caption = captionsOf(plan, project!.analysis.words)[index];
  const placed = buildCues(plan, project!.analysis.words).find((c) => c.index === index);
  const [text, setText] = useState(caption?.text ?? "");
  useEffect(() => setText(caption?.text ?? ""), [index, caption?.text]);
  if (!caption) return null;
  const hasOwnPosition = caption.x !== undefined || caption.y !== undefined;

  return (
    <div className="selected-caption">
      <div className="selected-head">
        <span>Selected caption</span>
        <button className="link" onClick={() => selectCue(null)}>Done</button>
      </div>
      <textarea
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          const now = e.target.value; // the box itself, in case React hasn't re-rendered yet
          if (now.trim() && now !== caption.text) editCaption(index, { text: now });
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), (e.target as HTMLTextAreaElement).blur());
        }}
      />
      <div className="meta">
        {placed ? <span>Shows {timecode(placed.start)} – {timecode(placed.end)}</span> : <span>Cut out of the edit</span>}
      </div>
      <div className="selected-actions">
        {hasOwnPosition && (
          <button className="small-btn" onClick={() => editCaption(index, { x: undefined, y: undefined })}>
            Reset own position
          </button>
        )}
        <button className="small-btn danger" onClick={() => deleteCaption(index)}>Delete caption</button>
      </div>
    </div>
  );
}

function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle ${value ? "on" : ""}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}><i /></button>;
}
