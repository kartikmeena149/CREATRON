// A real picture (a photo the user added, or one Creatro found of a thing they named) drawn the way
// an artist draws from a reference: a graphite study. The drawing's lines come from the photo itself
// (its greys "colour-dodged" by a blurred negative of them: dark where the picture changes, paper where
// it's even), its shading from the photo's tones laid in under them, then pencil strokes over the
// shadows, the paper's tooth, and a soft wash of the photo's own colours (coloured pencil). A cut-out
// photo keeps its shape, and is the same on either page. Cached by picture and size.
type Look = "paper" | "dark";
const cache = new Map<string, HTMLCanvasElement>();

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** The picture as a pencil study, w x h device pixels (the caller keeps the picture's shape). */
export function photoSketch(img: HTMLImageElement, w: number, h: number, look: Look, key = img.src): HTMLCanvasElement {
  w = Math.max(8, Math.round(w));
  h = Math.max(8, Math.round(h));
  const id = `${key}|${w}x${h}|${look}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const m = Math.min(w, h);

  // The greys, a little more contrast than the photo.
  const grey = canvas(w, h);
  const gg = grey.getContext("2d")!;
  gg.fillStyle = "#fff";
  gg.fillRect(0, 0, w, h);
  gg.filter = "grayscale(1) contrast(1.15) brightness(1.04)";
  gg.drawImage(img, 0, 0, w, h);

  // The lines: the greys dodged by their blurred negative.
  const out = canvas(w, h);
  const g = out.getContext("2d")!;
  g.drawImage(grey, 0, 0);
  g.globalCompositeOperation = "color-dodge";
  g.filter = `invert(1) blur(${Math.max(1.5, m / 70)}px)`;
  g.drawImage(grey, 0, 0);
  g.filter = "none";
  // The shading: the photo's tones rubbed in under the lines, softer than the photo.
  g.globalCompositeOperation = "multiply";
  g.globalAlpha = 0.38;
  g.filter = "contrast(1.15) brightness(1.3)";
  g.drawImage(grey, 0, 0);
  g.filter = "none";
  g.globalAlpha = 1;

  // Pencil strokes over the shadows: short, slanted, denser where it's darker.
  let lum: Uint8ClampedArray | null = null;
  const sw = Math.max(16, Math.round(w / 4));
  const sh = Math.max(16, Math.round(h / 4));
  try {
    const small = canvas(sw, sh);
    const sg = small.getContext("2d", { willReadFrequently: true })!;
    sg.drawImage(grey, 0, 0, sw, sh);
    lum = sg.getImageData(0, 0, sw, sh).data;
  } catch {
    lum = null; // a picture from elsewhere that can't be read back: no strokes, the rest still draws
  }
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  if (lum) {
    g.globalCompositeOperation = "multiply";
    g.lineCap = "round";
    g.strokeStyle = "rgb(52,50,56)";
    const step = Math.max(2, m / 140);
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const sx = Math.min(sw - 1, Math.floor((x / w) * sw));
        const sy = Math.min(sh - 1, Math.floor((y / h) * sh));
        const dark = 1 - lum[(sy * sw + sx) * 4]! / 255;
        if (r() > dark * 1.3 - 0.12) continue;
        const len = step * (2.2 + r() * 2.2);
        const ang = 0.95 + (r() - 0.5) * 0.25 + (dark > 0.62 && r() < 0.5 ? 1.2 : 0); // crossed in the darkest
        g.globalAlpha = 0.1 + dark * 0.4;
        g.lineWidth = Math.max(0.5, m / 700) * (0.6 + r() * 0.6);
        g.beginPath();
        g.moveTo(x - Math.cos(ang) * len * 0.5, y - Math.sin(ang) * len * 0.5);
        g.lineTo(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  // The paper's tooth.
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "rgba(250,247,240,0.5)";
  for (let i = 0, n = Math.round((w * h) / 90); i < n; i++) g.fillRect(r() * w, r() * h, 1, 1);

  // Coloured pencil: the photo's own colours, softly, keeping the drawing's lights and darks.
  g.globalCompositeOperation = "color";
  g.globalAlpha = 0.5;
  g.filter = "saturate(1.25)";
  g.drawImage(img, 0, 0, w, h);
  g.filter = "none";
  g.globalAlpha = 1;

  // Only the picture's own shape (a cut-out keeps its outline; a photo stays a rectangle).
  g.globalCompositeOperation = "destination-in";
  g.drawImage(img, 0, 0, w, h);
  g.globalCompositeOperation = "source-over";

  // The same study on either page: a likeness turned into its negative reads as a ghost, so on the
  // dark page it stays a pencil drawing on paper, cut to its subject.
  void look;
  if (cache.size > 80) cache.delete(cache.keys().next().value!);
  cache.set(id, out);
  return out;
}
