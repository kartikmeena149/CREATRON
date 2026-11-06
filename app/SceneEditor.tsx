// Inspector for an imported Claude edit: the scene as a whole, and the layer picked on the
// timeline: its words, font, colours, and where it is at the playhead. A property with keyframes
// gets a key at the playhead when changed; one without moves the layer for the whole edit.
// ◆ adds (or removes) a keyframe there.
import { useState } from "react";
import { CAPTION_FONTS } from "../src/schema.ts";
import type { Motion } from "../src/schema.ts";
import { type ChannelName, type SceneLayer, addKey, applyEdits, channelAt, deleteKeys, findLayer, keyCount, sceneStats, setChannelAt } from "../src/scene.ts";
import { useEditor } from "./store.ts";
import { replaceShot, sceneFile, shotOf } from "./SceneShots.tsx";

/** "rgb(12, 34, 56)" / "rgba(…)" / "#abc" → "#0c2238" for a colour input (alpha dropped). */
function toHex(c: string | undefined): string {
  if (!c) return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return "#000000";
  return `#${m[1].split(/[\s,/]+/).slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("")}`;
}

export function SceneEditor({ m }: { m: Motion }) {
  const { scenes, selectedLayer, openScene, time, editLayer, updateMotion, deleteMotion, checkpoint } = useEditor();
  const base = m.scene ? scenes[m.scene] : undefined;
  if (!base) return <section><p className="hint">Loading the Claude edit…</p></section>;
  const scene = applyEdits(base, Object.fromEntries(Object.entries(m.layers ?? {}).map(([k, e]) => [k, { ...e, hidden: false }])));
  const stats = sceneStats(base);
  const layer = selectedLayer ? findLayer(scene.layers, selectedLayer) : undefined;
  const edits = Object.keys(m.layers ?? {}).length;
  const open = openScene === m.id;
  return (
    <>
      <section className="motion-editor">
        <h3>
          Claude edit
          <button className="link" onClick={() => deleteMotion(m.id)}>Delete</button>
        </h3>
        <div className="scene-card">
          <span className={`si-badge ${base.kind ?? ""}`}>{base.kind === "remotion" ? "REMOTION" : "HTML"}</span>
          <div>
            <b>{m.text}</b>
            <div className="dim small">{stats.layers} layers · {stats.keyframes.toLocaleString()} keyframes · {base.width}×{base.height}</div>
          </div>
        </div>
        <div className="scene-actions">
          <button className={open ? "" : "primary"} onClick={() => useEditor.setState({ openScene: open ? null : m.id, selectedLayer: null, sceneKey: null })}>
            {open ? "Close layers" : "Open layers"}
          </button>
          {edits > 0 && <button className="ghost" title="Undo every change made to its layers" onClick={() => updateMotion(m.id, { layers: {} })}>Reset {edits} {edits === 1 ? "change" : "changes"}</button>}
        </div>
        {!layer && <p className="hint">{open ? "Click a layer on the timeline to change its text, colours and movement." : "Open the layers (or double-click the clip) to change any text, colour or keyframe."}</p>}
      </section>
      {layer && <LayerPanel key={layer.id} m={m} layer={layer} t={time - m.at + (m.offset ?? 0)} fps={base.fps} hidden={Boolean(m.layers?.[layer.id]?.hidden)}
        edit={(fn, record) => editLayer(m.id, layer.id, fn, record)} checkpoint={checkpoint} />}
    </>
  );
}

type Edit = Parameters<ReturnType<typeof useEditor.getState>["editLayer"]>[2];

