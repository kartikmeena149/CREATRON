// Online video through yt-dlp: look up any link (YouTube, Instagram, X, Vimeo…), search YouTube
// (Creative Commons only, or everything), find the moment inside a video that shows what the
// B-roll needs, and download just that part. Needs yt-dlp (brew install yt-dlp).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cached, type StockClip } from "./stock.ts";
import { ROOT, round, run } from "./tools.ts";

const VISION_MODEL = process.env.CREATRON_VISION_MODEL || "nvidia/nemotron-3.5-super-vl:free";

let available: boolean | undefined;
export const ytdlpAvailable = () => (available ??= spawnSync("yt-dlp", ["--version"]).status === 0);

/** What a link points to, read before anything is downloaded. */
export type LinkInfo = {
  id: string;
  url: string;
  site: string; // "YouTube", "Instagram", …
  title: string;
  channel: string;
  duration: number;
  thumbnail?: string;
  /** YouTube's licence line, e.g. "Creative Commons Attribution license (reuse allowed)". */
  license?: string;
  cc: boolean;
  chapters: { start: number; end: number; title: string }[];
  /** A json3 caption track (YouTube), for finding where a topic is talked about. */
  captions?: string;
};

/** Looks a link up without downloading it. Throws a plain-English error for links that can't be used. */
export async function linkInfo(url: string): Promise<LinkInfo> {
  if (!/^https?:\/\/\S+$/i.test(url.trim())) throw new Error("That doesn't look like a link. Paste the full address, starting with https://");
  const d = JSON.parse((await ytdlp(["-J", "--no-playlist", "--no-warnings", url.trim()])).stdout);
  if (d.is_live || d.live_status === "is_live" || d.live_status === "is_upcoming")
    throw new Error("That's a live stream. Only finished videos can be imported.");
  const streams = ((d.formats ?? []) as any[]).filter((f) => f.url && f.vcodec !== "none");
  if (!streams.length && !d.url) throw new Error("That link has no video Creatron can download (it may be a photo or a page without video).");
  // Some sites (Instagram) don't say how long a video is: ask the video stream itself.
  if (!d.duration) d.duration = await streamDuration([...streams.map((f) => f.url), d.url].filter(Boolean));
  if (!d.duration) throw new Error("Couldn't tell how long that video is, so it can't be imported. Try the link again in a minute.");
  const auto = d.automatic_captions ?? {};
  const subs = d.subtitles ?? {};
  const track = [subs.en, subs["en-US"], auto["en-orig"], auto.en].find(Boolean) as { ext: string; url: string }[] | undefined;
  return {
    id: String(d.id),
    url: d.webpage_url ?? url.trim(),
    site: d.extractor_key === "Youtube" ? "YouTube" : String(d.extractor_key ?? d.extractor ?? "web").replace(/^Generic$/, "web"),
    title: d.title ?? d.id,
    channel: d.channel ?? d.uploader ?? d.uploader_id ?? "",
    duration: d.duration,
    thumbnail: d.thumbnail,
    license: d.license ?? undefined,
    cc: /creative commons/i.test(d.license ?? ""),
    chapters: (d.chapters ?? []).map((c: any) => ({ start: c.start_time, end: c.end_time, title: c.title })),
    captions: track?.find((t) => t.ext === "json3")?.url,
  };
}

/** Length in seconds read from the first stream that answers, or 0. */
async function streamDuration(urls: string[]): Promise<number> {
  for (const url of urls.slice(0, 3)) {
    try {
      const { stdout } = await run("ffprobe", ["-v", "error", "-rw_timeout", "15000000", "-show_entries", "format=duration", "-of", "csv=p=0", url]);
      const seconds = Number(stdout.trim());
      if (seconds > 0) return round(seconds, 2);
    } catch {}
  }
  return 0;
}

/** Downloads a link (or just start-end seconds of it) as an mp4 under work/, at most `height` p. */
export async function downloadLink(
  url: string,
  opts: { id: string; site: string; start?: number; end?: number; height?: number; dir?: string },
  onProgress: (fraction: number) => void = () => {},
): Promise<string> {
  const dir = opts.dir ?? join(ROOT, "work", "links");
  mkdirSync(dir, { recursive: true });
  const range = opts.start !== undefined && opts.end !== undefined ? `-${round(opts.start, 2)}-${round(opts.end, 2)}` : "";
  const height = opts.height ?? 1080;
  const base = join(dir, `${opts.site}-${opts.id}${range}${height < 1080 ? `-${height}p` : ""}`.replace(/[^\w./-]+/g, "-"));
  if (existsSync(`${base}.mp4`)) return `${base}.mp4`;
  const args = [
    "--no-playlist", "--no-warnings", "--newline", "--progress",
    // Best picture up to the cap; h264 + AAC first because every player handles them.
    "-S", `res:${height},vcodec:h264,acodec:aac`, "-f", "bv*+ba/b",
    "--merge-output-format", "mp4", "--remux-video", "mp4",
    "--print", "after_move:filepath",
    "-o", `${base}.%(ext)s`,
  ];
  // Cutting at exact times re-encodes only the downloaded part, so the clip starts where asked.
  if (range) args.push("--download-sections", `*${opts.start}-${opts.end}`, "--force-keyframes-at-cuts");
  const { stdout } = await ytdlp([...args, url], (chunk) => {
    for (const m of chunk.matchAll(/\[download\]\s+([\d.]+)%/g)) onProgress(Math.min(1, Number(m[1]) / 100));
  });
  const file = stdout.trim().split("\n").filter((l) => l.startsWith("/")).pop();
  if (!file || !existsSync(file)) throw new Error("The download finished but no video file came out.");
  return file;
}

