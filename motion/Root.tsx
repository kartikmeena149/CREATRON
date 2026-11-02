import { Composition } from "remotion";
import type { OverlayProps } from "../src/motion.ts";
import { Overlay } from "./Overlay.tsx";

const empty: OverlayProps = { width: 1080, height: 1920, fps: 30, duration: 1, motion: [] };

/** One composition whose size, frame rate and length come from the edit it's rendering. */
export const Root = () => (
  <Composition
    id="Overlay"
    component={Overlay}
    defaultProps={empty}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    calculateMetadata={({ props }) => ({
      width: props.width,
      height: props.height,
      fps: props.fps,
      durationInFrames: Math.max(1, Math.ceil(props.duration * props.fps)),
    })}
  />
);
