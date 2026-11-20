// Inspector for an imported Claude edit as a whole (its clip on a Text track): what it is, what
// it came in as, and a way back to how it was made. Its shots, titles and graphics are clips on
// their own tracks below it, each with its own panel (SceneClipPanel).
import { clipKeys, sceneClips } from "../src/sceneClips.ts";
import type { Motion } from "../src/schema.ts";
import { clipsOf } from "./SceneClips.tsx";
import { useEditor } from "./store.ts";

export function SceneEditor({ m }: { m: Motion }) {
  const { scenes, updateMotion, deleteMotion } = useEditor();
  const scene = m.scene ? scenes[m.scene] : undefined;
  if (!scene) return <section><p className="hint">Loading the Claude edit…</p></section>;
  const clips = clipsOf(m, scene);
  const count = (k: string) => clips.filter((c) => c.kind === k).length;
  const keyframes = clips.reduce((n, c) => n + Object.values(clipKeys(scene, c, m.layers)).reduce((a, l) => a + (l?.length ?? 0), 0), 0);
  // Changes made to its clips (not the captions it handed to Creatro on import, which stay hidden).
  const ours = new Set(sceneClips(scene, undefined).flatMap((c) => [`clip:${c.id}`, ...c.parts, ...c.textLayers, ...c.videos]));
  const mine = Object.keys(m.layers ?? {}).filter((k) => ours.has(k));
  const edits = mine.length;
  const reset = () => updateMotion(m.id, { layers: Object.fromEntries(Object.entries(m.layers ?? {}).filter(([k]) => !ours.has(k))) });
  return (
    <section className="motion-editor">
      <h3>
        Claude edit
        <button className="link" onClick={() => deleteMotion(m.id)}>Delete</button>
      </h3>
      <div className="scene-card">
        <span className={`si-badge ${scene.kind ?? ""}`}>{scene.kind === "remotion" ? "REMOTION" : "HTML"}</span>
        <div>
          <b>{m.text}</b>
          <div className="dim small">{count("shot")} shots · {count("text")} titles · {count("graphic")} graphics · {keyframes} keyframes · {scene.width}×{scene.height}</div>
        </div>
      </div>
      {edits > 0 && (
        <div className="scene-actions">
          <button className="ghost" title="Undo every change made to its clips" onClick={reset}>Reset {edits} {edits === 1 ? "change" : "changes"}</button>
        </div>
      )}
      <p className="hint">Its shots, titles and graphics are clips on the tracks below. Click one to change it. Move or trim this clip to move or trim the whole edit.</p>
    </section>
  );
}
