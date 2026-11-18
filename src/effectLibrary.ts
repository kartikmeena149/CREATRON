// Creatro's effects library on disk: the effects taken out of imported Claude edits (flashes,
// blinds, shading, film texture), each a preset its own layers draw. Kept in work/effects next to
// the font library, local like everything else. Importing an edit adds what it has that the
// library doesn't (the same effect from two edits is kept once).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type EffectPreset, sceneEffects } from "./sceneEffects.ts";
import type { Scene } from "./scene.ts";
import { ROOT } from "./tools.ts";

export const effectsDir = () => join(ROOT, "work", "effects");
const listFile = () => join(effectsDir(), "effects.json");

export function libraryEffects(): EffectPreset[] {
  try {
    const list = JSON.parse(readFileSync(listFile(), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Adds a scene's effects to the library. Returns the ones that were new. */
export function addEffectsFrom(scene: Scene): EffectPreset[] {
  const have = libraryEffects();
  const ids = new Set(have.map((p) => p.id));
  const fresh = sceneEffects(scene).filter((p) => !ids.has(p.id));
  if (!fresh.length) return [];
  // Names stay apart: a second Blinds is "Blinds 2".
  const named = fresh.map((p) => {
    const taken = [...have, ...fresh.slice(0, fresh.indexOf(p))].filter((x) => x.name === p.name || x.name.startsWith(`${p.name} `)).length;
    return taken ? { ...p, name: `${p.name} ${taken + 1}` } : p;
  });
  mkdirSync(effectsDir(), { recursive: true });
  const tmp = `${listFile()}.part`; // a half-written library never replaces a whole one
  writeFileSync(tmp, JSON.stringify([...have, ...named]));
  renameSync(tmp, listFile());
  return named;
}

export const hasEffectLibrary = () => existsSync(listFile());
