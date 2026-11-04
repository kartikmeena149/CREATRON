// B-roll for Auto Edit, served by the app to the agent's tool belt (autoedit-tools.ts broll ...).
// It runs inside Creatron, which holds the API keys, so the keys never reach Claude's folder or
// its sandbox. Listens on 127.0.0.1 only, behind a random token, and writes only into the job folder.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join, relative, resolve } from "node:path";
import { type Orientation, type StockClip, downloadStock, searchStock, stockAvailable } from "./stock.ts";
import { ROOT, round, run } from "./tools.ts";
import { downloadLink, findMoment, searchWeb, ytdlpAvailable } from "./webvideo.ts";

/** Starts the B-roll service for one job folder. Returns its address (with token) and a stop function. */
export async function startBroker(dir: string): Promise<{ url: string; stop: () => void }> {
  const token = randomBytes(16).toString("hex");
  const server = createServer(async (req, res) => {
    const reply = (status: number, text: string) => (res.writeHead(status, { "Content-Type": "text/plain" }), res.end(text));
    const match = req.url?.match(/^\/([0-9a-f]+)\/broll\/(search|get)$/);
    if (req.method !== "POST" || !match || match[1] !== token) return reply(404, "not found");
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const args: string[] = JSON.parse(body).args ?? [];
      reply(200, match[2] === "search" ? await search(dir, args) : await get(dir, args));
    } catch (e) {
      reply(400, e instanceof Error ? e.message.split("\n").slice(0, 4).join("\n") : String(e));
    }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/${token}`, stop: () => server.close() };
}

const flag = (args: string[], name: string) => args.includes(`--${name}`);
const option = (args: string[], name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
/** Words given without a -- flag (and not a flag's value). */
const plain = (args: string[]) => args.filter((a, i) => !a.startsWith("--") && !(i > 0 && /^--(from|to|find|seconds)$/.test(args[i - 1])));

function inside(dir: string, ...parts: string[]): string {
  const p = resolve(dir, ...parts);
  if (relative(dir, p).startsWith("..")) throw new Error(`${parts.join("/")} is outside the project folder`);
  return p;
}

const resultsFile = (dir: string) => inside(dir, ".broll-results.json");

/** search "<words>" [--landscape|--portrait|--square|--web]: stock first, the web when asked or short of results. */
async function search(dir: string, args: string[]): Promise<string> {
  const words = plain(args).join(" ").trim();
  if (!words) throw new Error('usage: broll search "<words>" [--landscape|--portrait|--web]');
  const orientation: Orientation = flag(args, "portrait") ? "portrait" : flag(args, "square") ? "square" : "landscape";
  const found: StockClip[] = [];
  const problems: string[] = [];
  if (!flag(args, "web") && stockAvailable())
    found.push(...(await searchStock(words, orientation).catch((e) => (problems.push(`stock: ${e.message}`), []))).slice(0, 8));
  if ((flag(args, "web") || found.length < 3) && ytdlpAvailable())
    found.push(...(await searchWeb(words, 8).catch((e) => (problems.push(`web: ${e.message}`), []))));
  const all = existsSync(resultsFile(dir)) ? (JSON.parse(readFileSync(resultsFile(dir), "utf8")) as Record<string, StockClip>) : {};
  for (const c of found) all[c.id] = c;
  writeFileSync(resultsFile(dir), JSON.stringify(all));
  const lines = found.map(
    (c) =>
      `${c.id} | ${c.description.slice(0, 90)} | ${round(c.duration, 1)} s${c.width ? ` | ${c.width}x${c.height}` : ""}${c.license ? ` | ${c.license}` : ""}`,
  );
  return [...(lines.length ? lines : ["nothing found; try other words"]), ...problems].join("\n");
}

/** get <id> <name> [--from s --to s | --find "what it must show"] [--audio] -> public/broll/<name>.mp4 or public/audio/<name>.m4a */
async function get(dir: string, args: string[]): Promise<string> {
  const [id, name] = plain(args);
  if (!id || !name) throw new Error('usage: broll get <id> <name> [--from s --to s | --find "what"] [--audio]');
  const all = existsSync(resultsFile(dir)) ? (JSON.parse(readFileSync(resultsFile(dir), "utf8")) as Record<string, StockClip>) : {};
  const clip = all[id];
  if (!clip) throw new Error(`${id} isn't in your search results; search first`);
  const from = option(args, "from") !== undefined ? Number(option(args, "from")) : undefined;
  const to = option(args, "to") !== undefined ? Number(option(args, "to")) : undefined;
  const notes: string[] = [];
  const stock = /^(pexels|pixabay):/.test(clip.id);
  let file: string;
  if (stock) file = await downloadStock(clip);
  else {
    const [, site, vid] = clip.id.split(":");
    let start = from ?? 0;
    let end = to ?? start + Math.min(10, clip.duration || 10);
    const need = option(args, "find");
    if (need && from === undefined) {
      // The few seconds that show it: captions and chapters, then a vision model looks at frames.
      const m = await findMoment(clip.download, need, Number(option(args, "seconds") ?? 6));
      notes.push(`best moment for "${need}": ${round(m.start, 1)}-${round(m.end, 1)} s of the original${m.seen ? ` (seen: ${m.seen})` : ""}`);
      [start, end] = [m.start, m.end];
    }
    file = await downloadLink(clip.download, { id: vid ?? clip.id, site: site ?? "web", start, end, height: 1080, dir: join(ROOT, "work", "broll") });
  }
  const audio = flag(args, "audio");
  const folder = inside(dir, "public", audio ? "audio" : "broll");
  mkdirSync(folder, { recursive: true });
  const out = join(folder, `${basename(name).replace(/\.\w+$/, "").replace(/[^\w-]+/g, "-")}.${audio ? "m4a" : "mp4"}`);
  const range = stock && from !== undefined ? ["-ss", String(from), ...(to !== undefined ? ["-to", String(to)] : [])] : [];
  if (audio) await run("ffmpeg", ["-y", "-v", "error", ...range, "-i", file, "-vn", "-c:a", "aac", "-b:a", "192k", out]);
  else if (range.length) await run("ffmpeg", ["-y", "-v", "error", ...range, "-i", file, "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-an", out]);
  else copyFileSync(file, out);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "csv=p=0", out]);
  const credit = `${relative(dir, out)}: ${clip.page} by ${clip.author}${clip.license ? ` (${clip.license})` : ""}`;
  const credits = inside(dir, "credits.txt");
  writeFileSync(credits, `${existsSync(credits) ? readFileSync(credits, "utf8") : ""}${credit}\n`);
  return [...notes, `${relative(dir, out)} (${stdout.trim().replace(/\n/g, ", ")}) from ${clip.page}${clip.license ? ` (${clip.license})` : ""} by ${clip.author}`].join("\n");
}
