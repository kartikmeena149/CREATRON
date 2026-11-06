// A small local web server for files on this Mac, with byte ranges so videos can seek. Imports
// load a Claude edit through it (its page fetches its own parts), and the export's Remotion
// browser loads an imported edit's pictures and videos from it.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
};

/** Starts a server on a free port; `pathFor` turns a request URL into a file (or undefined: 404). Returns its address. */
export function serveFiles(pathFor: (url: URL) => string | undefined): Promise<{ origin: string; close: () => void }> {
  const server = createServer((req, res) => {
    const file = pathFor(new URL(req.url ?? "/", "http://localhost"));
    if (!file || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end();
    const size = statSync(file).size;
    const head = { "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (!range) {
      res.writeHead(200, { ...head, "Content-Length": size });
      return void createReadStream(file).pipe(res);
    }
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { ...head, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` });
    createReadStream(file, { start, end }).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

/** Files inside one folder, by path: /a/b.png → folder/a/b.png (never outside it). */
export const inFolder = (folder: string) => (url: URL) => {
  const rel = normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  return rel.includes("..") ? undefined : join(folder, rel);
};

let assets: Promise<string> | undefined;
const allowed = new Set<string>();

/**
 * Files in the given folders by absolute path (?p=/abs/file), for the export's renderer. The server
 * starts once; returns the prefix to put before an encoded path.
 */
export function assetPrefix(folders: string[]): Promise<string> {
  for (const f of folders) allowed.add(normalize(f).replace(/\/?$/, "/"));
  assets ??= serveFiles((url) => {
    const p = url.searchParams.get("p");
    return p && !p.includes("..") && [...allowed].some((f) => p.startsWith(f)) ? p : undefined;
  }).then((s) => `${s.origin}/?p=`);
  return assets;
}
