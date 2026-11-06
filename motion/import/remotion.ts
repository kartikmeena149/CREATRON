// remotion while importing (see media.tsx): everything as it is, with OffthreadVideo swapped.
// @ts-ignore: the package's own file by path (a bare import would come back to this stand-in)
export * from "../../node_modules/remotion/dist/esm/index.mjs";
export { Video as OffthreadVideo } from "./media.tsx";
