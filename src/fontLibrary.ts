// Creatro's own font library: fonts that came in with Claude edits (or anything else that brings
// a font Creatro didn't have) are kept here for good, in work/fonts/ with fonts.json listing them.
// From then on they're Creatro fonts like the bundled ones: in the font lists, in the preview,
// the animated layer and the export.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFontFace } from "./scene.ts";
import { ROOT } from "./tools.ts";

export type LibraryFont = { family: string; weight: string; style: string; unicodeRange?: string; file: string };

export const fontsDir = () => join(ROOT, "work", "fonts");
const listFile = () => join(fontsDir(), "fonts.json");

export function libraryFonts(): LibraryFont[] {
  try {
    return (JSON.parse(readFileSync(listFile(), "utf8")) as LibraryFont[]).filter((f) => existsSync(f.file));
  } catch {
    return [];
  }
}

/**
 * Keeps the fonts of an edit's @font-face rules (files relative to `dir`) in the library, each
 * face once. Returns the families it holds now that it didn't before.
 */
export function addFonts(rules: string[], dir: string): string[] {
  const list = libraryFonts();
  const had = new Set(list.map((f) => f.family));
  const key = (f: Omit<LibraryFont, "file">) => `${f.family}|${f.weight}|${f.style}|${f.unicodeRange ?? ""}`;
  const known = new Set(list.map(key));
  for (const rule of rules) {
    const face = parseFontFace(rule);
    if (!face || /^[a-z]+:/i.test(face.src) || !existsSync(join(dir, face.src))) continue;
    const { src, ...desc } = face;
    if (known.has(key(desc))) continue;
    const folder = join(fontsDir(), face.family.replace(/[^A-Za-z0-9]+/g, "-"));
    mkdirSync(folder, { recursive: true });
    const file = join(folder, basename(src));
    if (!existsSync(file)) copyFileSync(join(dir, src), file);
    list.push({ ...desc, file });
    known.add(key(desc));
  }
  mkdirSync(fontsDir(), { recursive: true });
  writeFileSync(listFile(), JSON.stringify(list, null, 1));
  return [...new Set(list.map((f) => f.family))].filter((f) => !had.has(f));
}
