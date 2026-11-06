// Stand-ins used only while importing a Claude edit made with Remotion (sceneImport.ts). Remotion
// draws some videos onto a canvas (@remotion/media, OffthreadVideo), where the import can't see
// which file plays. Here a video is an empty <video> that says its file and the moment of it
// showing (worked out from the frame, as Remotion does), so nothing has to be decoded; its sound
// goes through Remotion's plain <audio>, which reports what plays to the import. The project's
// code is untouched: the bundle points its imports here.
import type React from "react";
// @ts-ignore: the package's own file by path (a bare import would come back to this stand-in)
import { Html5Audio, useCurrentFrame, useVideoConfig } from "../../node_modules/remotion/dist/esm/index.mjs";

type Media = { src: string; [key: string]: unknown };
const SOUND = ["src", "trimBefore", "trimAfter", "startFrom", "endAt", "volume", "playbackRate", "loop", "name", "loopVolumeCurveBehavior"];
const pick = (p: Media, keys: string[]) => Object.fromEntries(Object.entries(p).filter(([k]) => keys.includes(k))) as Media;

export const Video: React.FC<Media> = (p) => {
  const frame: number = useCurrentFrame();
  const { fps } = useVideoConfig();
  const from = Number(p.trimBefore ?? p.startFrom ?? 0);
  const time = (from + frame * Number(p.playbackRate ?? 1)) / fps;
  const silent = p.muted === true || p.volume === 0;
  return (
    <>
      {!silent && <Html5Audio {...pick(p, SOUND)} />}
      <video data-src={p.src} data-time={time} muted style={p.style as React.CSSProperties} className={p.className as string} />
    </>
  );
};

export const Audio: React.FC<Media> = (p) => <Html5Audio {...pick(p, [...SOUND, "muted"])} />;
