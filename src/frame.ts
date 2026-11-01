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
  const cover = Math.max(outW / srcW, outH / srcH);
  const k = cover * plan.transform.scale;
  return {
    w: srcW * k,
    h: srcH * k,
    cx: outW / 2 + plan.transform.x * outW,
    cy: outH / 2 + plan.transform.y * outH,
    rotate: plan.transform.rotate,
  };
}

export const isIdentity = (t: EditPlan["transform"]) => t.scale === 1 && t.x === 0 && t.y === 0 && t.rotate === 0;

/** Output frame size for an aspect, capped so the long side is at most 1920. */
export function outputSize(plan: EditPlan, a: Pick<Analysis, "width" | "height">): { width: number; height: number } {
  if (plan.aspect === "9:16") return { width: 1080, height: 1920 };
  if (plan.aspect === "1:1") return { width: 1080, height: 1080 };
  if (plan.aspect === "16:9") return { width: 1920, height: 1080 };
  const scale = Math.min(1, 1920 / Math.max(a.width, a.height));
  return { width: even(a.width * scale), height: even(a.height * scale) };
}
