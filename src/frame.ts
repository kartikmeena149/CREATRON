// Where the video lands inside the output frame. Shared by the renderer and the live preview
// so what you see is exactly what you export. Pure math, no Node or browser APIs.
import type { Analysis, EditPlan } from "./schema.ts";

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export type Placement = {
  w: number; // video size in the frame, before rotation
  h: number;
  cx: number; // video center in the frame
  cy: number;
  rotate: number; // degrees clockwise
};

/**
 * Scale 1 "covers" the frame: the video is just big enough to leave no bars, centered.
 * Then the user's scale, shift (fractions of the frame) and rotation are applied.
 */
export function placement(plan: EditPlan, srcW: number, srcH: number, outW: number, outH: number): Placement {
  return placeBox(plan.transform, srcW, srcH, outW, outH);
}

/**
 * Where a picture sits in the frame: at scale 1 it just covers the frame (its own shape kept),
 * smaller or bigger from there, its middle shifted by x / y (fractions of the frame). The main
 * video and every clip on the upper tracks (videos, photos) are placed the same way.
 */
export function placeBox(t: { scale?: number; x?: number; y?: number; rotate?: number }, srcW: number, srcH: number, outW: number, outH: number): Placement {
  const k = Math.max(outW / srcW, outH / srcH) * (t.scale ?? 1);
  return { w: srcW * k, h: srcH * k, cx: outW / 2 + (t.x ?? 0) * outW, cy: outH / 2 + (t.y ?? 0) * outH, rotate: t.rotate ?? 0 };
}

export type Crop = { left: number; top: number; right: number; bottom: number };
export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
/** The crop of a transform, every side present (none = nothing cut). */
export const cropOf = (t: { crop?: Partial<Crop> }): Crop => ({ ...NO_CROP, ...t.crop });
export const isCropped = (t: { crop?: Partial<Crop> }) => Object.values(cropOf(t)).some((v) => v > 0.0005);

export const isIdentity = (t: EditPlan["transform"]) =>
  t.scale === 1 && t.x === 0 && t.y === 0 && t.rotate === 0 && !isCropped(t) && !t.flip;

/**
 * What remains of a placed picture after its crop: the size of the kept part and its middle in the
 * frame (the crop moves the edges in, so the middle shifts, turned with the picture's rotation).
 */
export function cropBox(p: Placement, crop: Crop): Placement {
  const w = p.w * (1 - crop.left - crop.right);
  const h = p.h * (1 - crop.top - crop.bottom);
  const dx = ((crop.left - crop.right) * p.w) / 2;
  const dy = ((crop.top - crop.bottom) * p.h) / 2;
  const r = (p.rotate * Math.PI) / 180;
  return { w, h, cx: p.cx + dx * Math.cos(r) - dy * Math.sin(r), cy: p.cy + dx * Math.sin(r) + dy * Math.cos(r), rotate: p.rotate };
}

/**
 * The main source's picture size. A voice recording has none (faceless videos): it plays over
 * a black 1080x1920 picture that B-roll, text and captions go on.
 */
export const pictureSize = (a: Pick<Analysis, "width" | "height">) =>
  a.width && a.height ? { width: a.width, height: a.height } : { width: 1080, height: 1920 };

/** The frame shapes, in the order the app shows them, with what each is for. */
export const ASPECTS: { id: EditPlan["aspect"]; name: string; use: string }[] = [
  { id: "source", name: "Original", use: "As filmed" },
  { id: "9:16", name: "9:16", use: "Reels" },
  { id: "4:5", name: "4:5", use: "Feed post" },
  { id: "1:1", name: "1:1", use: "Square" },
  { id: "4:3", name: "4:3", use: "Classic" },
  { id: "16:9", name: "16:9", use: "YouTube" },
  { id: "21:9", name: "21:9", use: "Cinema" },
];

/** Output frame size for an aspect: the short side 1080 (the original is capped at 1920 on its long side). */
export function outputSize(plan: Pick<EditPlan, "aspect">, source: Pick<Analysis, "width" | "height">): { width: number; height: number } {
  if (plan.aspect !== "source") {
    const [w, h] = plan.aspect.split(":").map(Number);
    return w >= h ? { width: even((1080 * w) / h), height: 1080 } : { width: 1080, height: even((1080 * h) / w) };
  }
  const a = pictureSize(source);
  const scale = Math.min(1, 1920 / Math.max(a.width, a.height));
  return { width: even(a.width * scale), height: even(a.height * scale) };
}
