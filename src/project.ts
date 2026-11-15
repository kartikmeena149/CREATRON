// An open, editable video project: the only shape the AI's work is allowed to take.
//
//   <project>/
//     source/    the original recording, never modified
//     assets/    broll/ audio/ sfx/ cutouts/  (each thing a separate file)
//     project/   the editable video: timeline.json (cuts, captions, music, colours as plain
//                values) + src/ (Remotion layers), or index.html (HyperFrames)
//     Export/    <Name>.mp4, versions/, Thumbnails/<Name>/
//     notes/     transcript, brief, check frames (working files)
//     README.md  "how to edit this" + the one render command;  render.command runs it
//
// Auto Edit starts every job from this scaffold (autoedit.ts) and `creatron project new` makes
// one by hand. `validateProject` is the rule in code: it lists everything that would make the
// result less editable, and Auto Edit sends that list back to the AI until it is empty.
import { chmodSync, cpSync, existsSync, linkSync, copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type { Analysis, Word } from "./schema.ts";
import { ROOT, round } from "./tools.ts";

export type Cut = { start: number; end: number };
export type Caption = { text: string; start: number; end: number; accent?: string };
export type ProjectTimeline = {
  name: string;
  width: number;
  height: number;
  fps: number;
  source: string;
  hasVideo: boolean;
  cuts: Cut[];
  captions: Caption[];
  music: { file: string; volume: number } | null;
  sfx: { file: string; volume: number; at: number }[];
  cutout?: { file: string; ranges: [number, number, number][] } | null;
  colors: Record<string, string>;
  captionStyle: { font: string; size: number; bottom: number; uppercase: boolean; outline: number };
};

export const ASSET_FOLDERS = ["broll", "audio", "sfx", "cutouts"];

/** Where things are in a project folder. */
export const projectPaths = (dir: string) => ({
  timeline: join(dir, "project", "timeline.json"),
  entry: join(dir, "project", "src", "index.ts"),
  html: join(dir, "project", "index.html"),
  public: join(dir, "project", "public"),
  notes: join(dir, "notes"),
  checks: join(dir, "notes", "checks"),
  exports: join(dir, "Export"),
  versions: join(dir, "Export", "versions"),
  internal: join(dir, ".creatron"),
  facts: join(dir, ".creatron", "project.json"),
});

export const readTimeline = (dir: string): ProjectTimeline => JSON.parse(readFileSync(projectPaths(dir).timeline, "utf8"));
export const writeTimeline = (dir: string, t: ProjectTimeline) => writeFileSync(projectPaths(dir).timeline, `${formatTimeline(t)}\n`);
/** The finished video of a project: Export/<Name>.mp4. */
export const finalFile = (dir: string, name = readTimeline(dir).name) => join(dir, "Export", `${name}.mp4`);

/** A name that is safe as a file and folder name. */
export const projectName = (s: string) => basename(s, extname(s)).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "Video";

/** timeline.json written for people: one cut and one caption per line. */
export function formatTimeline(t: ProjectTimeline): string {
  const row = (x: object) => `{ ${Object.entries(x).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
  const rows = (list: object[]) => (list.length ? `[\n${list.map((x) => `    ${row(x)}`).join(",\n")}\n  ]` : "[]");
  const { cuts, captions, sfx, ...rest } = t;
  const head = JSON.stringify(rest, null, 2).slice(0, -2);
  return `${head},\n  "cuts": ${rows(cuts)},\n  "captions": ${rows(captions)},\n  "sfx": ${rows(sfx)}\n}`;
}

/**
 * Caption pages from the transcript, timed to the SOURCE: 1-3 words each, a new page at every
 * sentence end, comma, or pause. Only words inside the cuts are used (all words when no cuts given).
 */
export function captionPages(words: Word[], cuts?: Cut[]): Caption[] {
  const kept = cuts ? words.filter((w) => cuts.some((c) => (w.start + w.end) / 2 >= c.start && (w.start + w.end) / 2 < c.end)) : words;
  const cutOf = (w: Word) => (cuts ? cuts.findIndex((c) => (w.start + w.end) / 2 >= c.start && (w.start + w.end) / 2 < c.end) : 0);
  const pages: Caption[] = [];
  let page: Word[] = [];
  const flush = () => {
    if (page.length) pages.push({ text: page.map((w) => w.text).join(" "), start: round(page[0].start, 2), end: round(page.at(-1)!.end, 2) });
    page = [];
  };
  for (const w of kept) {
    const prev = page.at(-1);
    if (prev && (w.start - prev.end > 0.35 || cutOf(w) !== cutOf(prev) || page.length >= 3)) flush();
    page.push(w);
    if (/[.!?,;:]$/.test(w.text)) flush();
  }
  flush();
  return pages;
}

function link(from: string, to: string) {
  try {
    linkSync(from, to); // same disk: instant, no extra space, and the original stays the original
  } catch {
    copyFileSync(from, to);
  }
}

/**
 * Makes the project folder: the layout, the source (linked, not changed), a timeline.json that
 * already plays the whole recording with captions from the transcript, the starter layers, the
 * README and the render command. It renders as it is; everything after this is editing.
 */
export function scaffoldProject(dir: string, opts: { name: string; video: string; analysis: Analysis; width?: number; height?: number }): ProjectTimeline {
  const p = projectPaths(dir);
  const { analysis } = opts;
  for (const d of ["source", ...ASSET_FOLDERS.map((a) => join("assets", a)), join("project", "public"), join("Export", "versions"), join("Export", "Thumbnails", opts.name), join("notes", "checks"), ".creatron"])
    mkdirSync(join(dir, d), { recursive: true });
  const media = join(dir, "source", `${projectName(opts.video)}${extname(opts.video).toLowerCase()}`);
  if (!existsSync(media)) link(opts.video, media);
  // Remotion plays files from one public folder: it is two links, so source/ and assets/ stay where they are.
  for (const d of ["source", "assets"]) if (!existsSync(join(p.public, d))) symlinkSync(join("..", "..", d), join(p.public, d));

  const hasVideo = analysis.width > 0;
  const timeline: ProjectTimeline = {
    name: opts.name,
    width: opts.width ?? 1080,
    height: opts.height ?? 1920,
    fps: 30,
    source: relative(dir, media),
    hasVideo,
    music: null,
    colors: { background: "#0b0d12", caption: "#ffffff", captionOutline: "#000000", accent: "#ffd60a" },
    captionStyle: { font: "Helvetica Neue", size: 78, bottom: 620, uppercase: true, outline: 10 },
    cuts: [{ start: 0, end: round(analysis.duration, 3) }],
    captions: captionPages(analysis.words),
    sfx: [],
  };
  writeTimeline(dir, timeline);
  cpSync(join(ROOT, "templates", "project", "src"), join(dir, "project", "src"), { recursive: true });
  const remotion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies.remotion;
  writeFileSync(join(dir, "project", "package.json"), `${JSON.stringify({ name: opts.name.toLowerCase(), private: true, dependencies: { remotion, react: "*" } }, null, 2)}\n`);
  writeFileSync(join(dir, "project", "tsconfig.json"), `${JSON.stringify({ compilerOptions: { jsx: "react-jsx", module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, strict: true, skipLibCheck: true, noEmit: true } }, null, 2)}\n`);

  const renderCommand = `node "${join(ROOT, "src", "cli.ts")}" project render "${dir}"`;
  writeFileSync(join(dir, "README.md"), readFileSync(join(ROOT, "templates", "project", "README.md"), "utf8").replaceAll("__NAME__", opts.name).replaceAll("__RENDER__", renderCommand));
  const command = join(dir, "render.command");
  writeFileSync(command, `#!/bin/bash\n# Re-export this video. Double-click, or run it in Terminal.\ncd "$(dirname "$0")"\nexec node "${join(ROOT, "src", "cli.ts")}" project render "$PWD"\n`);
  chmodSync(command, 0o755);
  const st = statSync(media);
  writeFileSync(p.facts, JSON.stringify({ original: analysis.source, sourceBytes: st.size, duration: analysis.duration, madeAt: new Date().toISOString() }, null, 1));
  writeFileSync(join(p.notes, "transcript.json"), JSON.stringify({ note: "SOURCE seconds", words: analysis.words, pauses: analysis.silences }, null, 1));
  return timeline;
}

