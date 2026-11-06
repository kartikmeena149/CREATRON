// @remotion/media while importing (see media.tsx): its own helpers, with Video and Audio swapped.
// @ts-ignore: the package's own file by path (a bare import would come back to this stand-in)
export * from "../../node_modules/@remotion/media/dist/esm/index.mjs";
export { Audio, Audio as experimental_Audio, Video, Video as experimental_Video } from "./media.tsx";
