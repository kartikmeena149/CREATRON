// Licensed stock B-roll: search Pexels (or Pixabay) by tag and download the chosen clip.
// Both libraries allow free use in commercial videos, unlike clips taken from YouTube or
// social media. Needs PEXELS_API_KEY (or PIXABAY_API_KEY) in .env; free at pexels.com/api.
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ROOT } from "./tools.ts";
import { downloadLink, findMoment } from "./webvideo.ts";

export type Orientation = "portrait" | "landscape" | "square";

/** A clip the AI can choose. id is "pexels:123", "pixabay:456" or "web:<site>:<id>" (any video
 *  on the web, found by searchWeb; the app finds the right moment and downloads only that). */
export type StockClip = {
  id: string;
  description: string;
  duration: number;
  width: number; // 0 when unknown (YouTube search doesn't say)
  height: number;
  author: string;
  page: string; // where the clip lives, for credit
  download: string; // best file under 1080p for the frame shape (YouTube: the watch page)
  thumbnail?: string;
  /** Set when the source says the clip is free to reuse ("CC BY", "CC0", "Public domain"…). */
  license?: string;
  /** The words the AI searched with: what this clip should show. */
  query?: string;
};

export const stockAvailable = () => Boolean(process.env.PEXELS_API_KEY || process.env.PIXABAY_API_KEY);

/** Searches the library for clips matching a few words. Best matches first. */
export async function searchStock(query: string, orientation: Orientation, minDuration = 3): Promise<StockClip[]> {
  const provider = process.env.PEXELS_API_KEY ? "pexels" : process.env.PIXABAY_API_KEY ? "pixabay" : undefined;
  if (!provider) throw new Error("B-roll needs a free stock video key: add PIXABAY_API_KEY to CREATRON/.env (pixabay.com/api/docs).");
  // Both libraries ask apps to cache results for 24 hours instead of repeating the same search.
  return cached(`${provider}|${query.trim().toLowerCase()}|${orientation}|${minDuration}`, () =>
    provider === "pexels" ? searchPexels(query, orientation, minDuration) : searchPixabay(query, orientation, minDuration),
  );
}

const DAY = 24 * 3600_000;
const CACHE = join(ROOT, "work", "stock-search-cache.json");

/** Search results kept on disk for a day, so the same search doesn't hit the library again. */
export async function cached(key: string, search: () => Promise<StockClip[]>): Promise<StockClip[]> {
  const cache = readCache();
  const hit = cache[key];
  if (hit && Date.now() - hit.at < DAY) return hit.clips;
  const clips = await search();
  const fresh = readCache(); // another search may have finished meanwhile
  for (const [k, v] of Object.entries(fresh)) if (Date.now() - v.at >= DAY) delete fresh[k];
  fresh[key] = { at: Date.now(), clips };
  writeFileSync(CACHE, JSON.stringify(fresh));
  return clips;
}

function readCache(): Record<string, { at: number; clips: StockClip[] }> {
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"));
  } catch {
    mkdirSync(join(ROOT, "work"), { recursive: true });
    return {};
  }
}

async function searchPexels(query: string, orientation: Orientation, minDuration: number): Promise<StockClip[]> {
  const url = new URL("https://api.pexels.com/videos/search");
  url.search = new URLSearchParams({ query, orientation, per_page: "12", size: "medium" }).toString();
  const res = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY! } });
  if (!res.ok) throw new Error(`Pexels search failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  return (data.videos as any[])
    .filter((v) => v.duration >= minDuration)
    .map((v) => {
      const file = bestFile(
        (v.video_files as any[]).filter((f) => f.file_type === "video/mp4").map((f) => ({ url: f.link, width: f.width, height: f.height })),
      );
      return file && {
        id: `pexels:${v.id}`,
        // Pexels has no captions; the page slug describes the clip ("woman-watering-plants-123").
        description: String(v.url).split("/").filter(Boolean).pop()!.replace(/-\d+$/, "").replace(/-/g, " "),
        duration: v.duration,
        width: file.width,
        height: file.height,
        author: v.user?.name ?? "Pexels",
        page: v.url,
        download: file.url,
      };
    })
    .filter((c): c is StockClip => Boolean(c));
}

async function searchPixabay(query: string, orientation: Orientation, minDuration: number): Promise<StockClip[]> {
  const url = new URL("https://pixabay.com/api/videos/");
  url.search = new URLSearchParams({ key: process.env.PIXABAY_API_KEY!, q: query, per_page: "12", safesearch: "true" }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay search failed (${res.status})`);
  const data = (await res.json()) as any;
  const wantPortrait = orientation === "portrait";
  return (data.hits as any[])
    .filter((h) => h.duration >= minDuration)
    .map((h) => {
      const file = bestFile(Object.values(h.videos as Record<string, any>).map((f) => ({ url: f.url, width: f.width, height: f.height })));
      return file && {
        id: `pixabay:${h.id}`,
        description: String(h.tags),
        duration: h.duration,
        width: file.width,
        height: file.height,
        author: h.user ?? "Pixabay",
        page: h.pageURL,
        download: file.url,
      };
    })
    .filter((c): c is StockClip => Boolean(c))
    // Pixabay can't filter by shape, so put clips of the right shape first.
    .sort((a, b) => Number((b.height > b.width) === wantPortrait) - Number((a.height > a.width) === wantPortrait));
}

