// Entry point for Remotion's bundler (export only; the app's preview imports Overlay directly).
import { registerRoot } from "remotion";
import { Root } from "./Root.tsx";

registerRoot(Root);
