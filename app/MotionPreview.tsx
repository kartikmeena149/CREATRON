// The Remotion layer (animated captions, titles, lower thirds) live over the viewer. Remotion's
// Player draws the same Overlay the export renders, held on the editor's playhead frame by frame.
import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef } from "react";
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
  // The editor owns the clock (the video plays, the playhead follows); the layer just shows that frame.
  useEffect(() => player.current?.seekTo(Math.round(time * fps)), [time, fps, props]);
  if (!hasOverlay(plan, a.words)) return null;
  return (
    <Player
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
