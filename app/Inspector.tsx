// Left panel: hands-on controls for the selected clip, the frame, captions and the voice.
// Sliders save one undo step per drag (checkpoint on press, live updates while moving).
import type { EditPlan } from "../src/schema.ts";
import { timecode } from "./format.ts";
import { CaptionStyle } from "./CaptionStyle.tsx";
import { MotionEditor } from "./MotionEditor.tsx";
import { PositionSize } from "./PositionSize.tsx";
import { useEditor } from "./store.ts";

export function Inspector() {
  const { project, plan, selected, commit, checkpoint, live, updateSegment } = useEditor();
  if (!project) return <aside className="panel inspector" />;
  const a = project.analysis;
  const seg = selected !== null ? plan.segments[selected] : undefined;
  const setPlan = (patch: Partial<EditPlan>) => commit({ ...plan, ...patch });
  const liveAudio = (patch: Partial<EditPlan["audio"]>) => live({ ...plan, audio: { ...plan.audio, ...patch } });


  return (
    <aside className="panel inspector">
      <section>
        <h3>Media</h3>
        <div className="file-name" title={a.source}>{a.source.split("/").pop()}</div>
        <div className="meta">
          <span>{a.width}×{a.height}</span>
          <span>{a.fps} fps</span>
          <span>{timecode(a.duration)}</span>
          <span>{a.words.length} words</span>
        </div>
      </section>

      <MotionEditor />

      <section>
        <h3>Clip {seg ? selected! + 1 : ""}</h3>
        {seg ? (
          <>
            <div className="meta">
              <span>In {timecode(seg.start)}</span>
              <span>Out {timecode(seg.end)}</span>
            </div>
            <Slider label="Speed" unit="×" min={0.5} max={2} step={0.05} value={seg.speed}
              onStart={checkpoint} onChange={(v) => updateSegment(selected!, { speed: v }, false)} />
            <Slider label="Punch-in zoom" unit="%" min={1} max={2} step={0.01} value={seg.zoom} display={(v) => Math.round(v * 100)}
              onStart={checkpoint} onChange={(v) => updateSegment(selected!, { zoom: v }, false)} />
            <Slider label="Volume" unit="%" min={0} max={2} step={0.01} value={seg.volume ?? 1} display={(v) => Math.round(v * 100)}
              onStart={checkpoint} onChange={(v) => updateSegment(selected!, { volume: v }, false)} />
          </>
        ) : (
          <p className="hint">Click a clip on the timeline to adjust its speed, zoom and volume. ⇧-click more clips, then tell the AI what to do with them.</p>
        )}
      </section>

      <section>
        <h3>Frame</h3>
        <Segmented
          value={plan.aspect}
          options={[["source", "Original"], ["9:16", "9:16"], ["1:1", "1:1"], ["16:9", "16:9"]]}
          onChange={(aspect) => setPlan({ aspect: aspect as EditPlan["aspect"] })}
        />
      </section>

      <PositionSize />

      <CaptionStyle />

      <section>
        <h3>Voice</h3>
        <Row label="Clean up noise" hint="removes hiss and hum">
          <Toggle value={plan.audio.denoise} onChange={(denoise) => commit({ ...plan, audio: { ...plan.audio, denoise } })} />
        </Row>
        <Slider label="Clarity" unit=" dB" min={0} max={6} step={0.5} value={plan.audio.clarity}
          onStart={checkpoint} onChange={(v) => liveAudio({ clarity: v })} />
        <Row label="Reels loudness" hint="levels to -14 LUFS on export">
          <Toggle value={plan.audio.normalize} onChange={(normalize) => commit({ ...plan, audio: { ...plan.audio, normalize } })} />
        </Row>
        {!plan.audio.normalize && (
          <Slider label="Volume" unit=" dB" min={-12} max={12} step={0.5} value={plan.audio.volumeDb}
            onStart={checkpoint} onChange={(v) => liveAudio({ volumeDb: v })} />
        )}
        {plan.audio.denoise && <p className="hint">Noise cleanup is applied in full on export.</p>}
      </section>
    </aside>
  );
}

function Slider(p: {
  label: string; min: number; max: number; step: number; value: number; unit?: string;
  display?: (v: number) => string | number; onStart: () => void; onChange: (v: number) => void;
}) {
  const shown = p.display ? p.display(p.value) : Number(p.value.toFixed(2));
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{p.label}</span>
        <span className="value">{shown}{p.unit ?? ""}</span>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value}
        onPointerDown={p.onStart} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? "on" : ""} onClick={() => v !== value && onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle ${value ? "on" : ""}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}><i /></button>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <div>
        <div>{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
