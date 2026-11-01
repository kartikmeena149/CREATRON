// Captions: draw each cue (already placed on the OUTPUT timeline by timeline.ts)
// as a transparent PNG. The renderer overlays them as one image stream. (The ffmpeg we ship
// later will have libass; this keeps the prototype working with any ffmpeg build.)
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EditPlan } from "./schema.ts";
import { type Cue, captionFontSize } from "./timeline.ts";

const FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";
// Fallback so emoji in captions draw in colour instead of as empty boxes.
const EMOJI_FONT = "/System/Library/Fonts/Apple Color Emoji.ttc";

/** Writes one PNG per cue plus a blank, and an ffmpeg concat list that plays them on time. */
export function drawCues(cues: Cue[], plan: EditPlan, width: number, height: number, dir: string, total: number): string {
  GlobalFonts.registerFromPath(FONT, "CaptionFont");
  GlobalFonts.registerFromPath(EMOJI_FONT, "CaptionEmoji");
  const bold = plan.captions.style === "bold";
  const size = Math.round(captionFontSize(plan, width, height));
  const maxWidth = width * 0.86;

  const blank = join(dir, "cap-blank.png");
  writeFileSync(blank, createCanvas(width, height).toBuffer("image/png"));

  const lines: string[] = [];
  const show = (file: string, dur: number) => {
    if (dur > 0.001) lines.push(`file '${file}'`, `duration ${dur.toFixed(3)}`);
  };
  let t = 0;
  cues.forEach((cue, i) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.font = `${size}px CaptionFont, CaptionEmoji`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = plan.captions.uppercase ? cue.text.toUpperCase() : cue.text;
    // Typed line breaks are kept; long lines wrap at 86% of the frame width.
    const wrapped = text.split("\n").flatMap((part) => wrap(ctx, part, maxWidth));
    const lineHeight = size * 1.2;
    const centerX = width * (0.5 + cue.x);
    const centerY = height * (0.5 + cue.y);
    const top = centerY - ((wrapped.length - 1) * lineHeight) / 2;

    if (!bold) {
      const w = Math.max(...wrapped.map((l) => ctx.measureText(l).width)) + size;
      const h = wrapped.length * lineHeight + size * 0.4;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.roundRect(centerX - w / 2, centerY - h / 2, w, h, size * 0.3);
      ctx.fill();
    }
    wrapped.forEach((line, n) => {
      const y = top + n * lineHeight;
      if (bold) {
        ctx.lineJoin = "round";
        ctx.lineWidth = size * 0.16;
        ctx.strokeStyle = "black";
        ctx.strokeText(line, centerX, y);
      }
      ctx.fillStyle = plan.captions.color;
      ctx.fillText(line, centerX, y);
    });

    const file = join(dir, `cap-${String(i).padStart(4, "0")}.png`);
    writeFileSync(file, canvas.toBuffer("image/png"));
    show(blank, cue.start - t);
    show(file, cue.end - Math.max(cue.start, t));
    t = Math.max(t, cue.end);
  });
  show(blank, Math.max(total - t, 0.04));
  lines.push(`file '${blank}'`); // the concat demuxer ignores the last duration unless the file repeats

  const list = join(dir, "captions.txt");
  writeFileSync(list, lines.join("\n") + "\n");
  return list;
}

function wrap(ctx: { measureText(t: string): { width: number } }, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
