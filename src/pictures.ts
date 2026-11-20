// A real picture of a thing the user named on a storyboard shot ("Elon Musk", "a Tesla with its logo
// on it"), to draw it from, the way an artist draws from a reference photo. Claude searches the web for
// it (any site: press and product photos, news, Wikipedia...); if that can't run, openly licensed photos
// from Wikimedia Commons and Openverse. Each candidate is downloaded into the storyboard's folder and
// Claude looks at it: only a picture that really shows what was asked for is kept. Its subject is
// lifted out of the background (Apple Vision, tools/object-mask.swift) and where it came from is written
// down (notes/picture-credits.md). The app draws it in pencil (app/photoSketch.ts).
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { askClaude, claudeAvailable } from "./claudecli.ts";
import { find } from "./toolchain.ts";
import { ROOT, run } from "./tools.ts";

type Found = { url: string; title: string; credit: string; license: string; page: string };
// Wikimedia asks apps to say what they are and where they come from (it refuses a bare name).
const AGENT = { "User-Agent": "Creatro/0.1 (+https://localhost; desktop video editor; storyboard reference pictures)" };
/** A Wikimedia original (often many megabytes, and refused to unnamed apps): its 1400px version instead. */
function smaller(url: string): string {
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)$/.exec(url);
  return m ? `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1]}?width=1400` : url;
}

