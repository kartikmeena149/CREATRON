// Draws an imported Claude edit (src/scene.ts) at one moment: every layer as an absolutely
// placed box with its look, moved by its keyframes. The Overlay gives it the time and how to
// show videos (Remotion's, frame-exact in the export); anything else can give a plain <video>.
import type React from "react";
import { type SceneLayer, type Scene, channelAt, colorAt, styleAt, videoSpans } from "../src/scene.ts";

export type VideoSlot = (layer: SceneLayer, src: string, style: React.CSSProperties) => React.ReactNode;

/** kebab-case CSS from the page to React's camelCase (-webkit-x → WebkitX). */
const camel = (k: string) => k.replace(/^-webkit-/, "Webkit-").replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
const reactStyle = (s: Record<string, string>): React.CSSProperties => Object.fromEntries(Object.entries(s).map(([k, v]) => [camel(k), v]));

export function SceneView({ scene, t, url, video, width, height }: {
  scene: Scene;
  t: number;
  /** A scene file (relative to its folder) as a URL the renderer can load. */
  url: (file: string) => string;
  video: VideoSlot;
  /** The frame it's drawn into: the scene is fitted inside, centred. */
  width: number;
  height: number;
}) {
  const k = Math.min(width / scene.width, height / scene.height);
  const fonts = scene.fonts.map((f) => f.replace(/url\("([^"]+)"\)/g, (m, u: string) => (/^[a-z]+:/i.test(u) ? m : `url("${url(u)}")`))).join("\n");
  return (
    <div style={{ position: "absolute", left: (width - scene.width * k) / 2, top: (height - scene.height * k) / 2, width: scene.width, height: scene.height, transform: `scale(${k})`, transformOrigin: "0 0", overflow: "hidden" }}>
      {fonts && <style>{fonts}</style>}
      {order(scene.layers).map((l) => <Layer key={l.id} l={l} t={t} url={url} video={video} duration={scene.duration} />)}
    </div>
  );
}

/** Unpositioned layers first, then the ones a page paints on top of them, each group in page order. */
const order = (list: SceneLayer[]) => [...list.filter((l) => !l.front), ...list.filter((l) => l.front)];

/** A scene's own files in CSS (url("assets/…")) as URLs the renderer can load. */
const localUrls = (css: string, url: (f: string) => string) => css.replace(/url\("([^"]+)"\)/g, (m, u: string) => (/^[a-z]+:/i.test(u) ? m : `url("${url(u)}")`));

/** Words that step along: the last ones at or before t. */
function htmlAt(keys: [number, string][], t: number): string {
  let h = keys[0][1];
  for (const [k, v] of keys) if (k <= t + 1e-6) h = v;
  return h;
}

function oneLine(l: SceneLayer, x: number, w: number): React.CSSProperties {
  const align = l.style["text-align"] ?? "start";
  const k = align === "center" ? 0.5 : align === "right" || align === "end" ? 1 : 0;
  return {
    width: "max-content",
    left: x + w * k,
    translate: `${-k * 100}% 0`,
    transformOrigin: `${w ? (l.origin[0] / w) * 100 : 50}% ${l.origin[1]}px`,
  };
}

/** Seconds a video is kept loaded before its shot, so it's ready when it shows. */
const PRELOAD = 1;

function Layer({ l, t, url, video, duration }: { l: SceneLayer; t: number; url: (f: string) => string; video: VideoSlot; duration: number }) {
  const v = (name: Parameters<typeof channelAt>[0]) => channelAt(name, l.anim[name], t);
  // Switched off with no video about to play under it: nothing to draw (most of a long edit at any moment).
  if (!v("show") && !videoSpans(l, duration).some(([a, b]) => t >= a - PRELOAD && t < b)) return null;
  const blur = v("blur");
  const color = colorAt(l.paint?.color, t);
  const bg = colorAt(l.paint?.bg, t);
  const style: React.CSSProperties = {
    ...reactStyle(l.style),
    ...(l.style["background-image"] ? { backgroundImage: l.style["background-image"].replace(/url\("([^"]+)"\)/g, (m, u: string) => (/^[a-z]+:/i.test(u) ? m : `url("${url(u)}")`)) } : {}),
    position: "absolute",
    boxSizing: "border-box",
    margin: 0,
    left: v("x"),
    top: v("y"),
    width: v("w"),
    height: v("h"),
    transformOrigin: `${l.origin[0]}px ${l.origin[1]}px`,
    transform: `translate(${v("tx")}px, ${v("ty")}px) rotate(${v("rot")}deg) scale(${v("sx")}, ${v("sy")})`,
    opacity: v("opacity"),
    ...(blur ? { filter: `${l.style.filter && l.style.filter !== "none" ? `${l.style.filter} ` : ""}blur(${blur}px)` } : {}),
    ...(color ? { color } : {}),
    ...(bg ? { backgroundColor: bg } : {}),
    // Styles that change over time (a clip-path wipe, a colour…) at this moment.
    ...(l.styleAnim ? reactStyle(Object.fromEntries(Object.entries(l.styleAnim).map(([k, keys]) => [k, k === "background-image" ? localUrls(styleAt(keys, t), url) : styleAt(keys, t)]))) : {}),
    // Off: kept in place (a video stays loaded) but not drawn.
    ...(v("show") ? {} : { display: "none" }),
    // One-line text fits its words, growing out from where it's aligned (so new words keep their box and their place).
    ...(l.kind === "text" && l.fit ? oneLine(l, v("x"), v("w")) : {}),
  };
  const fill: React.CSSProperties = { display: "block", width: "100%", height: "100%", objectFit: (l.style["object-fit"] as React.CSSProperties["objectFit"]) ?? "fill", objectPosition: l.style["object-position"], borderRadius: "inherit" };
  return (
    <div style={style} data-layer={l.id}>
      {l.kind === "text" && <span style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: l.htmlAnim ? htmlAt(l.htmlAnim, t) : (l.html ?? "") }} />}
      {l.kind === "image" && l.src && <img src={url(l.src)} style={fill} alt="" />}
      {l.kind === "video" && l.src && videoSpans(l, duration).some(([a, b]) => t >= a - PRELOAD && t < b) && video(l, url(l.src), fill)}
      {l.kind === "svg" && (l.svg || l.svgAnim) && <div style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: l.svgAnim ? styleAt(l.svgAnim, t) : l.svg! }} />}
      {order(l.children).map((c) => <Layer key={c.id} l={c} t={t} url={url} video={video} duration={duration} />)}
    </div>
  );
}