function LayerPanel({ m, layer, t, fps, hidden, edit, checkpoint }: {
  m: Motion; layer: SceneLayer; t: number; fps: number; hidden: boolean; edit: (fn: Edit, record?: boolean) => void; checkpoint: () => void;
}) {
  const style = (k: string) => layer.style[k];
  const setStyle = (k: string, v: string, record = true) => edit((x) => ({ ...x, style: { ...x.style, [k]: v } }), record);
  const inClip = t >= (m.offset ?? 0) - 1e-6 && t <= (m.offset ?? 0) + m.duration + 1e-6;
  const changed = Boolean(m.layers?.[layer.id]);
  return (
    <section className="motion-editor layer-panel">
      <h3>
        {layer.name}
        <span className="layer-actions">
          {changed && <button className="link" onClick={() => edit(() => ({}))}>Reset</button>}
          <button className="link" onClick={() => edit((x) => ({ ...x, hidden: hidden ? undefined : true }))}>{hidden ? "Show" : "Hide"}</button>
        </span>
      </h3>
      <div className="dim small">{KIND_NAME[layer.kind]}</div>

      {layer.kind === "text" && <>
        <div className="field-label">Text</div>
        <textarea
          className="vl-input"
          rows={Math.min(5, Math.max(2, (layer.text ?? "").split("\n").length))}
          value={layer.text ?? ""}
          onFocus={checkpoint}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => edit((x) => ({ ...x, text: e.target.value }), false)}
        />
        <div className="field-grid">
          <label>
            <span className="field-label">Font</span>
            <select className="vl-input" value={(style("font-family") ?? "").split(",")[0].replace(/["']/g, "").trim()} onChange={(e) => setStyle("font-family", `"${e.target.value}", sans-serif`)}>
              {[...new Set([(style("font-family") ?? "").split(",")[0].replace(/["']/g, "").trim(), ...useEditor.getState().libraryFonts, ...CAPTION_FONTS])].filter(Boolean).map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">Size</span>
            <input className="vl-input" type="number" min={4} max={600} value={Math.round(parseFloat(style("font-size") ?? "16"))}
              onFocus={checkpoint} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => e.target.value && setStyle("font-size", `${e.target.value}px`, false)} />
          </label>
          <label>
            <span className="field-label">Weight</span>
            <select className="vl-input" value={style("font-weight") ?? "400"} onChange={(e) => setStyle("font-weight", e.target.value)}>
              {["300", "400", "500", "600", "700", "800", "900"].map((w) => <option key={w}>{w}</option>)}
            </select>
          </label>
          <ColorField label="Colour" value={style("color") ?? (layer.paint?.color ? "animated" : undefined)} onChange={(v) => setStyle("color", v)} />
        </div>
      </>}

      {(layer.kind === "group" || layer.kind === "text") && (style("background-color") || style("background-image") === undefined) && (
        <div className="field-grid">
          <ColorField label="Fill" value={style("background-color") ?? (layer.paint?.bg ? "animated" : undefined)} onChange={(v) => setStyle("background-color", v)} />
          <label>
            <span className="field-label">Corners</span>
            <input className="vl-input" type="number" min={0} max={2000} value={Math.round(parseFloat(style("border-radius") ?? "0"))}
              onFocus={checkpoint} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => e.target.value && setStyle("border-radius", `${e.target.value}px`, false)} />
          </label>
        </div>
      )}

      {(layer.kind === "video" || layer.kind === "image") && <ClipFields m={m} layer={layer} edit={edit} checkpoint={checkpoint} />}

      <div className="field-label">At the playhead {inClip ? <span className="dim">({t.toFixed(2)} s into the edit)</span> : <span className="dim">(move the playhead into the clip)</span>}</div>
      <div className="field-grid props">
        <Prop label="X" name="tx" layer={layer} t={t} fps={fps} edit={edit} checkpoint={checkpoint} enabled={inClip} />
        <Prop label="Y" name="ty" layer={layer} t={t} fps={fps} edit={edit} checkpoint={checkpoint} enabled={inClip} />
        <Prop label="Scale %" name="sx" link="sy" scale={100} layer={layer} t={t} fps={fps} edit={edit} checkpoint={checkpoint} enabled={inClip} />
        <Prop label="Rotation°" name="rot" layer={layer} t={t} fps={fps} edit={edit} checkpoint={checkpoint} enabled={inClip} />
        <Prop label="Opacity %" name="opacity" scale={100} min={0} max={100} layer={layer} t={t} fps={fps} edit={edit} checkpoint={checkpoint} enabled={inClip} />
        <Prop label="Blur px" name="blur" min={0} layer={layer} t={t} fps={fps} edit={edit} checkpoint={checkpoint} enabled={inClip} />
      </div>
    </section>
  );
}

/** A video or picture layer: what it shows, swapped for another file, and where in the video it plays from. */
function ClipFields({ m, layer, edit, checkpoint }: { m: Motion; layer: SceneLayer; edit: (fn: Edit, record?: boolean) => void; checkpoint: () => void }) {
  const file = sceneFile(m, layer.src ?? "");
  const replace = async () => {
    const path = await window.creatron.pickMedia(layer.kind === "video" ? "video" : "any");
    if (!path) return;
    const shot = shotOf(m, layer.id);
    if (shot) replaceShot(m, shot, path);
    else edit((x) => ({ ...x, src: path, offset: 0 }));
    useEditor.getState().addToLibrary(path);
  };
  return (
    <>
      <div className="field-label">Clip</div>
      <div className="clip-file">
        <span className="dim small" title={file}>{file.split("/").pop()}</span>
        <button onClick={replace}>Replace…</button>
      </div>
      {layer.kind === "video" && (
        <label className="prop">
          <span className="field-label">Plays from (s into the file)</span>
          <input className="vl-input" type="number" min={0} step={0.1} value={Math.round((layer.media?.offset ?? 0) * 100) / 100}
            onFocus={checkpoint} onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => e.target.value !== "" && edit((x) => ({ ...x, offset: Math.max(0, Number(e.target.value)) }), false)} />
        </label>
      )}
    </>
  );
}

const KIND_NAME: Record<SceneLayer["kind"], string> = { group: "Shape / group", text: "Text", image: "Picture", video: "Video", svg: "Drawing (SVG)" };

function ColorField({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <label>
      <span className="field-label">{label}</span>
      <span className="color-field">
        <input type="color" value={toHex(value === "animated" ? undefined : value)} onChange={(e) => onChange(e.target.value)} />
        <span className="dim small">{value === "animated" ? "animated" : value ? toHex(value) : "none"}</span>
      </span>
    </label>
  );
}

/**
 * One property at the playhead. Typing sets it there (a key when it has keyframes, the whole
 * layer otherwise); ◆ adds a key at the playhead or takes the one there out.
 */
function Prop({ label, name, link, scale = 1, min, max, layer, t, fps, edit, checkpoint, enabled }: {
  label: string; name: ChannelName; link?: ChannelName; scale?: number; min?: number; max?: number;
  layer: SceneLayer; t: number; fps: number; edit: (fn: Edit, record?: boolean) => void; checkpoint: () => void; enabled: boolean;
}) {
  const c = layer.anim[name];
  const value = channelAt(name, c, t) * scale;
  const [draft, setDraft] = useState<string | null>(null);
  const keyed = keyCount(c) > 0;
  const here = Array.isArray(c) && c.some(([k]) => Math.abs(k - t) < 0.5 / fps);
  const names = link ? [name, link] : [name];
  const set = (v: number) =>
    edit((x) => ({ ...x, anim: { ...x.anim, ...Object.fromEntries(names.map((n) => [n, setChannelAt(layer.anim[n], t, v / scale, fps)])) } }), false);
  const toggleKey = () =>
    edit((x) => ({
      ...x,
      anim: { ...x.anim, ...Object.fromEntries(names.map((n) => [n, here ? deleteKeys(layer.anim[n] as [number, number][], [Math.round(t * 1000) / 1000, ...(layer.anim[n] as [number, number][]).filter(([k]) => Math.abs(k - t) < 0.5 / fps).map(([k]) => k)]) : addKey(layer.anim[n], n, t, fps)])) },
    }));
  return (
    <label className="prop">
      <span className="field-label">
        {label}
        <button className={`key-btn ${here ? "on" : keyed ? "has" : ""}`} disabled={!enabled} title={here ? "Remove the keyframe at the playhead" : "Add a keyframe at the playhead"} onClick={(e) => (e.preventDefault(), toggleKey())}>◆</button>
      </span>
      <input
        className="vl-input"
        type="number"
        step={scale === 100 ? 1 : name === "rot" ? 0.5 : 1}
        min={min}
        max={max}
        disabled={!enabled}
        value={draft ?? String(Math.round(value * 100) / 100)}
        onFocus={() => (checkpoint(), setDraft(String(Math.round(value * 100) / 100)))}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(v)) set(min !== undefined || max !== undefined ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)) : v);
        }}
      />
    </label>
  );
}
