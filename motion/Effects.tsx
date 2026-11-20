// Effects: looks and moments laid over the picture (a flash, a blinds wipe, shading, film grain…),
// like an editor's effects library. Each one is drawn from the time into it alone, so the app's
// preview, the effect tiles and the export (all through this file) show exactly the same frames.
// Several come from Claude edits (flash, blinds, shade); the others are made in the same style.
import type React from "react";
import { type EffectPreset, presetScene } from "../src/sceneEffects.ts";
import { SceneView } from "./Scene.tsx";

export type EffectCategory = "transition" | "light" | "texture" | "frame";
export type EffectDef = {
  id: string;
  name: string;
  category: EffectCategory;
  /** Seconds it runs when added. */
  duration: number;
  /** Its colour can be changed (the default when it has one). */
  color?: string;
  /** What it does, one line. */
  about: string;
};

export const EFFECTS: EffectDef[] = [
  { id: "flash", name: "Flash", category: "transition", duration: 0.4, color: "#ffffff", about: "A bright flash that fades out: a hard cut that hits" },
  { id: "dip", name: "Dip to black", category: "transition", duration: 0.6, color: "#000000", about: "Fades down to a colour and back up" },
  { id: "blinds", name: "Blinds", category: "transition", duration: 0.5, color: "#000000", about: "Stripes that open to reveal the picture" },
  { id: "shade", name: "Shade", category: "light", duration: 3, about: "Darkens the top and bottom so text reads" },
  { id: "vignette", name: "Vignette", category: "light", duration: 3, about: "Darker edges that pull the eye to the middle" },
  { id: "leak", name: "Light leak", category: "light", duration: 2, color: "#ff8a3d", about: "A warm glow drifting across the frame" },
  { id: "grain", name: "Film grain", category: "texture", duration: 3, about: "Moving grain, like film" },
  { id: "scanlines", name: "Scanlines", category: "texture", duration: 3, about: "Screen lines that slowly roll" },
  { id: "letterbox", name: "Letterbox", category: "frame", duration: 3, color: "#000000", about: "Cinema bars that slide in" },
];
/** Effects from the library (taken out of Claude edits), known to the app once it has loaded them. */
const presets = new Map<string, EffectPreset>();
export function registerPresets(list: EffectPreset[]) {
  presets.clear();
  for (const p of list) presets.set(p.id, p);
}
export const libraryPresets = () => [...presets.values()];