/** Every code file of the project's layers. */
function codeFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/\.(tsx?|jsx?|html|css)$/.test(e.name)) out.push(join(d, e.name));
    }
  };
  walk(join(dir, "project", "src"));
  if (existsSync(projectPaths(dir).html)) out.push(projectPaths(dir).html);
  return out;
}

/**
 * The editable-output rule, checked. Returns what breaks it, in plain sentences; an empty list
 * means: local, open, hand-editable, re-exportable with one command.
 */
export function validateProject(dir: string, opts: { needExport?: boolean } = {}): string[] {
  const p = projectPaths(dir);
  const problems: string[] = [];
  let t: ProjectTimeline;
  try {
    t = readTimeline(dir);
  } catch (e) {
    return [`project/timeline.json is missing or isn't valid JSON (${e instanceof Error ? e.message : e}). It must hold the cuts, captions, music and colours as plain values.`];
  }
  const facts = existsSync(p.facts) ? (JSON.parse(readFileSync(p.facts, "utf8")) as { sourceBytes: number; duration: number }) : undefined;

  // The source is still the source.
  const source = join(dir, t.source ?? "");
  if (!t.source || !existsSync(source)) problems.push(`The original recording (${t.source}) is missing from source/.`);
  else if (facts && statSync(source).size !== facts.sourceBytes) problems.push(`source/${basename(source)} was changed. The original must stay untouched: restore it and make changes on the timeline instead.`);

  // Cuts are readable values, on the source.
  if (!Array.isArray(t.cuts) || !t.cuts.length) problems.push('timeline.json has no "cuts". Every kept part of the recording must be listed there (start and end in source seconds).');
  else
    t.cuts.forEach((c, i) => {
      if (!(c.end > c.start) || c.start < 0) problems.push(`Cut ${i + 1} in timeline.json isn't valid (start ${c.start}, end ${c.end}).`);
      else if (facts && c.end > facts.duration + 0.25) problems.push(`Cut ${i + 1} ends at ${c.end} s but the recording is only ${round(facts.duration, 2)} s long.`);
    });
  for (const f of readdirSync(join(dir, "assets"), { recursive: true, encoding: "utf8" }).concat(existsSync(p.public) ? readdirSync(p.public, { encoding: "utf8" }) : []))
    if (/(^|\/)(pre)?cut\.(mp4|mov|m4a)$/i.test(f)) problems.push(`${f} looks like a pre-cut copy of the recording. Don't bake cuts into a file: play the source through timeline.json's cuts (the Footage component).`);

  // Captions are live text.
  const transcript = join(p.notes, "transcript.json");
  const spoken = existsSync(transcript) ? ((JSON.parse(readFileSync(transcript, "utf8")).words as Word[]) ?? []).length : 0;
  if (!Array.isArray(t.captions)) problems.push('timeline.json has no "captions" list.');
  else if (t.captions.some((c) => typeof c.text !== "string" || !(c.end > c.start))) problems.push("A caption in timeline.json has no text or a wrong start/end.");

  // The layers read their values from timeline.json, and everything they play is a local file in source/ or assets/.
  const files = codeFiles(dir);
  const code = files.map((f) => readFileSync(f, "utf8"));
  const all = code.join("\n");
  if (existsSync(p.entry)) {
    if (!/creatron\/timeline|timeline\.json/.test(all)) problems.push("The video's code never reads project/timeline.json. Cuts, captions, music and colours must come from it, not be written into the code.");
    const own = files.filter((f) => !f.includes(`${join("src", "creatron")}/`)).map((f) => readFileSync(f, "utf8")).join("\n");
    if (spoken > 0 && Array.isArray(t.captions) && t.captions.length > 0 && !/\bcaptions\b/.test(own))
      problems.push("Captions exist in timeline.json but no layer shows them. Draw captions from the `captions` list (live text), never as a picture or burned into a video.");
  } else if (!existsSync(p.html)) problems.push("There is no editable video yet: project/src/index.ts (Remotion) or project/index.html (HyperFrames).");
  files.forEach((f, i) => {
    const rel = relative(dir, f);
    for (const m of code[i].matchAll(/staticFile\(\s*["'`]([^"'`$]+)["'`]\s*\)/g))
      if (!existsSync(join(dir, m[1]))) problems.push(`${rel} plays "${m[1]}", which doesn't exist. Media paths start with source/ or assets/.`);
    if (/["'`](\/Users\/|\/private\/|\/tmp\/|file:\/\/)/.test(code[i])) problems.push(`${rel} uses an absolute path on this Mac. Use paths relative to the project (source/..., assets/...).`);
    if (/["'`]https?:\/\/[^"'`\s]+\.(mp4|mov|webm|mp3|m4a|wav|png|jpe?g|gif|webp|woff2?|ttf|otf)\b/i.test(code[i])) problems.push(`${rel} loads media from the internet. Download it into assets/ and use the local file.`);
  });
  for (const key of ["music"] as const) if (t[key] && !existsSync(join(dir, t[key]!.file))) problems.push(`timeline.json's ${key} file (${t[key]!.file}) doesn't exist.`);
  for (const s of t.sfx ?? []) if (!existsSync(join(dir, s.file))) problems.push(`timeline.json's sound effect ${s.file} doesn't exist.`);

  // A person can find their way and re-export alone.
  if (!existsSync(join(dir, "README.md")) || !/How to edit/i.test(readFileSync(join(dir, "README.md"), "utf8"))) problems.push('README.md must keep its "How to edit this" section (where captions, cuts, music and colours live).');
  if (!existsSync(join(dir, "render.command"))) problems.push("render.command (the one command that re-exports the video) is missing.");
  if (opts.needExport && !existsSync(finalFile(dir, t.name))) problems.push(`The finished video isn't in Export/${t.name}.mp4 yet: run the render command.`);
  return problems;
}

/**
 * The tool-belt commands that need what an AI job's sandbox blocks (headless Chrome, the Vision
 * helper). In a job they run in the app (autoedit-broll.ts), asked for by the tool belt.
 */
export const APP_COMMANDS = ["render", "still", "cutout"];
/** The last line the app sends back for a command it ran for the tool belt: its exit code. */
export const EXIT_MARK = "\u0000creatro-exit ";