/** The largest file whose long side is at most 1920 px (enough for 1080p, quick to download). */
function bestFile(files: { url: string; width: number; height: number }[]) {
  const ok = files.filter((f) => f.url && f.width && f.height && Math.max(f.width, f.height) <= 1920);
  return (ok.length ? ok : files).sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

/** Downloads a clip once into work/broll and returns the local path (cached by clip id). */
export async function downloadStock(clip: Pick<StockClip, "id" | "download">): Promise<string> {
  const dir = join(ROOT, "work", "broll");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${clip.id.replace(":", "-")}.mp4`);
  if (existsSync(file)) return file;
  const res = await fetch(clip.download);
  if (!res.ok || !res.body) throw new Error(`download failed for ${clip.id} (${res.status})`);
  const part = `${file}.part`; // a half-finished download never looks like a finished one
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(part));
  renameSync(part, file);
  return file;
}

/** Downloads every B-roll clip the plan uses that isn't on disk yet, and records its file and credit. */
type Broll = import("./schema.ts").Broll;

export async function fetchBroll(
  plan: import("./schema.ts").EditPlan,
  clips: Map<string, StockClip>,
  log: (m: string) => void = () => {},
): Promise<import("./schema.ts").EditPlan> {
  const todo = plan.broll.filter((b) => !b.file || !existsSync(b.file)).length;
  let n = 0;
  const skipped: string[] = [];
  const used = new Set(plan.broll.map((b) => b.source));
  // Web clips take a while (find the moment, look at frames), so up to 3 are fetched at once.
  const broll = await mapLimit(plan.broll, 3, async (b): Promise<Broll | undefined> => {
    if (b.file && existsSync(b.file)) return b;
    const clip = clips.get(b.source);
    if (!clip) return undefined; // unknown clip: leave it out rather than fail the whole edit
    const which = `${++n} of ${todo}`;
    if (clip.id.startsWith("web:")) {
      const placed = await fetchWebClip(b, clip, clips, used, which, log);
      if (!placed) skipped.push(b.query ?? clip.query ?? clip.description);
      return placed;
    }
    log(`downloading B-roll ${which}`);
    const file = await downloadStock(clip);
    const provider = clip.id.startsWith("pexels:") ? "Pexels" : "Pixabay";
    return { ...b, file, length: clip.duration, credit: `${clip.author} on ${provider} (${clip.page})`, query: b.query ?? clip.description };
  });
  const notes = skipped.length
    ? `${plan.notes} (Couldn't find a web clip that really shows: ${skipped.join("; ")}, so I left ${skipped.length > 1 ? "those" : "it"} out.)`
    : plan.notes;
  return { ...plan, broll: broll.filter((b): b is Broll => Boolean(b)), notes: notes.trim() };
}

const SITES: Record<string, string> = { youtube: "YouTube", commons: "Wikimedia Commons", dailymotion: "Dailymotion", vimeo: "Vimeo" };

/**
 * A clip from the web: find the right few seconds inside it and check its frames. If the frames
 * don't show what's needed, try the next results of the same search (up to 3 videos in all).
 */
async function fetchWebClip(
  b: Broll,
  first: StockClip,
  clips: Map<string, StockClip>,
  used: Set<string>,
  which: string,
  log: (m: string) => void,
): Promise<Broll | undefined> {
  const need = b.query ?? first.query ?? first.description;
  const others = [...clips.values()].filter((c) => c.id.startsWith("web:") && c.query === first.query && c.id !== first.id);
  let tries = 0;
  for (const clip of [first, ...others]) {
    if (clip !== first && used.has(clip.id)) continue; // another B-roll already uses it
    if (++tries > 3) break;
    used.add(clip.id);
    try {
      log(`finding the right moment for B-roll ${which}`);
      const m = await findMoment(clip.download, need, b.duration, log);
      // Only what the vision model actually saw goes in: a title alone can promise anything.
      if (m.score === undefined || m.score < 5) {
        log(`"${clip.description.slice(0, 40)}" ${m.score === undefined ? "couldn't be checked" : `doesn't show ${need}`}; trying another video`);
        continue;
      }
      log(`downloading B-roll ${which}`);
      const site = clip.id.split(":")[1];
      const file = await downloadLink(clip.download, { id: m.info.id, site, start: m.start, end: m.end, dir: join(ROOT, "work", "broll") });
      const length = m.end - m.start;
      const licence = clip.license ?? (m.info.cc ? "CC BY" : undefined);
      const link = site === "youtube" ? `https://youtu.be/${m.info.id}?t=${Math.floor(m.start)}` : clip.page;
      return {
        ...b,
        source: clip.id,
        file,
        offset: 0,
        length,
        duration: Math.min(b.duration, length),
        query: need,
        credit: `${clip.description} by ${clip.author} (${SITES[site] ?? site}${licence ? `, ${licence}` : ""}) ${link}`,
      };
    } catch (e) {
      log(`skipping "${clip.description.slice(0, 40)}": ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  }
  return undefined;
}

/** Runs fn over items, at most `limit` at a time, keeping the order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
