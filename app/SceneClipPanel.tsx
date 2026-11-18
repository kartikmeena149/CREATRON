// The panel for a clip of an imported Claude edit (a shot, a title, a graphic), like an editor's
// inspector: what it is and when, its place, size, turn and opacity (each with its keyframes),
// a title's words, font and colour, a shot's footage. Every change is one undo step per gesture.
import { useState } from "react";
import { type Keys, valueAt } from "../src/keyframes.ts";
import type { ClipProp, Scene } from "../src/scene.ts";
import { type SceneClip, clipKey, clipKeys, clipStill, withClipKeys } from "../src/sceneClips.ts";
import type { Motion } from "../src/schema.ts";
import { shortTime } from "./format.ts";
import { Icon } from "./icons.tsx";
import { MEDIA_DRAG, Slider } from "./Inspector.tsx";
import { EaseRow, KeyButton } from "./Keyframes.tsx";
import { clipsOf, deleteSceneClip, editClip, sceneFile, setClipProp, useSelectedClip } from "./SceneClips.tsx";
import { isImage } from "./format.ts";
import { useEditor } from "./store.ts";

const KIND_NAME: Record<SceneClip["kind"], string> = { shot: "Footage", fill: "Blur fill", effect: "Effect", text: "Title", graphic: "Graphic", background: "Background" };

/** Each property's slider: label, range, step, shown as. */
const FIELDS: { p: ClipProp; label: string; min: number; max: number; step: number; unit: string; show: (v: number) => number }[] = [
  { p: "x", label: "Position X", min: -1, max: 1, step: 0.002, unit: "%", show: (v) => Math.round(v * 1000) / 10 },
  { p: "y", label: "Position Y", min: -1, max: 1, step: 0.002, unit: "%", show: (v) => Math.round(v * 1000) / 10 },
  { p: "scale", label: "Scale", min: 0.1, max: 3, step: 0.01, unit: "%", show: (v) => Math.round(v * 100) },
  { p: "rotate", label: "Rotation", min: -180, max: 180, step: 0.5, unit: "°", show: (v) => Math.round(v * 10) / 10 },
  { p: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01, unit: "%", show: (v) => Math.round(v * 100) },
];

export function SceneClipPanel() {
  const sel = useSelectedClip();
  const time = useEditor((s) => s.time);
  if (!sel) return null;
  return <ClipPanel key={`${sel.m.id}:${sel.clip.id}`} m={sel.m} scene={sel.scene} clip={sel.clip} time={time} />;
}

function ClipPanel({ m, scene, clip, time }: { m: Motion; scene: Scene; clip: SceneClip; time: number }) {
  return (
    <>
      <ClipHeader m={m} scene={scene} clip={clip} />
      {clip.kind === "text" && (
        <section className="sc-panel">
          <button className="wide-btn" onClick={() => useEditor.getState().set({ leftView: "text" })}>Edit its words, font and colour</button>
        </section>
      )}
      {(clip.kind === "shot" || clip.kind === "fill") && <Footage m={m} clip={clip} />}
      {!clip.locked && <ClipTransform m={m} scene={scene} clip={clip} time={time} />}
    </>
  );
}

