// The Text section for a title of an imported Claude edit: everything about how it reads in one
// place, like an editor's text inspector. Its words; font, weight, style, case and alignment;
// letter and line spacing; fill, stroke, shadow and background box (each colour with the full
// picker); then its size, place, turn and opacity with keyframes. Every change is a CSS value on
// its text layers in the plan (LayerEdit.style), so the preview and the export draw it the same.
import { useMemo } from "react";
import { type Scene, type SceneLayer, flatLayers } from "../src/scene.ts";
import type { SceneClip } from "../src/sceneClips.ts";
import { CAPTION_FONTS, type Motion } from "../src/schema.ts";
import { ColorField, formatColor, parseColor } from "./ColorPicker.tsx";
import { Slider, Toggle } from "./Inspector.tsx";
import { ClipHeader, ClipTransform } from "./SceneClipPanel.tsx";
import { useSelectedClip } from "./SceneClips.tsx";
import { useEditor } from "./store.ts";

/** The Text section's panel for the selected title, or null when no title is selected. */
export function TextClipPanel() {
  const sel = useSelectedClip();
  const time = useEditor((s) => s.time);
  if (!sel || sel.clip.kind !== "text") return null;
  return <TextPanel key={`${sel.m.id}:${sel.clip.id}`} m={sel.m} scene={sel.scene} clip={sel.clip} time={time} />;
}

const WEIGHTS: [string, string][] = [["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"], ["900", "Black"]];
const px = (v: string | undefined, fallback = 0) => (v && /px$/.test(v) ? parseFloat(v) : fallback);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A text-shadow's first shadow: colour, offsets and blur. */
function parseShadow(v: string | undefined): { color: string; x: number; y: number; blur: number } | null {
  if (!v || v === "none") return null;
  const first = v.split(/,(?![^(]*\))/)[0].trim();
  const color = /(rgba?\([^)]+\)|#[0-9a-f]{3,8})/i.exec(first)?.[1] ?? "rgba(0, 0, 0, 0.8)";
  const nums = first.replace(color, "").trim().split(/\s+/).map((n) => parseFloat(n)).filter((n) => !Number.isNaN(n));
  return { color, x: nums[0] ?? 0, y: nums[1] ?? 0, blur: nums[2] ?? 0 };
}
const shadowCss = (s: { color: string; x: number; y: number; blur: number }) => `${s.color} ${r1(s.x)}px ${r1(s.y)}px ${r1(s.blur)}px`;