/** Some sites refuse an app's name and some a browser's: one, then the other. */
async function download(url: string): Promise<Response | null> {
  for (const ua of [AGENT["User-Agent"], "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"]) {
    try {
      const res = await fetch(smaller(url), { headers: { "User-Agent": ua, Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" }, signal: AbortSignal.timeout(25_000) });
      if (res.ok && /image\/(jpeg|png|webp)/.test(res.headers.get("content-type") ?? "")) return res;
    } catch {
      // the other one
    }
  }
  return null;
}

async function json(url: string): Promise<any> {
  const res = await fetch(url, { headers: AGENT, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

/** Wikimedia Commons: photos (bitmaps), best for people, places and named things. */
async function commons(name: string): Promise<Found[]> {
  const q = encodeURIComponent(`filetype:bitmap ${name}`);
  const d = await json(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1400&format=json`);
  const pages = Object.values(d?.query?.pages ?? {}) as any[];
  return pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => {
      const ii = p.imageinfo?.[0] ?? {};
      const meta = ii.extmetadata ?? {};
      const strip = (s?: string) => String(s ?? "").replace(/<[^>]+>/g, "").trim().slice(0, 120);
      return { url: ii.thumburl || ii.url, title: String(p.title).replace(/^File:/, ""), credit: strip(meta.Artist?.value) || "Wikimedia Commons", license: strip(meta.LicenseShortName?.value) || "see source", page: ii.descriptionurl || "", w: ii.width ?? 0, h: ii.height ?? 0 };
    })
    .filter((f) => f.url && /\.(jpe?g|png|webp)(\?|$)/i.test(f.url) && f.w >= 400 && f.h >= 400 && f.w / f.h < 2.4 && f.h / f.w < 2.4);
}

/** Openverse: openly licensed photos from Flickr and others, best for everyday things. */
async function openverse(name: string): Promise<Found[]> {
  const d = await json(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(name)}&page_size=10&mature=false`);
  return ((d?.results ?? []) as any[])
    .filter((r) => r.url && (r.width ?? 0) >= 400 && (r.height ?? 0) >= 400)
    .map((r) => ({ url: r.url, title: String(r.title ?? name), credit: String(r.creator ?? r.source ?? "Openverse"), license: `${String(r.license ?? "").toUpperCase()} ${r.license_version ?? ""}`.trim(), page: r.foreign_landing_url ?? "" }));
}

/** Claude, searching the whole web for photos that clearly show `name`: candidate image URLs, best first. */
async function web(name: string): Promise<Found[]> {
  if (!claudeAvailable()) return [];
  const answer = await askClaude("sonnet", [
    `Search the web for real photographs that clearly show exactly this: ${name}`,
    "Any site will do (the maker's press or product pages, news photos, Wikipedia and Wikimedia, stock photo previews).",
    "Every detail asked for must be visible (a named model, a logo, a colour, a person's face). The subject large and clear in the frame, ideally on a plain background; not a drawing, render, collage, or a crowd.",
    "Give direct image file URLs (ending .jpg, .jpeg, .png or .webp, or an image CDN URL that serves the image itself), not web pages. Check them with WebFetch if you are not sure.",
    'Answer with only JSON, nothing else: {"images":[{"url":"...","page":"the page it is on","title":"what it shows","source":"site name"}]} with up to 5, best first.',
  ].join("\n"), { tools: ["WebSearch", "WebFetch"], timeoutMs: 120_000 });
  const at = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (at < 0 || end < at) return [];
  const list = (JSON.parse(answer.slice(at, end + 1)).images ?? []) as { url?: string; page?: string; title?: string; source?: string }[];
  return list
    .filter((i) => typeof i.url === "string" && /^https?:\/\//.test(i.url))
    .map((i) => ({ url: i.url!, title: String(i.title ?? name).slice(0, 120), credit: String(i.source ?? (i.page ? new URL(i.page).host : new URL(i.url!).host)), license: "found on the web: check the rights before publishing", page: String(i.page ?? "") }));
}

/** Whether a downloaded picture really shows what was asked for: Claude looks at it. Unsure counts as yes when Claude can't run. */
async function shows(file: string, name: string): Promise<boolean> {
  if (!claudeAvailable()) return true;
  try {
    const dir = file.slice(0, file.lastIndexOf("/"));
    const answer = await askClaude("haiku", [
      `Look at the image ./${file.slice(file.lastIndexOf("/") + 1)} with the Read tool.`,
      `Does it clearly show this, as its main subject: ${name}?`,
      "Every detail asked for must be visible (a named model, a logo, a colour, a person). Answer only yes or no.",
    ].join("\n"), { tools: ["Read"], cwd: dir, timeoutMs: 60_000 });
    return /^\s*yes/i.test(answer);
  } catch {
    return true;
  }
}

/** The object-mask helper, built once from tools/object-mask.swift (it needs Xcode's Swift). */
async function maskHelper(): Promise<string | null> {
  const helper = join(homedir(), "Library", "Caches", "Creatron", "object-mask");
  if (existsSync(helper)) return helper;
  if (!find("swiftc")) return null;
  mkdirSync(join(homedir(), "Library", "Caches", "Creatron"), { recursive: true });
  await run("swiftc", ["-O", join(ROOT, "tools", "object-mask.swift"), "-o", helper]);
  return existsSync(helper) ? helper : null;
}

/**
 * A picture of `name` in the storyboard folder `dir`, ready to draw: its path relative to the folder
 * (a cut-out PNG when the subject could be lifted out, else the photo), and its credit line.
 */
export async function findPicture(dir: string, name: string, log: (m: string) => void = () => {}): Promise<{ file: string; credit: string; cutout: boolean }> {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error("Name the thing first.");
  log("Searching the web…");
  let found = await web(clean).catch(() => [] as Found[]);
  if (!found.length) {
    // Claude's search couldn't run (or found nothing): the free photo libraries.
    const lists = await Promise.allSettled([commons(clean), openverse(clean)]);
    found = lists.flatMap((l) => (l.status === "fulfilled" ? l.value : []));
  }
  if (!found.length) throw new Error(`no picture of “${clean}” was found`);
  const into = join(dir, "assets", "clips");
  mkdirSync(into, { recursive: true });
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "picture";
  let checked = 0;
  for (const f of found.slice(0, 6)) {
    if (checked >= 4) break;
    try {
      log("Downloading a picture…");
      const res = await download(f.url);
      if (!res) continue;
      const type = res.headers.get("content-type") ?? "";
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 20_000 || bytes.length > 25_000_000) continue;
      const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
      let n = 1;
      while (existsSync(join(into, `${slug}${n > 1 ? `-${n}` : ""}-photo.${ext}`))) n++;
      const base = `${slug}${n > 1 ? `-${n}` : ""}`;
      const photo = join(into, `${base}-photo.${ext}`);
      writeFileSync(photo, bytes);
      // Only a picture of what was asked for.
      log("Checking it's the right picture…");
      checked++;
      if (!(await shows(photo, clean))) {
        rmSync(photo, { force: true });
        continue;
      }
      // The subject, lifted out of its background.
      let file = `assets/clips/${base}-photo.${ext}`;
      let cutout = false;
      try {
        log("Cutting it out…");
        const helper = await maskHelper();
        const out = join(into, `${base}.png`);
        if (helper) {
          await run(helper, [photo, out]);
          if (existsSync(out) && statSync(out).size > 2000) (file = `assets/clips/${base}.png`), (cutout = true);
        }
      } catch {
        // no clear subject, or no Vision: the whole photo is drawn
      }
      const credit = `${f.title} by ${f.credit}, ${f.license}${f.page ? ` (${f.page})` : ""}`;
      mkdirSync(join(dir, "notes"), { recursive: true });
      appendFileSync(join(dir, "notes", "picture-credits.md"), `- ${file}: ${credit}\n`);
      return { file, credit, cutout };
    } catch (e) {
      // the next one
    }
  }
  throw new Error(checked ? `none of the pictures found really showed “${clean}”` : `the pictures of “${clean}” that were found couldn't be downloaded`);
}