/** Searches YouTube. cc: only videos under a Creative Commons licence (YouTube's own filter). */
export async function searchYouTube(query: string, cc: boolean, limit = 8): Promise<StockClip[]> {
  return cached(`youtube|${cc ? "cc" : "all"}|${query.trim().toLowerCase()}|${limit}`, async () => {
    const url = new URL("https://www.youtube.com/results");
    url.searchParams.set("search_query", query);
    if (cc) url.searchParams.set("sp", "EgIwAQ=="); // the "Creative Commons" filter
    const d = JSON.parse((await ytdlp(["--flat-playlist", "-J", "--no-warnings", "--playlist-end", String(limit * 2), url.toString()])).stdout);
    return (d.entries as any[])
      // Videos only, long enough to cut from, short enough to search through.
      .filter((e) => e.ie_key === "Youtube" && e.duration >= 4 && e.duration <= 1800)
      .slice(0, limit)
      .map((e) => ({
        id: `${cc ? "ytcc" : "yt"}:${e.id}`,
        description: e.title,
        duration: e.duration,
        width: 0,
        height: 0,
        author: e.channel ?? e.uploader ?? "YouTube",
        page: `https://www.youtube.com/watch?v=${e.id}`,
        download: `https://www.youtube.com/watch?v=${e.id}`,
        thumbnail: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
      }));
  });
}

/** A copyrighted clip the AI proposed, ready to show as a card: nothing is downloaded until the user clicks Add. */
export type SuggestionCard = import("./plan.ts").Suggestion & {
  url: string;
  videoId: string;
  title: string;
  channel: string;
  thumbnail?: string;
  start: number;
  end: number;
  seen?: string;
};

/** The part of a video that shows what the B-roll needs. score is the vision model's 0-10 (undefined if it couldn't look). */
export type Moment = { start: number; end: number; score?: number; seen?: string; info: LinkInfo };

/**
 * Finds the best `seconds`-long part of a YouTube video for `need` ("watering plants"): where
 * chapters and captions mention it, then a vision model looks at a few frames around those times.
 */
