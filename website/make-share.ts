// The link-preview card (WhatsApp, X, LinkedIn, iMessage): node website/make-share.ts
// Writes website/public/share.png, 1200 x 630. Ink, the frame grid, the reel mark (the logo file as
// it is) and the line. Change the words here and run it again.
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1200;
const H = 630;
const here = import.meta.dirname;
GlobalFonts.registerFromPath(join(here, "../motion/fonts/Inter-Medium.ttf"), "Inter");
GlobalFonts.registerFromPath(join(here, "../motion/fonts/Inter-ExtraBold.ttf"), "Inter Bold");

const c = createCanvas(W, H);
const ctx = c.getContext("2d");
ctx.fillStyle = "#0a0a0a";
ctx.fillRect(0, 0, W, H);

// The frame grid behind everything, as on the site.
ctx.fillStyle = "rgba(255,255,255,0.09)";
for (let y = 15; y < H; y += 30) for (let x = 15; x < W; x += 30) (ctx.beginPath(), ctx.arc(x, y, 1.3, 0, Math.PI * 2), ctx.fill());

// The reel, from the logo file itself (white frames, red light).
const mark = await loadImage(readFileSync(join(here, "public/brand/mark-white.svg")));
ctx.drawImage(mark, 96, 150, 170, 170);

const label = (text: string, x: number, y: number, color: string) => {
  ctx.font = '500 22px "Inter"';
  ctx.letterSpacing = "6px";
  ctx.fillStyle = color;
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.letterSpacing = "0px";
};

label("Creatro ( for Mac )", 330, 190, "#9a9a9a");
ctx.font = '500 104px "Inter"';
ctx.letterSpacing = "-4px";
ctx.fillStyle = "#ffffff";
ctx.fillText("Cursor for video.", 322, 300);
ctx.letterSpacing = "0px";
ctx.font = '400 27px "Inter"';
ctx.fillStyle = "#9a9a9a";
ctx.fillText("Describe the edit, pick any AI model, get a finished video.", 330, 362);
ctx.fillText("It renders on your Mac. Your footage never leaves it.", 330, 400);

// Bottom line: the address and the one red light.
ctx.fillStyle = "#e5231b";
ctx.beginPath();
ctx.arc(108, 540, 7, 0, Math.PI * 2);
ctx.fill();
label("Rec", 128, 548, "#9a9a9a");
label("creatro.in", W - 96 - ctx.measureText("CREATRO.IN").width - 60, 548, "#ffffff");

writeFileSync(join(here, "public/share.png"), c.toBuffer("image/png"));
console.log("Share card: website/public/share.png");