/** What a clip is and when, its shot's layers, and Reset / Delete / Untrim / Move back. */
export function ClipHeader({ m, scene, clip, compact = false }: { m: Motion; scene: Scene; clip: SceneClip; compact?: boolean }) {
  const offset = m.offset ?? 0;
  const at = (t: number) => m.at - offset + t; // scene seconds → timeline
  const own = m.layers?.[clipKey(clip.id)];
  // The other layers of its shot.
  const siblings = clip.parent ? clipsOf(m, scene).filter((c) => c.parent === clip.parent && c.id !== clip.id) : [];
  const footage = siblings.find((c) => c.kind === "shot");
  const linkedLayer = clip.kind === "shot" || clip.kind === "fill" || clip.kind === "effect";
  const g = clip.group;
  const gEdit = g ? m.layers?.[clipKey(g.id)] : undefined;
  const changed = Boolean(own) || clip.parts.some((p) => m.layers?.[p]) || clip.textLayers.some((id) => m.layers?.[id]) || clip.videos.some((id) => m.layers?.[id]);
  // A shot's picture layers move and trim as the shot; anything else on its own.
  const untrim = () => (linkedLayer && g ? useEditor.getState().editLayer(m.id, clipKey(g.id), (e) => ({ ...e, members: [g.id], window: undefined })) : editClip(m, clip, (e) => ({ ...e, window: undefined })));
  const moveBack = () => (linkedLayer && g ? useEditor.getState().editLayer(m.id, clipKey(g.id), (e) => ({ ...e, members: [g.id], shift: undefined })) : editClip(m, clip, (e) => ({ ...e, shift: undefined })));
  const reset = () => {
    const s = useEditor.getState();
    const layers = { ...m.layers };
    delete layers[clipKey(clip.id)];
    for (const id of [...clip.textLayers, ...clip.videos]) delete layers[id];
    s.commit({ ...s.plan, motion: s.plan.motion.map((x) => (x.id === m.id ? { ...x, layers } : x)) });
  };

  return (
      <section className="sc-panel">
        <h3>
          <span className={`sc-badge ${clip.kind}`}>{KIND_NAME[clip.kind]}</span>
          <span className="sc-actions">
            {changed && <button className="link" title="Undo every change made to this clip" onClick={reset}>Reset</button>}
            {!clip.locked && <button className="link" onClick={() => deleteSceneClip(m, clip)}>Delete</button>}
          </span>
        </h3>
        <div className="sc-title">{clip.name}</div>
        <div className="meta">
          <span>In {shortTime(at(clip.start))}</span>
          <span>Length {(clip.end - clip.start).toFixed(2)}s</span>
          {(linkedLayer ? gEdit?.window : own?.window) && <button className="link" onClick={() => untrim()}>Untrim</button>}
          {(linkedLayer ? gEdit?.shift : own?.shift) ? <button className="link" title="Put it back where it was in the edit" onClick={() => moveBack()}>Move back</button> : null}
        </div>
        {siblings.length > 0 && !compact && (
          <div className="sc-layers">
            <span className="dim small">{linkedLayer ? "Layers of this shot (they move together)" : "In the shot"}</span>
            <div className="sc-layer-list">
              {[clip, ...siblings].sort((a, b) => b.z - a.z).map((c) => (
                <button key={c.id} className={`sc-layer ${c.kind} ${c.id === clip.id ? "on" : ""}`} title={c.id === clip.id ? "Selected" : "Select this layer"}
                  onClick={() => useEditor.getState().selectClip({ scene: m.id, clip: c.id })}>
                  <i />{c.name}<em>{KIND_NAME[c.kind]}</em>
                </button>
              ))}
            </div>
          </div>
        )}
        {!linkedLayer && clip.parent && footage && <p className="hint sc-link"><Icon name="link" size={12} /> Inside the shot <button className="link" onClick={() => useEditor.getState().selectClip({ scene: m.id, clip: footage.id })}>{footage.name}</button>: it can move within it.</p>}
        {clip.locked && <p className="hint">The background is under everything, so it stays. Change what's on it instead.</p>}
      </section>
  );
}

/**
 * Place, size, turn and opacity of a clip, each with its keyframe diamond, and the easing of the
 * keyframes at the playhead. `labels` renames fields (a title's scale is its "Size").
 */
export function ClipTransform({ m, scene, clip, time, title = "Transform", labels = {} }: {
  m: Motion; scene: Scene; clip: SceneClip; time: number; title?: string; labels?: Partial<Record<ClipProp, string>>;
}) {
  const { checkpoint } = useEditor();
  const offset = m.offset ?? 0;
  const t = time - m.at + offset - (clip.keyStart + clip.shift);
  const inside = time >= m.at - offset + clip.start - 1e-3 && time <= m.at - offset + clip.end + 1e-3;
  const keys = clipKeys(scene, clip, m.layers);
  const setKeys = (next: Keys | undefined) => editClip(m, clip, () => withClipKeys(scene, clip, m.layers, { keys: next ?? {} }));
  return (
    <section className="sc-panel">
      <h3>{title}</h3>
      {FIELDS.filter((f) => clip.props.includes(f.p)).map((f) => {
        const still = clipStill(scene, clip, m.layers, f.p);
        return (
          <Slider key={f.p} label={labels[f.p] ?? f.label} unit={f.unit} min={f.min} max={f.max} step={f.step} display={f.show}
            value={valueAt(keys[f.p], t, still)}
            keyBtn={inside ? <KeyButton keys={keys} prop={f.p} t={Math.max(0, t)} still={still} onChange={(k) => setKeys(k)} /> : undefined}
            onStart={checkpoint} onChange={(v) => setClipProp(m.id, scene, clip, { [f.p]: v })} />
        );
      })}
      {inside && <EaseRow keys={keys} t={t} onChange={(k) => setKeys(k)} />}
      <p className="hint">
        {inside
          ? "◇ adds a keyframe at the playhead. Once a value has keyframes, changing it sets one where the playhead is. Its own animation from the edit stays under your changes."
          : "Move the playhead over this clip to see and set its keyframes."}
      </p>
    </section>
  );
}

/** A shot's footage: its file, and a drop target to swap it (the card and its blurred copy both change). */
function Footage({ m, clip }: { m: Motion; clip: SceneClip }) {
  const [over, setOver] = useState(false);
  const swapped = useEditor((s) => s.plan.motion.find((x) => x.id === m.id)?.layers?.[clip.videos[0]]?.src);
  const file = swapped ?? (clip.media ? sceneFile(m, clip.media.src) : "");
  const swap = (path: string) => {
    const s = useEditor.getState();
    s.checkpoint();
    for (const id of clip.videos) s.editLayer(m.id, id, (e) => ({ ...e, src: path, ...(isImage(path) ? {} : { offset: 0 }) }), false);
  };
  return (
    <section className="sc-panel">
      <h3>Footage</h3>
      <div
        className={`sc-drop ${over ? "over" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes(MEDIA_DRAG)) (e.preventDefault(), setOver(true)); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const data = e.dataTransfer.getData(MEDIA_DRAG);
          if (!data) return;
          e.preventDefault();
          swap((JSON.parse(data) as { path: string }).path);
        }}
      >
        <Icon name="video" size={14} />
        <span className="sc-file" title={file}>{file.split("/").pop()}</span>
      </div>
      <p className="hint">Drag a video or photo from the Library onto it to swap the footage. It keeps the shot's framing, look and movement.</p>
    </section>
  );
}
