// Music and sound effects from timeline.json, each a separate file in assets/.
import React from "react";
import { Audio, Sequence, interpolate, staticFile } from "remotion";
import { durationInFrames, fps, timeline } from "./timeline";

export const Music: React.FC = () => {
  const m = timeline.music;
  if (!m) return null;
  const fadeFrames = Math.round(fps * 0.8);
  return (
    <Audio
      src={staticFile(m.file)}
      volume={(f) => m.volume * interpolate(f, [0, fps * 0.3, durationInFrames - fadeFrames, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
    />
  );
};

export const Sfx: React.FC = () => (
  <>
    {timeline.sfx.map((s, i) => (
      <Sequence key={i} from={Math.round((s.at ?? 0) * fps)} name={`sfx ${s.file.split("/").pop()}`} layout="none">
        <Audio src={staticFile(s.file)} volume={s.volume} />
      </Sequence>
    ))}
  </>
);
