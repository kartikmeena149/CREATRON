// "Import Claude edit": a HyperFrames or Remotion project (the code Claude makes videos with) comes in as
// layers with keyframes, so its text, colours and movement can be changed here. Pick how closely
// keyframes follow the motion and where it goes, then Creatro records it and builds it.
import { useEffect, useState } from "react";
import { type Detail, type Scene, captionLayers, sceneShots } from "../src/scene.ts";
import { clipKeys } from "../src/sceneClips.ts";
import { setTrack } from "../src/tracks.ts";
import { clipsOf } from "./SceneClips.tsx";
import { useEditor } from "./store.ts";

const DETAILS: [Detail, string, string][] = [
  ["light", "Light", "Fewest keyframes: easiest to edit by hand"],
  ["balanced", "Balanced", "Follows every ease closely"],
  ["exact", "Exact", "A keyframe wherever anything changes"],
];

/**
 * In a project made from the edit (its voiceover is the main track, so Creatro has the words):
 * the edit's own captions are hidden and Creatro's captions take their place, in the style the
 * project's code used, its font and where they sat. Returns how many caption layers it hid.
 */
function switchToCreatronCaptions(id: string, scene: Scene): number {
  const s = useEditor.getState();
  const words = s.project?.analysis.words ?? [];
  if (!words.length) return 0;
  const found = captionLayers(scene, words);
  if (!found?.ids.length) return 0;
  // Its own font: Creatro keeps the edit's fonts, so the captions can use exactly that one.
  const font = found.font ?? s.plan.captions.font;
  s.commit({
    ...s.plan,
    captions: {
      ...s.plan.captions, enabled: true, animation: scene.captionStyle ?? "spec", uppercase: found.upper, font, x: found.x, y: found.y,
      ...(found.accent ? { highlight: found.accent } : {}),
      // Its layout: lined up like the edit's, in a column as wide as the edit's, as many words a caption.
      align: found.align, wrapAt: Math.max(0.3, Math.min(4, (0.86 * s.plan.captions.size) / found.width)), wordsPerCaption: found.wordsPerCaption ?? s.plan.captions.wordsPerCaption,
    },
    motion: s.plan.motion.map((m) => (m.id === id ? { ...m, layers: { ...m.layers, ...Object.fromEntries(found.ids.map((l) => [l, { hidden: true }])) } } : m)),
  });
  return found.ids.length;
}

/** Auto Edit's project of a video (work/<video>/autoedit/project): a whole finished edit, voice included. */
export const isFullEdit = (path: string) => /\/autoedit\/project\/?$/.test(path);

/** Asks for a Claude edit (a HyperFrames folder or .html) and opens the import dialog with it. */
export async function pickClaudeEdit() {
  const path = await window.creatron.pickScene();
  if (path) useEditor.setState({ sceneImport: path });
}

