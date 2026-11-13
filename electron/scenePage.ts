// Runs INSIDE a Claude edit once it's loaded (a HyperFrames page with its runtime, or a bundled
// Remotion project): steps it frame by frame and writes down every element as a layer: where it
// is, how big, turned, faded and coloured, and how it looks. sceneImport.ts turns that into
// keyframes (src/scene.ts). Elements are found on every frame, since Remotion only mounts a
// Sequence's content while it's on screen. capturePage is sent to the page as source text, so it
// must not use anything outside itself.

export type PageLayer = {
  id: string;
  parent: number; // index of the parent layer, -1 for the top
  name: string;
  kind: "group" | "text" | "image" | "video" | "svg";
  style: Record<string, string>;
  origin: [number, number];
  html?: string;
  text?: string;
  src?: string;
  svg?: string;
  muted?: boolean;
  /** At the frame its look was taken: index into the samples. */
  styleFrame: number;
  /** Positioned in the page (paints over unpositioned siblings). */
  positioned?: boolean;
  /** One-line text in a box exactly as wide as its words. */
  fit?: boolean;
  /** Its place among its siblings in the page (they may appear at different times). */
  rank?: number;
};

/**
 * Per frame, per layer: [bx, by, bw, bh, tx, ty, sx, sy, rot, opacity, show, blur, mediaTime, seen].
 * styles: by layer index, each style that changed over time as [frame, value] wherever it changed;
 * html: by layer index, a text layer's words wherever they changed ([frame, html, text, its look]).
 */
export type PageCapture = {
  width: number;
  height: number;
  duration: number;
  fps: number;
  layers: PageLayer[];
  frames: number[][][];
  styles: Record<number, Record<string, [number, string][]>>;
  html: Record<number, [number, string, string, Record<string, string>?][]>;
  /** By layer index, an SVG drawing wherever its insides changed: [frame, markup]. */
  svg?: Record<number, [number, string][]>;
  /** Older recordings: text and background colour per frame (now part of styles). */
  colors?: [string, string][][];
  fonts: string[];
  audio: { src: string; start: number; duration: number; offset: number; volume: number; name: string }[];
};

export type CaptureOptions = {
  fps: number;
  maxLayers: number;
  /** A bundled Remotion project: the composition to step through (set up by sceneImport). */
  remotion?: { id: string; fps: number; frames: number; width: number; height: number };
};

