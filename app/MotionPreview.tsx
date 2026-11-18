// The Remotion layer (animated captions, titles, lower thirds, AI-written animations) live over
// the viewer. Remotion's Player draws the same Overlay the export renders, held on the editor's
// playhead frame by frame.
import { Player, type PlayerRef } from "@remotion/player";
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as Remotion from "remotion";
import { registerCustom } from "../motion/custom.ts";
import { Overlay } from "../motion/Overlay.tsx";
import { outputSize } from "../src/frame.ts";
import { hasOverlay, overlayProps } from "../src/motion.ts";
import type { EditPlan } from "../src/schema.ts";
import { effectivePlan } from "../src/tracks.ts";
import { useEditor } from "./store.ts";

export function MotionPreview() {
  const { plan: edit, project, time, playing } = useEditor();
  // Text on hidden tracks stays out of the preview, like the export.
  const plan = useMemo(() => effectivePlan(edit), [edit]);
  const a = project!.analysis;
  const fps = a.fps;
  const scenes = useSceneFiles(plan);
  const effects = useEditor((s) => s.effectLibrary);
  const props = useMemo(() => overlayProps(plan, a.words, outputSize(plan, a), fps, { scenes, prefix: MEDIA_PREFIX, effects }), [plan, a, fps, scenes, effects]);
  const player = useRef<PlayerRef>(null);
  const loaded = useCustomCode(project!.path, plan.motion.some((m) => m.template === "custom"), plan);
  // The editor owns the clock (the video plays, the playhead follows). Paused, the layer shows that
  // exact frame. Playing, it plays along by itself (its videos play instead of being sought every
  // frame, which stutters) and is only put back when it drifts a few frames off.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const frame = Math.round(time * fps);
    if (!playing) {
      p.pause();
      p.seekTo(frame);
    } else if (!p.isPlaying() || Math.abs(p.getCurrentFrame() - frame) > Math.max(3, fps / 6)) {
      p.seekTo(frame);
      p.play();
    }
  }, [time, playing, fps, props, loaded]);
  if (!hasOverlay(plan, a.words)) return null;
  return (
    <Player
      key={loaded} // new custom code: start the Player fresh so it draws it
      ref={player}
      component={Overlay}
      inputProps={props}
      durationInFrames={Math.max(1, Math.ceil(props.duration * fps))}
      fps={fps}
      compositionWidth={props.width}
      compositionHeight={props.height}
      controls={false}
      clickToPlay={false}
      acknowledgeRemotionLicense
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 4 }}
    />
  );
}

// Scene files load through media:// like every other file (see mediaUrl).
const MEDIA_PREFIX = "media://local/?p=";

/** The imported Claude edits the plan uses, loaded from disk once each (after a reopen or an undo brings one back). */
export function useSceneFiles(plan: EditPlan) {
  const scenes = useEditor((s) => s.scenes);
  const files = plan.motion.filter((m) => m.template === "scene" && m.scene).map((m) => m.scene!);
  const missing = files.filter((f) => !scenes[f]).join("\n");
  useEffect(() => {
    for (const file of missing ? missing.split("\n") : [])
      window.creatron.loadScene(file).then((r) => r.ok && useEditor.setState((s) => ({ scenes: { ...s.scenes, [file]: r.value } })));
  }, [missing]);
  return scenes;
}

/** Loads the project's AI-written animations (compiled by the main process) into the registry. Returns their version. */
function useCustomCode(path: string, needed: boolean, plan: unknown): string {
  const [version, setVersion] = useState("none");
  useEffect(() => {
    if (!needed) return;
    let gone = false;
    window.creatron.customCode(path).then((r) => {
      if (gone || !r.ok || r.value.version === version) return;
      const modules: Record<string, unknown> = { react: React, "react/jsx-runtime": JsxRuntime, remotion: Remotion };
      const components: Record<string, any> = {};
      for (const [name, code] of Object.entries(r.value.code)) {
        try {
          const module = { exports: {} as any };
          const require = (id: string) => {
            if (!(id in modules)) throw new Error(`${name} imports "${id}", which isn't available`);
            return modules[id];
          };
          new Function("require", "module", "exports", code)(require, module, module.exports);
          components[name] = module.exports.default ?? Object.values(module.exports).find((x) => typeof x === "function");
        } catch (e) {
          console.error(`custom animation ${name}:`, e);
        }
      }
      registerCustom(components);
      setVersion(r.value.version);
    });
    return () => void (gone = true);
  }, [path, needed, plan]);
  return version;
}
