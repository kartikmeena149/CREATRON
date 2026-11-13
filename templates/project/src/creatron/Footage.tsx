// The recording, played through the cuts in timeline.json straight from the untouched source
// file. There is no pre-cut video: change a cut in timeline.json and this follows.
import React from "react";
import { Audio, OffthreadVideo, Sequence, staticFile } from "remotion";
import { cutFrames, fps, timeline } from "./timeline";

/** 10 ms fades at each join so cuts don't click. */
const fade = (frames: number) => (f: number) => Math.min(1, (f + 1) / Math.max(1, fps * 0.01), (frames - f) / Math.max(1, fps * 0.01));

export const Footage: React.FC<{ style?: React.CSSProperties; muted?: boolean; volume?: number }> = ({ style, muted, volume = 1 }) => (
  <>
    {cutFrames.map(({ cut, from, frames }, i) => (
      <Sequence key={i} from={from} durationInFrames={frames} name={`cut ${i + 1}`} layout="none">
        {timeline.hasVideo ? (
          <OffthreadVideo
            src={staticFile(timeline.source)}
            trimBefore={Math.round(cut.start * fps)}
            muted={muted}
            volume={(f) => volume * fade(frames)(f)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...style }}
          />
        ) : (
          !muted && <Audio src={staticFile(timeline.source)} trimBefore={Math.round(cut.start * fps)} volume={(f) => volume * fade(frames)(f)} />
        )}
      </Sequence>
    ))}
  </>
);

/** The speaker without their background (made by the cutout tool), following the same cuts. */
export const Cutout: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
  const cutout = timeline.cutout;
  if (!cutout) return null;
  return (
    <>
      {cutFrames.map(({ cut, from, frames }, i) => {
        const range = cutout.ranges.find(([s, e]) => cut.start >= s - 0.001 && cut.end <= e + 0.001);
        if (!range) return null; // this cut isn't covered: run the cutout tool again
        return (
          <Sequence key={i} from={from} durationInFrames={frames} name={`cutout ${i + 1}`} layout="none">
            <OffthreadVideo
              src={staticFile(cutout.file)}
              trimBefore={Math.round((range[2] + cut.start - range[0]) * fps)}
              transparent
              muted
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...style }}
            />
          </Sequence>
        );
      })}
    </>
  );
};
