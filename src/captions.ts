// Captions: draw each cue (already placed on the OUTPUT timeline by timeline.ts)
// as a transparent PNG. The renderer overlays them as one image stream. (The ffmpeg we ship
// later will have libass; this keeps the prototype working with any ffmpeg build.)
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EditPlan } from "./schema.ts";
import { type Cue, cueFontSize, lookBox } from "./timeline.ts";
import { BUNDLED_FONTS } from "./fonts.ts";
import { ROOT } from "./tools.ts";

// Fallback so emoji in captions draw in colour instead of as empty boxes. Caption fonts are the Mac's
// own (CAPTION_FONTS), which the canvas finds by name.
const EMOJI_FONT = "/System/Library/Fonts/Apple Color Emoji.ttc";

/** Writes one PNG per cue plus a blank, and an ffmpeg concat list that plays them on time. */
export function drawCues(cues: Cue[], plan: EditPlan, width: number, height: number, dir: string, total: number): string {
  GlobalFonts.registerFromPath(EMOJI_FONT, "CaptionEmoji");
  // Creatron's own caption fonts (Anton, Bebas Neue, Poppins…), by family name like the Mac's.
  for (const f of BUNDLED_FONTS) GlobalFonts.registerFromPath(join(ROOT, "motion", "fonts", f.file), f.family);
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
    const look = cue.look;
    const size = Math.round(cueFontSize(plan, look, width, height));
    ctx.font = `${look.italic ? "italic " : ""}${look.bold ? "bold " : ""}${size}px "${look.font}", Arial, CaptionEmoji`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = plan.captions.uppercase ? cue.text.toUpperCase() : cue.text;
    // Typed line breaks are kept; long lines wrap at 86% of the frame width.
    const wrapped = text.split("\n").flatMap((part) => wrap(ctx, part, maxWidth));
    const lineHeight = size * 1.2;
    const centerX = width * (0.5 + cue.x);
    const centerY = height * (0.5 + cue.y);
    const top = centerY - ((wrapped.length - 1) * lineHeight) / 2;

    const box = lookBox(look);
    if (box) {
      const w = Math.max(...wrapped.map((l) => ctx.measureText(l).width)) + size;
      const h = wrapped.length * lineHeight + size * 0.4;
      ctx.fillStyle = box;
      ctx.beginPath();
      ctx.roundRect(centerX - w / 2, centerY - h / 2, w, h, size * 0.3);
      ctx.fill();
    }
    wrapped.forEach((line, n) => {
      const y = top + n * lineHeight;
      const w = ctx.measureText(line).width;
      // Underline and strikethrough: a bar under / through the line, with an edge like the letters.
      const bars = [look.underline && y + size * 0.42, look.strike && y + size * 0.02].filter((v): v is number => typeof v === "number");
      if (look.outline === "outline") {
        ctx.lineJoin = "round";
        ctx.lineWidth = size * 0.16;
        ctx.strokeStyle = "black";
        ctx.strokeText(line, centerX, y);
        for (const by of bars) ctx.strokeRect(centerX - w / 2, by - size * 0.035, w, size * 0.07);
      }
      ctx.fillStyle = look.color;
      ctx.fillText(line, centerX, y);
      for (const by of bars) ctx.fillRect(centerX - w / 2, by - size * 0.035, w, size * 0.07);
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