function TextPanel({ m, scene, clip, time }: { m: Motion; scene: Scene; clip: SceneClip; time: number }) {
  const { checkpoint, editLayer, libraryFonts } = useEditor();
  const byId = useMemo(() => new Map(flatLayers(scene.layers).map((x) => [x.layer.id, x.layer])), [scene]);
  const main = clip.colorLayers[0] ?? clip.textLayers[0];
  const base: SceneLayer | undefined = byId.get(main);
  const own = m.layers?.[main]?.style ?? {};
  /** A style value as it is now: the user's, else the edit's own. */
  const get = (k: string) => own[k] ?? base?.style[k];
  /** Sets style values on the clip's text layers, the font and spacing on all (a glow copy keeps the same shape), the look on its own words. */
  const set = (values: Record<string, string>, opts: { all?: boolean; record?: boolean } = {}) => {
    if (opts.record !== false) checkpoint();
    for (const id of opts.all ? clip.textLayers : clip.colorLayers)
      editLayer(m.id, id, (e) => ({ ...e, style: { ...e.style, ...values } }), false);
  };
  const live = (values: Record<string, string>, all = false) => set(values, { all, record: false });

  // Colours already in the edit, most used first, for the pickers.
  const palette = useMemo(() => {
    const n = new Map<string, number>();
    for (const { layer } of flatLayers(scene.layers))
      for (const k of ["color", "-webkit-text-fill-color", "-webkit-text-stroke-color", "background-color"]) {
        const c = parseColor(layer.style[k]);
        if (c && c.a > 0.05) n.set(formatColor({ ...c, a: 1 }), (n.get(formatColor({ ...c, a: 1 })) ?? 0) + 1);
      }
    return [...n].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [scene]);

  const family = (get("font-family") ?? "").split(",")[0].replace(/["']/g, "").trim();
  const weight = get("font-weight") ?? "400";
  const italic = get("font-style") === "italic";
  const underline = /underline/.test(get("text-decoration-line") ?? get("text-decoration") ?? "");
  const textCase = get("text-transform") ?? "none";
  const align = (get("text-align") ?? "start").replace("start", "left").replace("end", "right");
  const size = px(get("font-size"), 100);
  const letter = px(get("letter-spacing"), 0);
  const line = get("line-height") === "normal" || !get("line-height") ? 1.2 : px(get("line-height"), size * 1.2) / size;
  const fill = get("-webkit-text-fill-color") && parseColor(get("-webkit-text-fill-color")) ? get("-webkit-text-fill-color") : get("color");
  const strokeW = px(get("-webkit-text-stroke-width"), 0);
  const strokeC = get("-webkit-text-stroke-color") ?? "#000000";
  const shadow = parseShadow(get("text-shadow"));
  const boxBg = get("background-color");
  const hasBox = Boolean(parseColor(boxBg)?.a);
  const changed = clip.textLayers.some((id) => m.layers?.[id]?.style) || clip.texts.some((x) => m.layers?.[x.id]?.text !== undefined);
  const resetStyle = () => {
    checkpoint();
    for (const id of clip.textLayers) editLayer(m.id, id, (e) => ({ ...e, style: undefined, text: undefined }), false);
  };
  const seg = (value: string, options: [string, string, string?][], onPick: (v: string) => void) => (
    <div className="segmented tp-seg">
      {options.map(([v, label, title]) => <button key={v} className={v === value ? "on" : ""} title={title} onClick={() => v !== value && onPick(v)}>{label}</button>)}
    </div>
  );

  return (
    <>
      <ClipHeader m={m} scene={scene} clip={clip} compact />

      <section className="sc-panel tp">
        <h3>
          Text
          {changed && <button className="link tp-reset" title="Back to the edit's own words and look" onClick={resetStyle}>Reset text</button>}
        </h3>
        {clip.texts.length ? clip.texts.map((x) => (
          <textarea key={x.id} className="vl-input tp-words" rows={Math.min(4, Math.max(1, Math.ceil(x.text.length / 26)))} defaultValue={x.text}
            style={{ fontFamily: family ? `"${family}"` : undefined, textTransform: textCase as React.CSSProperties["textTransform"] }}
            onFocus={checkpoint} onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => editLayer(m.id, x.id, (ed) => ({ ...ed, text: e.target.value }), false)} />
        )) : <p className="hint">Its words change as it plays (a counter, or typing), so they stay as the edit made them. Everything else here applies.</p>}
      </section>

      <section className="sc-panel tp">
        <h3>Font</h3>
        <select className="vl-input tp-font" value={family} style={{ fontFamily: `"${family}"` }}
          onChange={(e) => set({ "font-family": `"${e.target.value}", sans-serif` }, { all: true })}>
          {[...new Set([family, ...libraryFonts, ...CAPTION_FONTS])].filter(Boolean).map((f) => <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>)}
        </select>
        <div className="tp-row">
          <select className="vl-input tp-weight" value={WEIGHTS.find(([w]) => w === String(weight)) ? String(weight) : "400"}
            onChange={(e) => set({ "font-weight": e.target.value }, { all: true })}>
            {WEIGHTS.map(([w, n]) => <option key={w} value={w}>{n}</option>)}
          </select>
          <div className="tp-toggles">
            <button className={`tp-tog ${italic ? "on" : ""}`} title="Italic" onClick={() => set({ "font-style": italic ? "normal" : "italic" }, { all: true })}><i>I</i></button>
            <button className={`tp-tog ${underline ? "on" : ""}`} title="Underline" onClick={() => set({ "text-decoration-line": underline ? "none" : "underline", "text-decoration": underline ? "none" : "underline" })}><u>U</u></button>
          </div>
        </div>
        <div className="tp-row">
          {seg(textCase, [["none", "Aa", "As typed"], ["uppercase", "AA", "All capitals"], ["lowercase", "aa", "All lower case"], ["capitalize", "Ab", "Capitalise each word"]], (v) => set({ "text-transform": v }, { all: true }))}
          {seg(align, [["left", "⟸", "Align left"], ["center", "≡", "Centre"], ["right", "⟹", "Align right"]], (v) => set({ "text-align": v }, { all: true }))}
        </div>
        <Slider label="Letter spacing" unit=" px" min={-20} max={40} step={0.1} value={letter} display={r1}
          onStart={checkpoint} onChange={(v) => live({ "letter-spacing": `${r1(v)}px` }, true)} />
        <Slider label="Line height" unit="×" min={0.6} max={2.2} step={0.01} value={line} display={(v) => Math.round(v * 100) / 100}
          onStart={checkpoint} onChange={(v) => live({ "line-height": `${Math.round(v * size * 10) / 10}px` }, true)} />
      </section>

      <section className="sc-panel tp">
        <h3>Colour</h3>
        <div className="tp-line">
          <span className="tp-label">Fill</span>
          <ColorField label="Fill" value={fill} palette={palette} onStart={checkpoint}
            onChange={(c) => live({ color: c, "-webkit-text-fill-color": c, "text-decoration-color": c })} />
        </div>
        <div className="tp-line">
          <span className="tp-label">Stroke</span>
          <Toggle value={strokeW > 0} onChange={(on) => set({ "-webkit-text-stroke-width": on ? `${Math.max(2, Math.round(size / 40))}px` : "0px", "-webkit-text-stroke-color": strokeC })} />
          {strokeW > 0 && <ColorField label="Stroke" value={strokeC} palette={palette} onStart={checkpoint} onChange={(c) => live({ "-webkit-text-stroke-color": c })} />}
        </div>
        {strokeW > 0 && (
          <Slider label="Stroke width" unit=" px" min={0.5} max={Math.max(20, Math.round(size / 6))} step={0.5} value={strokeW} display={r1}
            onStart={checkpoint} onChange={(v) => live({ "-webkit-text-stroke-width": `${r1(v)}px` })} />
        )}
        <div className="tp-line">
          <span className="tp-label">Shadow</span>
          <Toggle value={Boolean(shadow)} onChange={(on) => set({ "text-shadow": on ? shadowCss({ color: "rgba(0, 0, 0, 0.6)", x: 0, y: Math.round(size / 20), blur: Math.round(size / 6) }) : "none" })} />
          {shadow && <ColorField label="Shadow" value={shadow.color} palette={palette} onStart={checkpoint} onChange={(c) => live({ "text-shadow": shadowCss({ ...shadow, color: c }) })} />}
        </div>
        {shadow && <>
          <Slider label="Blur" unit=" px" min={0} max={Math.max(80, Math.round(size / 2))} step={1} value={shadow.blur} display={Math.round}
            onStart={checkpoint} onChange={(v) => live({ "text-shadow": shadowCss({ ...shadow, blur: v }) })} />
          <Slider label="Distance" unit=" px" min={-40} max={60} step={1} value={shadow.y} display={Math.round}
            onStart={checkpoint} onChange={(v) => live({ "text-shadow": shadowCss({ ...shadow, y: v }) })} />
        </>}
        <div className="tp-line">
          <span className="tp-label">Box</span>
          <Toggle value={hasBox} onChange={(on) => set(on
            ? { "background-color": "rgba(0, 0, 0, 0.72)", "border-radius": `${Math.round(size / 10)}px`, "padding-top": `${Math.round(size / 12)}px`, "padding-bottom": `${Math.round(size / 12)}px`, "padding-left": `${Math.round(size / 6)}px`, "padding-right": `${Math.round(size / 6)}px` }
            : { "background-color": "transparent" })} />
          {hasBox && <ColorField label="Box" value={boxBg} palette={palette} onStart={checkpoint} onChange={(c) => live({ "background-color": c })} />}
        </div>
        {hasBox && (
          <Slider label="Corner radius" unit=" px" min={0} max={Math.max(60, Math.round(size / 2))} step={1} value={px(get("border-radius"), 0)} display={Math.round}
            onStart={checkpoint} onChange={(v) => live({ "border-radius": `${Math.round(v)}px` })} />
        )}
      </section>

      <ClipTransform m={m} scene={scene} clip={clip} time={time} title="Size & position" labels={{ scale: "Size" }} />
    </>
  );
}
