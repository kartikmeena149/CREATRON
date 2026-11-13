import React from "react";
import { Composition } from "remotion";
import { Main } from "./Main";
import { durationInFrames, fps, height, width } from "./creatron/timeline";

// Size, frame rate and length all come from timeline.json (length = the sum of the cuts).
export const Root: React.FC = () => <Composition id="Main" component={Main} width={width} height={height} fps={fps} durationInFrames={durationInFrames} />;
