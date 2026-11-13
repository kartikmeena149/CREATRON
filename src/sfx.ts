// Free sound effects from Openverse (openverse.org): one search across Freesound, Wikimedia
// Commons, ccMixter and Jamendo. No key needed. Only licenses that allow commercial use and
// editing are asked for (CC0, CC BY, CC BY-SA, public domain), so a sound is safe in a monetized
// reel; CC BY ones need a credit, which is kept in work/sfx/CREDITS.md.
import { appendFileSync, createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ROOT, run } from "./tools.ts";
import type { EditPlan } from "./schema.ts";
import { resolveEarshot } from "./earshot.ts";

export type Sfx = {
  id: string;
  title: string;
  /** The sound file (an mp3 preview on Freesound), playable straight from the web. */
  url: string;
  duration: number; // seconds; 0 when the source doesn't say
  license: string; // "CC0", "CC BY 4.0"…
  creator: string;
  source: string; // "freesound", "wikimedia_audio"…
  page: string; // where the sound lives, for credit
  filetype: string;
  tags: string[];
};

const API = "https://api.openverse.org/v1/audio/";
const DIR = join(ROOT, "work", "sfx");

/** Searches for sound effects. `short` keeps it to sounds under 30 s. */
export async function searchSfx(query: string, page = 1, short = true): Promise<{ results: Sfx[]; more: boolean }> {
  const params = new URLSearchParams({ q: query.trim(), page: String(page), page_size: "20", license_type: "commercial,modification" });
  if (short) params.set("length", "shortest");
  const res = await fetch(`${API}?${params}`, { headers: { "User-Agent": "Creatron/0.1 (video editor)" } });
  if (res.status === 429) throw new Error("Openverse is busy (too many searches). Try again in a minute.");
  if (!res.ok) throw new Error(`Openverse search failed (${res.status}).`);
  const data = (await res.json()) as { page_count: number; results: any[] };
  return {
    more: page < data.page_count,
    results: data.results
      .filter((r) => r.url)
      .map((r) => ({
        id: r.id,
        title: r.title || "Untitled",
        url: r.url,
        duration: (r.duration ?? 0) / 1000,
        license: licenseName(r.license, r.license_version),
        creator: r.creator ?? "",
        source: r.source ?? "",
        page: r.foreign_landing_url ?? "",
        filetype: r.filetype || r.url.split("?")[0].split(".").pop() || "mp3",
        tags: (r.tags ?? []).map((t: { name: string }) => t.name).slice(0, 6),
      })),
  };
}

/** Downloads a sound to work/sfx (once) and notes its credit. Returns the file. */
export async function downloadSfx(s: Sfx): Promise<string> {
  mkdirSync(DIR, { recursive: true });
  const ext = /^(mp3|wav|ogg|flac|m4a|aac)$/i.test(s.filetype) ? s.filetype.toLowerCase() : "mp3";
  const file = join(DIR, `${slug(s.title)}-${s.id.slice(0, 8)}.${ext}`);
  if (existsSync(file)) return file;
  const res = await fetch(s.url);
  if (!res.ok || !res.body) throw new Error(`Couldn't download “${s.title}” (${res.status}).`);
  const part = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(part));
  renameSync(part, file);
  appendFileSync(join(DIR, "CREDITS.md"), `- “${s.title}” by ${s.creator || "unknown"} (${s.license}) ${s.page}\n`);
  return file;
}

function licenseName(license: string, version?: string) {
  if (license === "cc0") return "CC0";
  if (license === "pdm") return "Public domain";
  return `CC ${license.toUpperCase()}${version ? ` ${version}` : ""}`;
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "sfx";

/**
 * Sounds the agent asked for by description ("file": "sfx:soft whoosh" or "music:upbeat lo-fi beat"):
 * each is searched in Openverse, the best match no other entry uses is downloaded, and the entry gets
 * the real file and length. Ones with no match are left out (named in `missing`).
 */
export async function resolveSounds(
  plan: EditPlan,
  step: (id: string, what: string, done: boolean, found: boolean) => void,
): Promise<{ plan: EditPlan; missing: string[] }> {
  // Designed sounds from the earshot bank first (rendered to fit, their hit on the beat).
  const designed = await resolveEarshot(plan, step);
  plan = designed.plan;
  const asked = plan.voiceovers.flatMap((v, i) => {
    const m = /^(sfx|music):\s*(.+)$/.exec(v.file);
    return m ? [{ i, v, music: m[1] === "music", what: m[2].trim(), id: `${m[1]}-${i}-${m[2].trim()}` }] : [];
  });
  if (!asked.length) return { plan, missing: designed.missing };
  // All searches at once (the library is slow to answer), then each takes the best clip no other entry has.
  const results = await Promise.all(asked.map(async (a) => (step(a.id, a.what, false, false), searchLoosely(a.what, a.music))));
  const used = new Set<string>();
  const picks = asked.map((a, k) => {
    const found = results[k].filter((r) => !used.has(r.id));
    // Sound effects: the top match. Music: long enough to cover its span, or the longest there is.
    const pick = a.music ? (found.find((r) => r.duration >= Math.min(a.v.duration, 60)) ?? [...found].sort((x, y) => y.duration - x.duration)[0]) : found[0];
    if (pick) used.add(pick.id);
    return pick;
  });
  const files = await Promise.all(asked.map(async (a, k) => {
    const file = picks[k] && (await downloadSfx(picks[k]!).catch(() => undefined));
    step(a.id, a.what, true, Boolean(file));
    if (!file) return undefined;
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    return { file, length: Number(stdout.trim()) || picks[k]!.duration || a.v.duration, title: picks[k]!.title };
  }));
  const missing = [...designed.missing, ...asked.filter((_, k) => !files[k]).map((a) => a.what)];
  const byIndex = new Map(asked.map((a, k) => [a.i, { a, got: files[k] }]));
  const voiceovers = plan.voiceovers.flatMap((v, i) => {
    const r = byIndex.get(i);
    if (!r) return [v];
    if (!r.got) return [];
    const { file, length, title } = r.got;
    return [{ ...v, file, kind: r.a.music ? ("music" as const) : ("sfx" as const), text: v.text || title, length, duration: Math.min(v.duration, length - v.offset) }];
  });
  return { plan: { ...plan, voiceovers }, missing };
}

/**
 * The library only returns sounds matching every word, so a long description can find nothing:
 * try it whole, then shorter versions of it, then the plain kind of sound.
 */
async function searchLoosely(what: string, music: boolean): Promise<Sfx[]> {
  const words = what.toLowerCase().replace(/\b(music|sound|sfx|effect)\b/g, "").split(/\s+/).filter(Boolean);
  const tries = [
    what,
    music && words.length ? `${words.slice(-2).join(" ")} music` : words.slice(-2).join(" "),
    music && words.length ? `${words[0]} music` : words.at(-1) ?? "",
    music ? "background music" : "",
  ].filter((q, i, all) => q.trim() && all.indexOf(q) === i);
  for (const q of tries) {
    const r = await searchSfx(q, 1, !music).catch(() => ({ results: [] as Sfx[] }));
    if (r.results.length) return r.results;
  }
  return [];
}