export async function findMoment(page: string, need: string, seconds: number, log: (m: string) => void = () => {}): Promise<Moment> {
  const info = await linkInfo(page);
  const len = Math.max(3, Math.min(6, seconds, info.duration));
  const clamp = (t: number) => Math.max(0, Math.min(t, info.duration - len));

  // 1. Where is it talked about? Captions (8 s windows) and chapter titles, scored by shared words.
  const words = keywords(need);
  const scored: { t: number; score: number }[] = [];
  for (const c of info.chapters) scored.push({ t: c.start + 1, score: overlap(words, c.title) * 1.5 });
  for (const w of await captionWindows(info.captions)) scored.push({ t: w.start, score: overlap(words, w.text) });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const candidates: number[] = [];
  for (const h of hits) if (candidates.length < 2 && candidates.every((c) => Math.abs(c - h.t) > 10)) candidates.push(h.t);
  // Nothing said about it (stock footage usually has no speech): look across the video instead.
  if (!candidates.length) candidates.push(...(info.duration <= 20 ? [info.duration / 2] : [info.duration * 0.3, info.duration * 0.6]));

  // 2. Look: a small, low-res download around each candidate, 4 frames each, judged in one vision call.
  const probes = join(ROOT, "work", "broll", `probe-${info.id}-${Date.now().toString(36)}`);
  const frames: { t: number; jpg: string }[] = [];
  try {
    log(`looking inside "${info.title.slice(0, 40)}"`);
    await Promise.all(
      candidates.map(async (c) => {
        const from = Math.max(0, Math.min(c - 2, info.duration - 8));
        const to = Math.min(info.duration, from + 8);
        const file = await downloadLink(page, { id: info.id, site: "probe", start: round(from, 1), end: round(to, 1), height: 360, dir: probes });
        for (let k = 0; k < 4; k++) {
          const at = ((to - from) * (k + 0.5)) / 4;
          const jpg = `${file}.${k}.jpg`;
          await run("ffmpeg", ["-y", "-v", "error", "-ss", at.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=384:-2", "-q:v", "5", jpg]);
          frames.push({ t: round(from + at, 1), jpg });
        }
      }),
    );
    frames.sort((a, b) => a.t - b.t);
    const verdict = await judgeFrames(need, frames);
    if (verdict) {
      const start = clamp(verdict.start - len / 2);
      return { start: round(start, 1), end: round(start + len, 1), score: verdict.score, seen: verdict.seen, info };
    }
  } catch (e) {
    log(`couldn't look at the frames (${e instanceof Error ? e.message.split("\n")[0] : e}); going by the captions`);
  } finally {
    rmSync(probes, { recursive: true, force: true });
  }
  const start = clamp(candidates[0]);
  return { start: round(start, 1), end: round(start + len, 1), info };
}

/** Asks a vision model which frame best shows `need`. Undefined when no model is available. */
async function judgeFrames(need: string, frames: { t: number; jpg: string }[]) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || !frames.length) return undefined;
  const content: any[] = [
    {
      type: "text",
      text:
        `These are ${frames.length} frames from a video, in time order. I need B-roll showing: "${need}".\n` +
        `Frame times (seconds): ${frames.map((f, i) => `#${i + 1}=${f.t}`).join(", ")}.\n` +
        `Reply with JSON only: {"best": <frame number that best shows it>, "score": <0-10, how well it shows it>, "seen": "<what that frame shows, a few words>"}`,
    },
    ...frames.map((f) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${readFileSync(f.jpg).toString("base64")}` } })),
  ];
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Creatron" },
    body: JSON.stringify({ model: VISION_MODEL, messages: [{ role: "user", content }], temperature: 0 }),
  });
  const data = (await res.json()) as any;
  if (!res.ok || data.error) throw new Error(`vision model: ${data.error?.message ?? res.status}`);
  const text = String(data.choices?.[0]?.message?.content ?? "");
  const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "null");
  const frame = frames[Math.max(0, Math.min(frames.length - 1, Number(json?.best) - 1))];
  if (!json || !frame) throw new Error("vision model gave no answer");
  return { start: frame.t, score: Number(json.score) || 0, seen: String(json.seen ?? "") };
}

/** A video's captions as ~8 s windows of text. Empty when there are none or YouTube refuses. */
async function captionWindows(url?: string): Promise<{ start: number; text: string }[]> {
  if (!url) return [];
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const events = ((await res.json()) as any).events ?? [];
    const out: { start: number; text: string }[] = [];
    for (const e of events) {
      const text = (e.segs ?? []).map((s: any) => s.utf8).join("").trim();
      if (!text) continue;
      const t = e.tStartMs / 1000;
      const last = out.at(-1);
      if (last && t - last.start < 8) last.text += ` ${text}`;
      else out.push({ start: t, text });
    }
    return out;
  } catch {
    return [];
  }
}

const STOP = new Set(["the", "a", "an", "of", "and", "or", "in", "on", "at", "to", "with", "for", "is", "are", "my", "your", "some", "b-roll", "broll"]);
const stem = (w: string) => w.replace(/(ing|es|s)$/, "");
const keywords = (text: string) => [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((w) => !STOP.has(w)).map(stem);
function overlap(words: string[], text: string) {
  const have = new Set(keywords(text));
  return words.filter((w) => have.has(w)).length;
}

/** Runs yt-dlp, turning its error lines into something a person can act on. */
async function ytdlp(args: string[], onStdout?: (chunk: string) => void) {
  if (!ytdlpAvailable()) throw new Error("Importing from links needs yt-dlp. Install it with: brew install yt-dlp");
  try {
    return await run("yt-dlp", args, undefined, onStdout);
  } catch (e) {
    throw new Error(explain(e instanceof Error ? e.message : String(e)));
  }
}

function explain(err: string): string {
  const line = err.split("\n").find((l) => l.startsWith("ERROR:"))?.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, "") ?? err.split("\n")[0];
  if (/private video|this video is private/i.test(err)) return "This video is private, so it can't be downloaded. Ask the owner to make it public or unlisted.";
  if (/confirm your age|age.restricted|inappropriate for some users/i.test(err)) return "This video is age-restricted, and YouTube only shows it to signed-in accounts. Creatron can't download it.";
  if (/not a bot/i.test(err)) return "YouTube is asking to confirm this isn't a bot. Wait a few minutes and try again.";
  if (/log ?in|sign in|login required|cookies|authentication|rate-limit reached/i.test(err)) return "This site only shows that video to signed-in accounts, so Creatron can't download it. Try a public link.";
  if (/unsupported url/i.test(err)) return "Creatron can't download from that site. Links from YouTube, Instagram, X, Vimeo, TikTok and most video sites work.";
  if (/unavailable|removed|not available|does not exist|404/i.test(err)) return "That video isn't available (it may have been removed, or it's blocked in your country).";
  if (/Unable to download webpage|timed out|getaddrinfo|network/i.test(err)) return `Couldn't reach that site. Check your internet connection. (${line})`;
  return `Couldn't get that video: ${line}`;
}