export const effectDef = (id: string | undefined): EffectDef | undefined => {
  const p = id?.startsWith("lib:") ? presets.get(id) : undefined;
  if (p) return { id: p.id, name: p.name, category: p.category, duration: p.duration, about: `From your Claude edit “${p.source}”` };
  return EFFECTS.find((e) => e.id === id);
};
export const CATEGORY_NAME: Record<EffectCategory, string> = { transition: "Transitions", light: "Light", texture: "Texture", frame: "Frame" };

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = (u: number) => 1 - (1 - u) ** 3;
const easeInOut = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);
/** "#rrggbb" + alpha → rgba(). */
function rgba(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamp(a)})`;
}

/**
 * One effect at `t` seconds into it (of `duration`), over a W×H frame. `intensity` 0..1+ scales
 * how strong it is; `seed` keeps random-looking ones (grain) the same on every render.
 */
export function EffectFrame({ effect, t, duration, color, intensity = 1, W, H, seed = 0, preset }: {
  effect: string; t: number; duration: number; color?: string; intensity?: number; W: number; H: number; seed?: number;
  /** A library effect's own layers (the export passes them in; the app knows them already). */
  preset?: EffectPreset;
}) {
  // A library effect: its layers, drawn as the edit drew them, played to fit the time it's given.
  if (effect.startsWith("lib:")) {
    const p = preset ?? presets.get(effect);
    if (!p) return null;
    // A look loops over its recorded run; a transition plays at the speed it was made, fitted to its length.
    const local = p.category === "transition" ? Math.min(p.duration, (t / Math.max(0.05, duration)) * p.duration) : t % Math.max(0.1, p.duration);
    return (
      <div style={{ position: "absolute", inset: 0, opacity: Math.max(0, Math.min(1, intensity)), pointerEvents: "none" }}>
        <SceneView scene={presetScene(p)} t={local} url={(f) => f} video={() => null} width={W} height={H} />
      </div>
    );
  }
  const def = effectDef(effect);
  if (!def) return null;
  const c = color || def.color || "#000000";
  const u = clamp(t / Math.max(0.05, duration));
  const k = clamp(intensity, 0, 2);
  const fill: React.CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };
  switch (effect) {
    case "flash":
      // Full at the cut, gone quickly: most of the light leaves in the first third.
      return <div style={{ ...fill, background: c, opacity: clamp(0.9 * k * (1 - easeOut(u))) }} />;
    case "dip":
      return <div style={{ ...fill, background: c, opacity: clamp(k * Math.sin(Math.PI * u)) }} />;
    case "blinds": {
      const n = 12;
      return (
        <div style={fill}>
          {Array.from({ length: n }, (_, i) => {
            // Each stripe closes a little after the one above it.
            const local = clamp((u - (i / n) * 0.35) / 0.65);
            return <div key={i} style={{ position: "absolute", left: 0, right: 0, top: `${(i / n) * 100}%`, height: `${100 / n + 0.2}%`, background: c, opacity: clamp(k), transform: `scaleY(${1 - easeOut(local)})`, transformOrigin: "50% 0%" }} />;
          })}
        </div>
      );
    }
    case "shade":
      return <div style={{ ...fill, background: `linear-gradient(rgba(0,0,0,${0.35 * k}), rgba(0,0,0,0) 25%, rgba(0,0,0,0) 50%, rgba(0,0,0,${0.82 * k}))` }} />;
    case "vignette":
      return <div style={{ ...fill, background: `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,${0.75 * k}) 100%)` }} />;
    case "leak": {
      // A warm glow drifting across, brightest in the middle of the effect.
      const x = -20 + 140 * easeInOut(u);
      const a = clamp(Math.sin(Math.PI * u) * 0.75 * k);
      return (
        <div style={{ ...fill, opacity: a, background: `radial-gradient(60% 45% at ${x}% 30%, ${rgba(c, 0.9)}, ${rgba(c, 0)} 70%), radial-gradient(40% 35% at ${x + 25}% 75%, ${rgba("#ffd27a", 0.6)}, rgba(0,0,0,0) 70%)` }} />
      );
    }
    case "grain": {
      // A new grain pattern every frame (by time, so every render draws the same one).
      const frame = Math.floor(t * 24) + seed;
      return (
        <svg style={{ ...fill, width: "100%", height: "100%", opacity: clamp(0.22 * k), mixBlendMode: "normal" }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <filter id={`grain-${seed}`}><feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} seed={frame % 997} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
          <rect width={W} height={H} filter={`url(#grain-${seed})`} />
        </svg>
      );
    }
    case "scanlines": {
      const line = Math.max(2, Math.round(H / 320));
      const roll = (t * H * 0.04) % (line * 2);
      return <div style={{ ...fill, opacity: clamp(0.35 * k), background: `repeating-linear-gradient(0deg, rgba(0,0,0,0.55) 0 ${line}px, rgba(0,0,0,0) ${line}px ${line * 2}px)`, backgroundPosition: `0 ${roll}px` }} />;
    }
    case "letterbox": {
      // Slides in over its first 0.4 s, holds, slides out over its last 0.4 s.
      const inn = clamp(t / 0.4), out = clamp((duration - t) / 0.4);
      const h = 12 * k * easeOut(Math.min(inn, out));
      return (
        <div style={fill}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: `${h}%`, background: c }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${h}%`, background: c }} />
        </div>
      );
    }
  }
  return null;
}

export { cutEffectStart } from "../src/effectTiming.ts";
