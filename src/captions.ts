// Captions: draw each cue (already placed on the OUTPUT timeline by timeline.ts)
// as a transparent PNG. The renderer overlays them as one image stream. (The ffmpeg we ship
// later will have libass; this keeps the prototype working with any ffmpeg build.)
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { libraryFonts } from "./fontLibrary.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EditPlan } from "./schema.ts";
import { type Cue, captionWrapWidth, cueFontSize, lookBox } from "./timeline.ts";
import { BUNDLED_FONTS, TEST_FONTS } from "./fonts.ts";
import { GAP, GRID_COLOR, TILE, type Tile, ransomWords } from "./ransom.ts";
import { ROOT } from "./tools.ts";

// Fallback so emoji in captions draw in colour instead of as empty boxes. Caption fonts are the Mac's
// own (CAPTION_FONTS), which the canvas finds by name.
const EMOJI_FONT = "/System/Library/Fonts/Apple Color Emoji.ttc";

/** Writes one PNG per cue plus a blank, and an ffmpeg concat list that plays them on time. */
export function drawCues(cues: Cue[], plan: EditPlan, width: number, height: number, dir: string, total: number): string {
  GlobalFonts.registerFromPath(EMOJI_FONT, "CaptionEmoji");
  // Creatron's own caption fonts (Anton, Bebas Neue, Poppins…), by family name like the Mac's.
  for (const f of [...BUNDLED_FONTS, ...TEST_FONTS]) GlobalFonts.registerFromPath(join(ROOT, "motion", "fonts", f.file), f.family);
  // And the fonts edits brought into Creatron's library.
  for (const f of libraryFonts()) GlobalFonts.registerFromPath(f.file, f.family);

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
    // Aligned captions line up on one edge of their column (as wide as the wrap width).
    ctx.textAlign = look.align;
    ctx.textBaseline = "middle";
    const text = plan.captions.uppercase ? cue.text.toUpperCase() : cue.text;
    // Typed line breaks are kept; long lines wrap at a width that grows with the text size.
    const wrapped = text.split("\n").flatMap((part) => wrap(ctx, part, captionWrapWidth(look, width)));
    const lineHeight = size * 1.2;
    const centerX = width * (0.5 + cue.x);
    const column = captionWrapWidth(look, width);
    const textX = look.align === "left" ? centerX - column / 2 : look.align === "right" ? centerX + column / 2 : centerX;
    const centerY = height * (0.5 + cue.y);
    const top = centerY - ((wrapped.length - 1) * lineHeight) / 2;
    const lineLeft = (w: number) => (look.align === "left" ? textX : look.align === "right" ? textX - w : textX - w / 2);

    if (look.outline === "ransom") {
      drawRansom(ctx, text, size, captionWrapWidth(look, width), centerX, centerY, look.align);
      const file = join(dir, `cap-${String(i).padStart(4, "0")}.png`);
      writeFileSync(file, canvas.toBuffer("image/png"));
      show(blank, cue.start - t);
      show(file, cue.end - Math.max(cue.start, t));
      t = Math.max(t, cue.end);
      return;
    }

    const box = lookBox(look);
    if (box) {
      const w = Math.max(...wrapped.map((l) => ctx.measureText(l).width)) + size;
      const h = wrapped.length * lineHeight + size * 0.4;
      ctx.fillStyle = box;
      ctx.beginPath();
      ctx.roundRect(look.align === "center" ? centerX - w / 2 : lineLeft(w - size) - size / 2, centerY - h / 2, w, h, size * 0.3);
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
        ctx.strokeText(line, textX, y);
        for (const by of bars) ctx.strokeRect(lineLeft(w), by - size * 0.035, w, size * 0.07);
      }
      ctx.fillStyle = look.color;
      ctx.fillText(line, textX, y);
      for (const by of bars) ctx.fillRect(lineLeft(w), by - size * 0.035, w, size * 0.07);
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

type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

/** The ransom-note look (src/ransom.ts): each letter on its own torn paper scrap, laid out like the
 *  preview's wrapping rows and centred on (cx, cy). */
function drawRansom(ctx: Ctx, text: string, size: number, maxWidth: number, cx: number, cy: number, align: "center" | "left" | "right") {
  const fontOf = (t: Tile) => `${t.weight} ${Math.round(size * t.scale)}px "${t.font}", Arial, CaptionEmoji`;
  const tileW = (t: Tile) => {
    ctx.font = fontOf(t);
    const fs = size * t.scale;
    return Math.max(TILE.minWidth * fs, ctx.measureText(t.ch).width + 2 * TILE.padX * fs);
  };
  // Words keep together; rows wrap at the caption's width.
  const words = ransomWords(text).map((tiles) => {
    const widths = tiles.map(tileW);
    return { tiles, widths, width: widths.reduce((a, b) => a + b, 0) + (tiles.length - 1) * GAP.letter * size };
  });
  const rows: (typeof words)[] = [];
  let row: typeof words = [];
  let rowW = 0;
  for (const w of words) {
    const next = row.length ? rowW + GAP.word * size + w.width : w.width;
    if (row.length && next > maxWidth) {
      rows.push(row);
      row = [w];
      rowW = w.width;
    } else {
      row.push(w);
      rowW = next;
    }
  }
  if (row.length) rows.push(row);

  const rowH = TILE.height * size * 1.12;
  const pitch = rowH + GAP.line * size;
  let y = cy - ((rows.length - 1) * pitch) / 2;
  for (const r of rows) {
    const w = r.reduce((a, b) => a + b.width, 0) + (r.length - 1) * GAP.word * size;
    let x = align === "left" ? cx - maxWidth / 2 : align === "right" ? cx + maxWidth / 2 - w : cx - w / 2;
    for (const word of r) {
      word.tiles.forEach((t, i) => {
        const tw = word.widths[i];
        const fs = size * t.scale;
        const th = TILE.height * fs;
        ctx.save();
        ctx.translate(x + tw / 2, y + t.lift * size);
        ctx.rotate((t.rotate * Math.PI) / 180);
        ctx.beginPath();
        t.shape.forEach(([px, py], k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, -tw / 2 + px * tw, -th / 2 + py * th));
        ctx.closePath();
        ctx.shadowColor = "rgba(0,0,0,0.45)";
        ctx.shadowBlur = size * 0.05;
        ctx.shadowOffsetY = size * 0.04;
        ctx.fillStyle = t.paper;
        ctx.fill();
        ctx.shadowColor = "transparent";
        if (t.grid) {
          ctx.save();
          ctx.clip();
          ctx.strokeStyle = GRID_COLOR;
          ctx.lineWidth = Math.max(1, size / 60);
          const step = fs * 0.25;
          ctx.beginPath();
          for (let gx = -tw / 2; gx < tw / 2; gx += step) (ctx.moveTo(gx, -th / 2), ctx.lineTo(gx, th / 2));
          for (let gy = -th / 2; gy < th / 2; gy += step) (ctx.moveTo(-tw / 2, gy), ctx.lineTo(tw / 2, gy));
          ctx.stroke();
          ctx.restore();
        }
        ctx.font = fontOf(t);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = t.ink;
        ctx.fillText(t.ch, 0, 0);
        ctx.restore();
        x += tw + GAP.letter * size;
      });
      x += GAP.word * size - GAP.letter * size;
    }
    y += pitch;
  }
}
