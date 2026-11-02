// Licensed stock B-roll: search Pexels (or Pixabay) by tag and download the chosen clip.
// Both libraries allow free use in commercial videos, unlike clips taken from YouTube or
// social media. Needs PEXELS_API_KEY (or PIXABAY_API_KEY) in .env; free at pexels.com/api.
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ROOT } from "./tools.ts";
import { downloadLink, findMoment } from "./youtube.ts";

export type Orientation = "portrait" | "landscape" | "square";

/** A clip the AI can choose. id is "pexels:123", "pixabay:456", "ytcc:<video id>" (Creative
 *  Commons YouTube, may be placed) or "yt:<video id>" (regular YouTube, suggestions only). */
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
  const todo = plan.broll.filter((b) => !b.file || !existsSync(b.file));
  let n = 0;
  const broll = [];
  const skipped: string[] = [];
  for (const b of plan.broll) {
    if (b.file && existsSync(b.file)) {
      broll.push(b);
      continue;
    }
    const clip = clips.get(b.source);
    if (!clip) continue; // unknown clip: leave it out rather than fail the whole edit
    if (clip.id.startsWith("ytcc:")) {
      const placed = await fetchCreativeCommons(b, clip, `${++n} of ${todo.length}`, log).catch((e) => {
        skipped.push(`${clip.description} (${e instanceof Error ? e.message.split("\n")[0] : e})`);
        return undefined;
      });
      if (placed) broll.push(placed);
      continue;
    }
    if (!clip.id.startsWith("pexels:") && !clip.id.startsWith("pixabay:")) continue; // never place anything else
    log(`downloading B-roll ${++n} of ${todo.length}`);
    const file = await downloadStock(clip);
    const provider = clip.id.startsWith("pexels:") ? "Pexels" : "Pixabay";
    broll.push({ ...b, file, length: clip.duration, credit: `${clip.author} on ${provider} (${clip.page})`, query: b.query ?? clip.description });
  }
  const notes = skipped.length ? `${plan.notes} (Left out ${skipped.length} YouTube clip${skipped.length > 1 ? "s" : ""}: ${skipped.join("; ")}.)` : plan.notes;
  return { ...plan, broll, notes: notes.trim() };
}

/** A Creative Commons YouTube clip: confirm the licence, find the right moment, download only that part. */
async function fetchCreativeCommons(b: Broll, clip: StockClip, which: string, log: (m: string) => void): Promise<Broll> {
  const need = b.query ?? clip.query ?? clip.description;
  log(`finding the right moment for B-roll ${which}`);
  const m = await findMoment(clip.page, need, b.duration, log);
  // The search filter is YouTube's; the video's own page is the final word on its licence.
  if (!m.info.cc) throw new Error("its page doesn't show a Creative Commons licence");
  if (m.score !== undefined && m.score < 4) throw new Error(`no part of it shows ${need}`);
  log(`downloading B-roll ${which}`);
  const file = await downloadLink(m.info.url, { id: m.info.id, site: "youtube", start: m.start, end: m.end, dir: join(ROOT, "work", "broll") });
  const length = m.end - m.start;
  const at = Math.floor(m.start);
  return {
    ...b,
    file,
    offset: 0,
    length,
    duration: Math.min(b.duration, length),
    query: need,
    credit: `${m.info.title} by ${m.info.channel} (YouTube, CC BY) https://youtu.be/${m.info.id}?t=${at}`,
  };
}