export async function capturePage(opts: CaptureOptions): Promise<PageCapture> {
  const w = window as any;
  const R = opts.remotion;
  const fps = R ? R.fps : opts.fps;
  const duration: number = R ? R.frames / R.fps : w.__player.getDuration();
  const hfRoot = document.querySelector("[data-composition-id]") as HTMLElement | null;
  // Remotion draws the composition into a box exactly its size.
  const root = (R
    ? [...document.querySelectorAll("body *")].find((e) => {
        const r = e.getBoundingClientRect();
        return Math.abs(r.width - R.width) < 1 && Math.abs(r.height - R.height) < 1 && e.children.length > 0;
      })
    : hfRoot) as HTMLElement;
  const width = R ? R.width : Number(hfRoot!.dataset.width) || root.offsetWidth;
  const height = R ? R.height : Number(hfRoot!.dataset.height) || root.offsetHeight;
  const ready = async () => {
    for (let i = 0; i < 600 && w.remotion_renderReady !== true; i++) {
      if (w.remotion_cancelledError) throw new Error(String(w.remotion_cancelledError).split("\n")[0]);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const seek = async (t: number) => {
    if (!R) return w.__player.renderSeek(t);
    w.remotion_setFrame(Math.min(R.frames - 1, Math.round(t * R.fps)), R.id, w.remotion_attempt ?? 1);
    await ready();
  };

  const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "AUDIO", "LINK", "META", "NOSCRIPT", "SOURCE", "TRACK", "BR", "WBR", "IFRAME", "OBJECT"]);
  const els: Element[] = [];
  const index = new WeakMap<Element, number>();
  const layers: PageLayer[] = [];
  const hasText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
  const kindOf = (el: Element): PageLayer["kind"] | null => {
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(el.tagName) || tag === "canvas" || (el instanceof SVGElement && tag !== "svg")) return null;
    return tag === "svg" ? "svg" : tag === "img" ? "image" : tag === "video" ? "video" : hasText(el) ? "text" : "group";
  };
  // Each parent's children in page order, kept across frames: one that appears later goes right
  // after the sibling it follows in the page (so a shot mounted later still paints under the captions).
  const order = new Map<number, number[]>();
  // This frame's elements: new ones become layers (under their parent's layer). Returns its layer.
  const walk = (el: Element, parent: number, present: Set<number>, prev: number): number | undefined => {
    const kind = kindOf(el);
    if (!kind) return;
    let i = index.get(el);
    // React may reuse an element for something else (a number chip in one caption, a word's wrapper
    // in the next): when its role changes it carries on as a new layer.
    if (i !== undefined && layers[i].kind !== kind) i = undefined;
    if (i === undefined) {
      if (layers.length >= opts.maxLayers) return;
      i = layers.length;
      const siblings = order.get(parent) ?? [];
      siblings.splice(prev < 0 ? 0 : siblings.indexOf(prev) + 1, 0, i);
      order.set(parent, siblings);
      index.set(el, i);
      els.push(el);
      const name = el.id || (el.getAttribute("class") || "").split(/\s+/).filter(Boolean)[0] || el.tagName.toLowerCase();
      layers.push({ id: `L${i}`, parent, name, kind, style: {}, origin: [0, 0], styleFrame: -1 });
    }
    present.add(i);
    let before = -1;
    if (layers[i].kind === "group") for (const c of el.children) before = walk(c, i, present, before) ?? before;
    return i;
  };

  // Layout boxes without any transform (transforms are sampled on their own).
  const flat = document.createElement("style");
  flat.textContent = "*{transform:none!important;translate:none!important;rotate:none!important;scale:none!important;transition:none!important}";
  const num = (s: string) => parseFloat(s) || 0;
  /** "calc(-50% + 9px) 4px" → ["calc(-50% + 9px)", "4px"]: split at spaces outside brackets. */
  const splitTop = (v: string) => {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of v) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === " " && depth === 0) (cur && out.push(cur)), (cur = "");
      else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  };
  /** A CSS length in px: 12px, 50% of `size`, or calc() sums of them. */
  const length = (v: string, size: number): number => {
    const terms = v.replace(/^calc\(|\)$/g, "").match(/[+-]?\s*-?[\d.]+(?:e-?\d+)?(?:%|px)?/g) ?? [];
    return terms.reduce((sum, t) => {
      const sign = /^-\s/.test(t) ? -1 : 1;
      const x = t.replace(/^[+-]\s+/, "");
      return sum + sign * (x.endsWith("%") ? (parseFloat(x) / 100) * size : parseFloat(x) || 0);
    }, 0);
  };
  const blurOf = (f: string) => {
    const m = /blur\(([\d.]+)px\)/.exec(f);
    return m ? Number(m[1]) : 0;
  };

  const BOX = [
    "background-color", "background-image", "background-size", "background-position", "background-repeat", "background-clip", "-webkit-background-clip",
    "border-top-width", "border-top-style", "border-top-color", "border-right-width", "border-right-style", "border-right-color",
    "border-bottom-width", "border-bottom-style", "border-bottom-color", "border-left-width", "border-left-style", "border-left-color",
    "border-radius", "box-shadow", "overflow", "clip-path", "mix-blend-mode", "backdrop-filter", "z-index",
    "padding-top", "padding-right", "padding-bottom", "padding-left", "object-fit", "object-position",
    "mask-image", "-webkit-mask-image", "mask-size", "-webkit-mask-size", "mask-position", "-webkit-mask-position", "mask-repeat", "-webkit-mask-repeat",
  ];
  const TEXT = [
    "color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "word-spacing", "text-transform",
    "text-align", "text-shadow", "white-space", "text-decoration-line", "text-decoration-color", "text-decoration-style", "text-indent",
    "-webkit-text-stroke-width", "-webkit-text-stroke-color", "-webkit-text-fill-color", "font-feature-settings", "font-variant",
    "display", "align-items", "justify-content", "flex-direction", "gap", "vertical-align",
  ];
  const DEFAULTS: Record<string, string[]> = {
    "background-color": ["rgba(0, 0, 0, 0)"], "background-image": ["none"], "box-shadow": ["none"], overflow: ["visible"], "clip-path": ["none"],
    "mix-blend-mode": ["normal"], "backdrop-filter": ["none"], "z-index": ["auto"], "border-radius": ["0px"], "text-shadow": ["none"],
    "object-fit": ["fill"], "background-repeat": ["repeat"], "background-size": ["auto"], "background-position": ["0% 0%"],
    "background-clip": ["border-box"], "-webkit-background-clip": ["border-box"], "text-decoration-line": ["none"], "text-indent": ["0px"],
    "-webkit-text-stroke-width": ["0px"], "font-feature-settings": ["normal"], "font-variant": ["normal"], "letter-spacing": ["normal"],
    "word-spacing": ["0px"], "text-transform": ["none"], "vertical-align": ["baseline"], gap: ["normal"],
    "mask-image": ["none"], "-webkit-mask-image": ["none"], "mask-size": ["auto"], "-webkit-mask-size": ["auto"],
    "mask-position": ["0% 0%", "center"], "-webkit-mask-position": ["0% 0%", "center"], "mask-repeat": ["repeat"], "-webkit-mask-repeat": ["repeat"],
  };
  /** An element's CSS as computed now, without the defaults (kebab-case). */
  const styleOf = (el: Element, kind: PageLayer["kind"]): Record<string, string> => {
    const cs = getComputedStyle(el);
    const out: Record<string, string> = {};
    const L = { kind, style: out };
    const props = kind === "text" ? [...BOX, ...TEXT] : BOX;
    for (const p of props) {
      const v = cs.getPropertyValue(p);
      if (!v || DEFAULTS[p]?.includes(v)) continue;
      if (p.startsWith("border-") && p.endsWith("-width") && v === "0px") continue;
      if (p.startsWith("border-") && (p.endsWith("-style") || p.endsWith("-color")) && cs.getPropertyValue(p.replace(/-(style|color)$/, "-width")) === "0px") continue;
      if (p.startsWith("padding") && v === "0px") continue;
      if (p === "display" && !/flex|grid/.test(v)) continue;
      if (["align-items", "justify-content", "flex-direction"].includes(p) && !/flex|grid/.test(cs.display)) continue;
      if (p === "overflow" && L.kind !== "group" && L.kind !== "text") continue;
      if (p.startsWith("object-") && L.kind !== "image" && L.kind !== "video") continue;
      if (p.startsWith("text-decoration-") && p !== "text-decoration-line" && cs.textDecorationLine === "none") continue;
      if (p === "-webkit-text-stroke-color" && cs.getPropertyValue("-webkit-text-stroke-width") === "0px") continue;
      if (p === "-webkit-text-fill-color" && v === cs.color) continue;
      if (/mask-(size|position|repeat)$/.test(p) && cs.getPropertyValue(p.startsWith("-webkit") ? "-webkit-mask-image" : "mask-image") === "none") continue;
      L.style[p] = v;
    }
    // A static blur (or other filter) stays a style; an animated blur is sampled.
    // An inline word's box is its font's full height, taller than its line: drawn as a block, its
    // line must be that tall too, or the letters sit higher than they did (and a clip cuts their tops).
    if (kind === "text" && cs.display === "inline") {
      // Lines of its own words (not of things inside it, like a strike-through bar).
      const lines = new Set<number>();
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0) lines.add(Math.round(r.top + r.height / 2));
      }
      const k = (el as HTMLElement).offsetWidth ? el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth : 1;
      if (lines.size <= 1 && k) out["line-height"] = `${Math.round((el.getBoundingClientRect().height / k) * 100) / 100}px`;
    }
    const rest = cs.filter.replace(/blur\([\d.]+px\)\s*/g, "").trim();
    if (rest && rest !== "none") L.style.filter = rest; // the blur is its own animated channel
    return out;
  };
  /** How a layer looks, taken at the frame it's seen best (it may not exist at other frames). */
  const takeLook = (i: number, f: number) => {
    const el = els[i];
    const L = layers[i];
    const cs = getComputedStyle(el);
    L.styleFrame = f;
    L.style = styleOf(el, L.kind);
    L.positioned = cs.position !== "static";
    const o = cs.transformOrigin.split(" ").map(num);
    L.origin = [o[0] ?? 0, o[1] ?? 0];
    if (L.kind === "text") {
      // Text that sat on one line stays on one line (fonts measure a hair differently elsewhere).
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top + r.height / 2)));
      if (lines.size <= 1 && !/pre/.test(cs.whiteSpace)) L.style["white-space"] = "nowrap";
      // A box as wide as its words (not one with a set width) grows with new words.
      const box = el.getBoundingClientRect();
      const k = (el as HTMLElement).offsetWidth ? box.width / (el as HTMLElement).offsetWidth : 1;
      const inner = box.width - (parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)) * k;
      L.fit = lines.size <= 1 && range.getBoundingClientRect().width >= inner - 2 * k;
      L.html = el.innerHTML.trim();
      L.text = (el as HTMLElement).innerText.trim();
      L.name = el.id || L.text.slice(0, 32) || L.name;
    }
    if (L.kind === "image") L.src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
    if (L.kind === "video") {
      const v = el as HTMLVideoElement;
      L.src = v.dataset.src ? new URL(v.dataset.src, location.href).href : v.currentSrc || v.src || v.querySelector("source")?.src;
      L.muted = v.muted || v.hasAttribute("muted");
    }
    if (L.kind === "svg") {
      L.svg = svgOf(el);
      L.style.color = cs.color;
    }
  };
  /** An SVG drawing on its own: the page's CSS colours go onto the shapes themselves. */
  const svgOf = (el: Element): string => {
    const copy = el.cloneNode(true) as SVGElement;
    const src = el.querySelectorAll("*");
    copy.querySelectorAll("*").forEach((n, k) => {
      const s = getComputedStyle(src[k]);
      const keep = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "stop-color", "stop-opacity"];
      (n as SVGElement).setAttribute("style", keep.map((k2) => `${k2}:${s.getPropertyValue(k2)}`).join(";"));
    });
    for (const a of ["id", "class", "style", "width", "height"]) copy.removeAttribute(a);
    copy.setAttribute("width", "100%");
    copy.setAttribute("height", "100%");
    copy.setAttribute("preserveAspectRatio", el.getAttribute("preserveAspectRatio") || "xMidYMid meet");
    return copy.outerHTML;
  };

  const frames: number[][][] = [];
  // Styles Remotion (or a page's script) changes frame by frame, besides the transform and opacity.
  const TRACK = [
    "clip-path", "color", "background-color", "background-image", "background-position", "background-size", "filter", "backdrop-filter",
    "font-family", "font-style", "text-transform", "font-size", "font-weight", "letter-spacing", "line-height", "border-radius", "box-shadow", "text-shadow", "-webkit-text-stroke-width",
    "-webkit-text-stroke-color", "-webkit-text-fill-color", "-webkit-mask-image", "mask-image", "border-top-color", "border-top-width",
    "text-decoration-color", "padding-top", "padding-left",
  ];
  const styleRuns: Record<number, Record<string, [number, string][]>> = {};
  const svgRuns: Record<number, { raw: string; runs: [number, string][] }> = {};
  const htmlRuns: Record<number, [number, string, string, Record<string, string>][]> = {};
  const count = Math.max(1, Math.round(duration * fps));
  const last: number[][] = [];
  const bestSeen: number[] = [];
  // Remotion: each frame's sounds (what its renderer mixes the export's audio from).
  const sounds = new Map<string, { src: string; type: string; first: number; last: number; media: number; volumes: number[] }>();
  for (let f = 0; f <= count; f++) {
    const t = Math.min(duration - (R ? 1 / fps : 0), f / fps);
    await seek(t);
    w.__captureProgress = f / count;
    const before = layers.length;
    const present = new Set<number>();
    walk(root, -1, present, -1);
    const row: number[][] = [];
    for (let i = 0; i < els.length; i++) {
      last[i] ??= [0, 0, 0, 0];
      if (!present.has(i)) {
        // Not in the page this frame: kept where it was, switched off.
        const prev = frames[f - 1]?.[i];
        row.push(prev ? [...prev.slice(0, 10), 0, prev[11], prev[12], 0] : [0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0]);
        continue;
      }
      const cs = getComputedStyle(els[i]);
      // The whole movement: the translate / rotate / scale properties, then transform (the browser's order).
      const M = new DOMMatrix();
      if (cs.translate && cs.translate !== "none") {
        const [x = "0", y = "0"] = splitTop(cs.translate);
        const box = (els[i] as HTMLElement).offsetWidth !== undefined ? [(els[i] as HTMLElement).offsetWidth, (els[i] as HTMLElement).offsetHeight] : [0, 0];
        M.translateSelf(length(x, box[0]), length(y, box[1]));
      }
      if (cs.rotate && cs.rotate !== "none") {
        const deg = /(-?[\d.]+)(deg|rad|turn)\s*$/.exec(cs.rotate);
        if (deg) M.rotateSelf(Number(deg[1]) * (deg[2] === "rad" ? 180 / Math.PI : deg[2] === "turn" ? 360 : 1));
      }
      if (cs.scale && cs.scale !== "none") {
        const [x, y = x] = cs.scale.split(" ").map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : Number(v)));
        M.scaleSelf(x, y);
      }
      if (cs.transform && cs.transform !== "none") M.multiplySelf(new DOMMatrix(cs.transform));
      const tx = M.e, ty = M.f;
      const sx = Math.hypot(M.a, M.b);
      const sy = sx ? (M.a * M.d - M.b * M.c) / sx : 0;
      const rot = (Math.atan2(M.b, M.a) * 180) / Math.PI;
      const show = cs.display === "none" || cs.visibility === "hidden" ? 0 : 1;
      // A Remotion stand-in says its moment (data-time); a real video has its playhead.
      const vid = els[i] instanceof HTMLVideoElement ? (els[i] as HTMLVideoElement) : undefined;
      const media = vid ? (vid.dataset.time !== undefined ? Number(vid.dataset.time) : vid.currentTime) : 0;
      row.push([0, 0, 0, 0, tx, ty, sx, sy, rot, num(cs.opacity), show, blurOf(cs.filter), media, 0]);
      // Styles and words: written down only where they change.
      const runs = (styleRuns[i] ??= {});
      for (const p of TRACK) {
        let v = cs.getPropertyValue(p);
        if (p === "filter") v = v.replace(/blur\([\d.]+px\)\s*/g, "").trim() || "none"; // the blur is sampled on its own
        const r = (runs[p] ??= []);
        if (!r.length || r[r.length - 1][1] !== v) r.push([f, v]);
      }
      // A drawing that moves inside (its shapes' attributes change) is written down whenever it does.
      if (layers[i].kind === "svg") {
        const raw = els[i].innerHTML;
        const r = (svgRuns[i] ??= { raw: "", runs: [] });
        if (raw !== r.raw) (r.raw = raw), r.runs.push([f, svgOf(els[i])]);
      }
      if (layers[i].kind === "text") {
        const h = (htmlRuns[i] ??= []);
        const html = els[i].innerHTML.trim();
        // Each wording keeps its own look (a slot can be a plain word in one caption, a number chip in the next).
        if (!h.length || h[h.length - 1][1] !== html) h.push([f, html, (els[i] as HTMLElement).innerText.trim(), styleOf(els[i], "text")]);
      }
    }
    document.head.appendChild(flat);
    for (const i of present) {
      const r = els[i].getBoundingClientRect();
      // Hidden things have no box: keep the last one they had.
      if (r.width || r.height) last[i] = [r.left, r.top, r.width, r.height];
      row[i].splice(0, 4, ...last[i]);
    }
    flat.remove();
    // How visible each layer is (its parents' fades included); its look is taken where it's seen best.
    for (const i of present) {
      let o = row[i][9] * row[i][10];
      for (let p = layers[i].parent; p >= 0; p = layers[p].parent) o *= row[p][9] * row[p][10];
      row[i][13] = o;
      if (layers[i].styleFrame < 0 || o > bestSeen[i] + 1e-3) {
        bestSeen[i] = o;
        takeLook(i, f);
      }
    }
    // Layers that first appeared now were off in every earlier frame.
    for (let i = before; i < layers.length; i++)
      for (let g = 0; g < f; g++) {
        frames[g][i] = [...row[i].slice(0, 10), 0, row[i][11], row[i][12], 0];
      }
    frames.push(row);
    if (R && w.remotion_collectAssets)
      for (const a of w.remotion_collectAssets() as { type: string; src: string; id: string; frame: number; volume: number; mediaFrame: number }[]) {
        if (a.type !== "audio" && a.type !== "video") continue;
        const s = sounds.get(a.id) ?? { src: a.src, type: a.type, first: f, last: f, media: a.mediaFrame / fps, volumes: [] };
        s.last = f;
        s.volumes.push(a.volume);
        sounds.set(a.id, s);
      }
  }
  // The composition's own box is the scene's corner, wherever the page put it.
  for (const row of frames) if (row[0]) (row[0][0] = 0), (row[0][1] = 0);
  // Boxes relative to the parent layer's corner (inside its border).
  for (const row of frames)
    for (let i = row.length - 1; i >= 0; i--) {
      const p = layers[i].parent;
      if (p < 0) continue;
      row[i][0] -= row[p][0];
      row[i][1] -= row[p][1];
    }

  // Fonts: the page's own @font-face rules (cross-site sheets fetched as text), and fonts made
  // in code (Remotion's Google fonts), recorded as they were created and kept if they loaded.
  const abs = (css: string, base: string) => css.replace(/url\((['"]?)([^'")]+)\1\)/g, (_m, _q, u) => `url("${new URL(u, base).href}")`);
  const fonts: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList | undefined;
    try {
      rules = sheet.cssRules;
    } catch {
      if (sheet.href) {
        try {
          const text = await (await fetch(sheet.href)).text();
          fonts.push(...(text.match(/@font-face\s*{[^}]*}/g) ?? []).map((r) => abs(r, sheet.href!)));
        } catch {}
      }
      continue;
    }
    for (const r of [...rules]) if (r instanceof CSSFontFaceRule) fonts.push(abs(r.cssText, sheet.href || location.href));
  }
  for (const { face, family, source, desc } of (w.__fontFaces ?? []) as { face: FontFace; family: string; source: string; desc: Record<string, string> }[]) {
    if (face.status !== "loaded") continue;
    const NAMES: Record<string, string> = { weight: "font-weight", style: "font-style", stretch: "font-stretch", unicodeRange: "unicode-range", featureSettings: "font-feature-settings", display: "font-display" };
    const extra = Object.entries(desc).filter(([k, v]) => NAMES[k] && v).map(([k, v]) => `${NAMES[k]}: ${v};`).join(" ");
    fonts.push(`@font-face { font-family: "${family.replace(/^["']|["']$/g, "")}"; src: ${abs(source, location.href)}; ${extra} }`);
  }

  // Sound becomes clips on Creatro's audio tracks.
  const audio: PageCapture["audio"] = [];
  if (R) {
    for (const [id, s] of sounds) {
      const volume = s.volumes.reduce((a, b) => a + b, 0) / s.volumes.length;
      if (volume <= 0) continue;
      audio.push({ src: s.src, start: s.first / fps, offset: s.media, duration: (s.last - s.first + 1) / fps, volume, name: s.src.split("/").pop()?.split("?")[0] || id });
    }
  } else {
    // HyperFrames: <audio> clips timed by their data attributes, and videos that play their own sound.
    document.querySelectorAll("audio").forEach((a) => {
      const d = a.dataset;
      const src = a.currentSrc || a.src || a.querySelector("source")?.src;
      if (!src) return;
      const start = Number(d.start) || 0;
      const offset = Number(d.mediaStart ?? d.trimStart ?? 0) || 0;
      const len = Number.isFinite(a.duration) ? a.duration - offset : 0;
      audio.push({ src, start, offset, duration: Number(d.duration) || len || Math.max(0.1, duration - start), volume: d.volume !== undefined ? Number(d.volume) : 1, name: a.id || src.split("/").pop()! });
    });
    layers.forEach((L, i) => {
      if (L.kind !== "video" || L.muted || !L.src) return;
      const shown = frames.findIndex((row) => row[i][10] > 0);
      if (shown < 0) return;
      const end = frames.findLastIndex((row) => row[i][10] > 0);
      audio.push({ src: L.src, start: shown / fps, offset: frames[shown][i][12], duration: Math.max(0.1, (end - shown + 1) / fps), volume: 1, name: L.name });
    });
  }

  for (const [p, list] of order) list.forEach((i, k) => (layers[i].rank = k));
  // Only what actually changed is kept.
  const styles: PageCapture["styles"] = {};
  for (const [i, runs] of Object.entries(styleRuns))
    for (const [p, r] of Object.entries(runs)) if (r.length > 1) (styles[Number(i)] ??= {})[p] = r;
  const html: PageCapture["html"] = {};
  for (const [i, r] of Object.entries(htmlRuns)) if (r.length > 1) html[Number(i)] = r;
  const svg: PageCapture["svg"] = {};
  for (const [i, r] of Object.entries(svgRuns)) if (r.runs.length > 1) svg[Number(i)] = r.runs;
  return { width, height, duration, fps, layers, frames, styles, html, svg, fonts, audio };
}
