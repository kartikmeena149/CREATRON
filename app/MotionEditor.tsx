// Inspector section for the selected title / lower third on the M1 track.
import { useEditor } from "./store.ts";

const COLORS = ["#facc15", "#22c55e", "#38bdf8", "#f472b6", "#ff5a5a", "#ffffff"];

export function MotionEditor() {
  const { plan, selectedMotion, updateMotion, deleteMotion, checkpoint } = useEditor();
  const m = plan.motion.find((x) => x.id === selectedMotion);
  if (!m) return null;
  // Typing changes the text live; one undo step per field visit.
  const field = (key: "text" | "subtext", placeholder: string) => (
    <input
      className="vl-input"
      value={m[key]}
      placeholder={placeholder}
      maxLength={80}
      onFocus={checkpoint}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => updateMotion(m.id, { [key]: key === "text" ? e.target.value || " " : e.target.value }, false)}
    />
  );
  return (
    <section className="motion-editor">
      <h3>
        Text
        <button className="link" onClick={() => deleteMotion(m.id)}>Delete</button>
      </h3>
      {m.template === "custom" ? (
        <p className="hint">✦ {m.component}: an animation the AI wrote for this video. Ask the AI to change how it moves or looks.</p>
      ) : (
        <div className="segmented">
          {(["title", "lower-third"] as const).map((t) => (
            <button key={t} className={m.template === t ? "on" : ""} onClick={() => m.template !== t && updateMotion(m.id, { template: t })}>
              {t === "title" ? "Title" : "Lower third"}
            </button>
          ))}
        </div>
      )}
      <div className="field-label">Text</div>
      {field("text", "Main words")}
      <div className="field-label">Second line</div>
      {field("subtext", "Optional")}
      <div className="field-label">Accent</div>
      <div className="swatches">
        {COLORS.map((c) => (
          <button key={c} className={`swatch ${m.color.toLowerCase() === c ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => updateMotion(m.id, { color: c })} />
        ))}
      </div>
    </section>
  );
}
