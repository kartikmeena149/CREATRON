// The video. Layers from back to front: background, the recording (through the cuts),
// captions, then sound. Add scenes, B-roll and graphics as their own components and layers.
import React from "react";
import { AbsoluteFill } from "remotion";
import { Captions } from "./Captions";
import { Footage } from "./creatron/Footage";
import { Music, Sfx } from "./creatron/Sound";
import { colors } from "./creatron/timeline";

export const Main: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: colors.background }}>
    <Footage />
    <Captions />
    <Music />
    <Sfx />
  </AbsoluteFill>
);