export function SceneImport({ path, onClose, onOpenMain }: { path: string; onClose: () => void; onOpenMain: (path: string, here: boolean) => Promise<boolean> }) {
  const hasProject = useEditor((s) => Boolean(s.project && s.plan.segments.length));
  const status = useEditor((s) => s.status);
  const [detail, setDetail] = useState<Detail>("balanced");
  // A full edit (Auto Edit's project) is a finished video with its own cut voice and music. On top of
  // the uncut original it would play two voices, so it opens as its own project unless asked otherwise.
  const finished = isFullEdit(path);
  const [into, setInto] = useState<"new" | "here">(hasProject && !finished ? "here" : "new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ seconds: number; shots: number; titles: number; graphics: number; keyframes: number; sounds: number; id: string; captions: number } | null>(null);
  const name = path.replace(/\/index\.html?$/i, "").split("/").pop();
  const [kind, setKind] = useState<"hyperframes" | "remotion" | null | undefined>(undefined);
  useEffect(() => void window.creatron.isScene(path).then(setKind), [path]);

  const build = async () => {
    setBusy(true);
    setError("");
    const t0 = performance.now();
    const r = await window.creatron.importScene(path, detail);
    if (!r.ok) return setBusy(false), setError(r.error);
    const { file, scene } = r.value;
    await useEditor.getState().loadFontLibrary(); // the edit's fonts are Creatro fonts now
    let at: number | undefined;
    if (into === "new") {
      // Its own project: a blank main track as long and as big as the edit, with the edit on top.
      const base = await window.creatron.sceneBase(file);
      if (!base.ok) return setBusy(false), setError(base.error);
      if (!(await onOpenMain(base.value, !useEditor.getState().project))) return setBusy(false), setError("Couldn't open the new project.");
      const s = useEditor.getState();
      s.commit({ ...s.plan, tracks: { settings: { ...s.plan.tracks.settings, "video:1": { name: "Background" } } } });
      at = 0;
    }
    if (into === "here" && finished) {
      // In this project: from the start, and the original's sound off (the edit carries the voice, already cut).
      const s = useEditor.getState();
      s.commit(setTrack(s.plan, "video:1", { muted: true }));
      at = 0;
    }
    const id = useEditor.getState().addScene(file, scene, at, { withoutVoice: into === "new" });
    const captions = into === "new" ? switchToCreatronCaptions(id, scene) : 0;
    // Its clips and pictures go into the project's library, like any media.
    const dir = file.replace(/\/[^/]*$/, "");
    for (const shot of sceneShots(scene)) useEditor.getState().addToLibrary(`${dir}/${shot.src}`);
    // What it came in as: clips on tracks, each with its keyframes.
    const m = useEditor.getState().plan.motion.find((x) => x.id === id)!;
    const clips = clipsOf(m, scene);
    const count = (k: string) => clips.filter((c) => c.kind === k).length;
    const keyframes = clips.reduce((n, c) => n + Object.values(clipKeys(scene, c, m.layers)).reduce((a, l) => a + (l?.length ?? 0), 0), 0);
    setBusy(false);
    setDone({ seconds: (performance.now() - t0) / 1000, shots: count("shot"), titles: count("text"), graphics: count("graphic"), keyframes, sounds: scene.audio.length, id, captions });
  };

  /** Selects its first shot so its panel opens. */
  const showClips = () => {
    const m = useEditor.getState().plan.motion.find((x) => x.id === done!.id);
    const scene = m?.scene ? useEditor.getState().scenes[m.scene] : undefined;
    const first = m && scene ? clipsOf(m, scene).find((c) => c.kind === "shot") : undefined;
    if (first) useEditor.getState().selectClip({ scene: done!.id, clip: first.id });
    useEditor.setState({ leftView: "clip" });
    onClose();
  };

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="link-card scene-import" onKeyDown={(e) => e.stopPropagation()}>
        <div className="link-head">
          <b>Import Claude edit</b>
          <button className="ghost" disabled={busy} onClick={onClose}>✕</button>
        </div>
        <div className="si-file">
          <span className={`si-badge ${kind ?? ""}`}>{kind === "remotion" ? "REMOTION" : "HTML"}</span>
          <div>
            <div className="link-title">{name}</div>
            <div className="dim small">{path}</div>
          </div>
        </div>
        {done ? (
          <>
            <div className="si-done">
              <div className="si-check">✓</div>
              <div>
                <b>Built in {done.seconds.toFixed(1)} s</b>
                <div className="dim small">
                  {done.shots} shots · {done.titles} titles · {done.graphics} graphics · {done.keyframes} keyframes{done.sounds ? ` · ${done.sounds} sounds on SFX tracks` : ""}
                  {done.captions > 0 && <><br />Its captions are now Creatro captions: edit them on the Captions track.</>}
                </div>
              </div>
            </div>
            <p className="hint">Each shot, title and graphic is its own clip on the timeline: move it, trim it, delete it, retype it, and change its keyframes.</p>
            <div className="link-actions">
              <button className="ghost" onClick={onClose}>Done</button>
              <button className="primary" onClick={showClips}>Edit its clips</button>
            </div>
          </>
        ) : (
          <>
            <div className="si-row">
              <span className="field-label">Build into</span>
              <div className="segmented">
                <button className={into === "new" ? "on" : ""} disabled={busy} onClick={() => setInto("new")}>New project</button>
                <button className={into === "here" ? "on" : ""} disabled={busy || !hasProject} title={!hasProject ? "Open a video first" : finished ? "From 0:00, with the original's sound turned off" : "At the playhead, on a Text track"} onClick={() => setInto("here")}>
                  This project
                </button>
              </div>
            </div>
            {finished && (
              <p className="dim small">
                {into === "new"
                  ? "A finished edit has its own cut voice and music: as a new project it plays exactly as exported, from 0:00, one voice."
                  : "It goes in at 0:00 and the original video's sound is turned off, so you hear one voice (the edit's, already cut)."}
              </p>
            )}
            <div className="si-row">
              <span className="field-label">Keyframes</span>
              <div className="segmented">
                {DETAILS.map(([d, label, hint]) => (
                  <button key={d} className={detail === d ? "on" : ""} disabled={busy} title={hint} onClick={() => setDetail(d)}>{label}</button>
                ))}
              </div>
            </div>
            <p className="dim small">{DETAILS.find((d) => d[0] === detail)![2]}. Text, pictures, videos and sounds come in as their own layers and clips.</p>
            {kind === null && <p className="error small">This isn't a Claude edit: pick the project folder of a HyperFrames or Remotion video (not the exported .mp4).</p>}
            {error && <p className="error small">{error}</p>}
            <div className="link-actions">
              {busy && <span className="dim small si-status"><span className="spinner small" /> {status || "starting"}…</span>}
              <button className="primary" disabled={busy || kind === null} onClick={build}>{busy ? "Building…" : "Build in Creatro"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
