// The footage of an imported Claude edit on the timeline: a Clips track under it with each shot
// (a video, or a big picture) as a clip. Click one to edit it, drag its edges to trim it, drop a
// video from the library on it to swap the footage (it keeps the edit's framing), ⌫ to take it out.
import { useMemo } from "react";
import { type Scene, type Shot, applyEdits, sceneShots, spanShow } from "../src/scene.ts";
import type { Motion } from "../src/schema.ts";
import { MEDIA_DRAG } from "./Inspector.tsx";
import { isImage, mediaUrl } from "./format.ts";
import { useFileThumbs } from "./fileThumbs.ts";
import { FilmStrip } from "./Timeline.tsx";
import { useEditor } from "./store.ts";

/** A scene file as a full path (its own files are relative to its folder; swapped-in ones are full). */
export const sceneFile = (m: Motion, src: string) => (src.startsWith("/") ? src : `${m.scene!.replace(/\/[^/]*$/, "")}/${src}`);

/** The scene as it plays (the user's swaps and trims applied, hidden layers kept so they can come back). */
function edited(m: Motion, base: Scene): Scene {
  return applyEdits(base, Object.fromEntries(Object.entries(m.layers ?? {}).map(([k, e]) => [k, { ...e, hidden: false }])));
}

export function useShots(m: Motion): Shot[] {
  const base = useEditor((s) => (m.scene ? s.scenes[m.scene] : undefined));
  return useMemo(() => (base ? sceneShots(edited(m, base)) : []), [base, m]);
}

/** The shot a layer belongs to, in the scene clip it's in. */
export function shotOf(m: Motion, layer: string): Shot | undefined {
  const base = m.scene ? useEditor.getState().scenes[m.scene] : undefined;
  return base ? sceneShots(edited(m, base)).find((s) => s.ids.includes(layer)) : undefined;
}

/** Swaps a shot's footage for a file: every layer drawing it (a card and its blurred copy), from its start. */
export function replaceShot(m: Motion, shot: Shot, path: string) {
  const st = useEditor.getState();
  st.checkpoint();
  for (const id of shot.ids) st.editLayer(m.id, id, (e) => ({ ...e, src: path, ...(isImage(path) ? {} : { offset: 0 }) }), false);
}

export function hideShot(m: Motion, shot: Shot) {
  const st = useEditor.getState();
  st.checkpoint();
  for (const id of shot.ids) st.editLayer(m.id, id, (e) => ({ ...e, hidden: true }), false);
}

export function ShotLane({ m, pxPerSec }: { m: Motion; pxPerSec: number }) {
  const shots = useShots(m);
  return <>{shots.map((s) => <ShotBlock key={s.key} m={m} shot={s} pxPerSec={pxPerSec} />)}</>;
}

function ShotBlock({ m, shot, pxPerSec }: { m: Motion; shot: Shot; pxPerSec: number }) {
  const hidden = useEditor((s) => shot.ids.every((id) => s.plan.motion.find((x) => x.id === m.id)?.layers?.[id]?.hidden));
  const selected = useEditor((s) => s.selectedMotion === m.id && s.selectedLayer !== null && shot.ids.includes(s.selectedLayer));
  const file = sceneFile(m, shot.src);
  const photo = shot.kind === "image";
  const strip = useFileThumbs(photo ? undefined : file);
  const offset = m.offset ?? 0;
  // Only the part inside the scene clip shows (after a trim or split of the clip).
  const from = Math.max(shot.start, offset);
  const to = Math.min(shot.end, offset + m.duration);
  if (to <= from) return null;
  const left = (m.at - offset + from) * pxPerSec;
  const w = Math.max(4, (to - from) * pxPerSec - 1);

  const pick = () =>
    useEditor.setState({ selectedMotion: m.id, selectedLayer: shot.main, selected: null, picked: [], pickedIds: [], selectedCue: null, selectedVo: null, selectedBroll: null, leftView: "text" });
  const drag = (edge: "start" | "end" | null) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    pick();
    if (!edge) return;
    const x0 = e.clientX;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      const st = useEditor.getState();
      if (!moved) (moved = true), st.checkpoint();
      const d = (ev.clientX - x0) / pxPerSec;
      const start = edge === "start" ? Math.min(shot.end - 0.2, Math.max(0, shot.start + d)) : shot.start;
      const end = edge === "end" ? Math.max(shot.start + 0.2, shot.end + d) : shot.end;
      for (const id of shot.ids) st.editLayer(m.id, id, (x) => ({ ...x, anim: { ...x.anim, show: spanShow(start, end) } }), false);
    };
    const up = () => (window.removeEventListener("pointermove", onMove), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      className={`broll-clip shot-clip ${selected ? "selected" : ""} ${hidden ? "hidden" : ""}`}
      style={{ left, width: w }}
      title={`${file.split("/").pop()}\nClick to edit · drag the edges to trim · drop a video here to swap it · ⌫ to take it out`}
      onPointerDown={drag(null)}
      onDoubleClick={() => useEditor.setState({ openScene: m.id, selectedLayer: shot.main, sceneKey: null })}
      onDragOver={(e) => e.dataTransfer.types.includes(MEDIA_DRAG) && (e.preventDefault(), e.stopPropagation())}
      onDrop={(e) => {
        const data = e.dataTransfer.getData(MEDIA_DRAG);
        if (!data) return;
        e.preventDefault();
        e.stopPropagation();
        replaceShot(m, shot, (JSON.parse(data) as { path: string }).path);
      }}
    >
      {photo ? <div className="photo-strip" style={{ backgroundImage: `url("${mediaUrl(file)}")` }} />
        : strip ? <FilmStrip thumbs={strip} from={shot.offset + (from - shot.start)} speed={1} w={w} />
        : <video className="broll-thumb" src={`${mediaUrl(file)}#t=${(shot.offset + 0.5).toFixed(1)}`} muted preload="metadata" />}
      <span className="broll-label">{file.split("/").pop()}</span>
      <div className="handle left" onPointerDown={drag("start")} />
      <div className="handle right" onPointerDown={drag("end")} />
    </div>
  );
}
