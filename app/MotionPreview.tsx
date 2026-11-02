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
import { useEditor } from "./store.ts";

export function MotionPreview() {
  const { plan, project, time } = useEditor();
  const a = project!.analysis;
  const fps = a.fps;
  const props = useMemo(() => overlayProps(plan, a.words, outputSize(plan, a), fps), [plan, a, fps]);
  const player = useRef<PlayerRef>(null);
  const loaded = useCustomCode(project!.path, plan.motion.some((m) => m.template === "custom"), plan);
  // The editor owns the clock (the video plays, the playhead follows); the layer just shows that frame.
  useEffect(() => player.current?.seekTo(Math.round(time * fps)), [time, fps, props, loaded]);
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
