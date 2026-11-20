// 3d: cinematic 3D shots made in code (the 3d-animator skill's kit: three.js, every frame a pure
// function of time, drawn with motion blur, soft light and depth of field), as editable assets:
// assets/3d/<name>/ holds the scene's code, the rendered clip goes to assets/broll/<name>.mp4, and the
// command that made it is written to notes/how-assets-were-made.md, so the user can change the scene
// and render it again. Chrome comes from the toolchain ("three"), ffmpeg through the wall.
import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, cpSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, relative, resolve } from "node:path";
import { FALLBACK, find, need } from "../toolchain.ts";
import { ROOT } from "../tools.ts";
import { DIR, P, config, fail, firstLine, rel, safeName } from "./context.ts";

const KIT = join(ROOT, "skills", "3d-animator", "kit");
/** The kit files a shot needs (the kit's own render.mjs and mixer aren't: this command renders, the timeline mixes). */
const SHOT_FILES = ["film.js", "lib.js", "styles.js", "index.html"];
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css", ".woff2": "font/woff2", ".ttf": "font/ttf", ".glb": "model/gltf-binary", ".hdr": "application/octet-stream" };

const shotDir = (name: string) => join(DIR, "assets", "3d", safeName(name));

export async function scene3d(args: string[]) {
  const [what, name, ...rest] = args;
  const usage = "usage: 3d new <name> [--seconds 5]  |  3d still <name> <t>[,<t>...] [--n 16]  |  3d render <name> [--n 16] [--from s --to s]";
  if (!what || !name) fail(usage);
  const opt = (k: string) => {
    const i = rest.findIndex((a) => a === `--${k}` || a.startsWith(`--${k}=`));
    if (i < 0) return undefined;
    return rest[i]!.includes("=") ? rest[i]!.split("=")[1] : rest[i + 1];
  };
  if (what === "new") return create(name, Number(opt("seconds") ?? 5));
  if (what === "still") return stills(name, (rest.find((a) => !a.startsWith("--") && a !== opt("n")) ?? "").split(",").filter(Boolean).map(Number), Number(opt("n") ?? 16));
  if (what === "render") return render(name, Number(opt("n") ?? 16), opt("from"), opt("to"));
  fail(usage);
}

/** A new 3D shot from the kit, sized to this video, its length set, its own captions off (the timeline has them). */
function create(name: string, seconds: number) {
  const dir = shotDir(name);
  if (existsSync(join(dir, "film.js"))) fail(`assets/3d/${safeName(name)} already exists: edit its film.js`);
  if (!existsSync(KIT)) fail("the 3d-animator kit isn't in this Creatro (skills/3d-animator/kit)");
  mkdirSync(dir, { recursive: true });
  for (const f of SHOT_FILES) cpSync(join(KIT, f), join(dir, f));
  const { width: w, height: h } = config;
  const edit = (file: string, from: RegExp, to: string) => {
    const f = join(dir, file);
    const text = readFileSync(f, "utf8");
    if (!from.test(text)) return;
    writeFileSync(f, text.replace(from, to));
  };
  edit("lib.js", /export const W = \d+, H = \d+/, `export const W = ${w}, H = ${h}`);
  edit("index.html", /width: 1920px; height: 1080px/, `width: ${w}px; height: ${h}px`);
  edit("index.html", /width="1920" height="1080"/, `width="${w}" height="${h}"`);
  edit("film.js", /export const total = [\d.]+;/, `export const total = ${Math.max(0.5, seconds || 5)};`);
  edit("film.js", /const CAPTIONS = \[.*?\];[^\n]*/, "const CAPTIONS = []; // captions live in project/timeline.json, not in the 3D shot");
  console.log(`assets/3d/${safeName(name)}/: a ${w}x${h} 3D shot, ${seconds} s, from the 3d-animator kit (its starter desk scene).`);
  console.log("Replace the props, camera and light in film.js (the skill's stages 2-5), then:");
  console.log(`  3d still ${safeName(name)} 0.5,2,4     look at frames (notes/checks/)`);
  console.log(`  3d render ${safeName(name)}            -> assets/broll/${safeName(name)}.mp4, then list it in timeline.json "broll"`);
}

/** The shot's folder served on this Mac only, with Creatro's three.js under /node_modules/three. */
async function serve(dir: string): Promise<{ server: Server; url: string }> {
  const modules = join(ROOT, "node_modules");
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const [base, rest] = path.startsWith("/node_modules/three/") ? [modules, path.slice("/node_modules/".length)] : [dir, path.slice(1)];
    const file = resolve(base, rest || "index.html");
    if (relative(base, file).startsWith("..") || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404), res.end();
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}/index.html?render=1` };
}

/** Chrome with the scene loaded, ready to draw any time t. */
async function open(name: string) {
  const dir = shotDir(name);
  if (!existsSync(join(dir, "film.js"))) fail(`there is no 3D shot "${safeName(name)}": make it with  3d new ${safeName(name)}`);
  const chrome = find("three") ?? fail(`3D shots in code aren't available on this Mac. Instead: ${FALLBACK.three.without}.`);
  const puppeteer = (await import("puppeteer")).default;
  const { server, url } = await serve(dir);
  const angle = process.platform === "darwin" ? ["--use-angle=metal"] : [];
  const browser = await puppeteer.launch({
    headless: true, executablePath: chrome.cmd,
    args: ["--hide-scrollbars", "--force-color-profile=srgb", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-gpu-vsync", "--run-all-compositor-stages-before-draw", ...angle],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: config.width, height: config.height, deviceScaleFactor: 1 });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(firstLine(e)));
  page.on("console", (m) => { if (m.type() === "error" && /shader|error/i.test(m.text())) problems.push(m.text().slice(0, 160)); });
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true", { timeout: 120_000 });
  } catch (e) {
    await browser.close();
    server.close();
    fail(`the 3D scene didn't load: ${problems[0] ?? firstLine(e)}`);
  }
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const x = gl?.getExtension("WEBGL_debug_renderer_info");
    return x && gl ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
  if (/swiftshader|llvmpipe|software/i.test(gpu)) console.log("note: drawing without the GPU (slow): keep --n at 4-8.");
  if (chrome.backup) console.log(`note: using ${chrome.via} (the first choice isn't working).`);
  const total = Number(await page.evaluate("window.total")) || 5;
  // A frame that hangs ends the command with a clear line instead of waiting forever.
  const grab = async (t: number, n: number) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        page.evaluate((tt, nn) => {
          (window as any).renderAt(tt, nn);
          return (document.getElementById("stage") as HTMLCanvasElement).toDataURL("image/png").split(",")[1]!;
        }, t, n).then((b64) => Buffer.from(b64, "base64")),
        new Promise<never>((_, no) => (timer = setTimeout(() => no(new Error(`frame at ${t.toFixed(2)} s took over a minute`)), 60_000))),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const close = async () => (await browser.close().catch(() => {}), server.closeAllConnections(), server.close());
  return { grab, total, close, problems };
}

async function stills(name: string, times: number[], n: number) {
  if (!times.length || times.some((t) => !Number.isFinite(t))) fail("usage: 3d still <name> <t>[,<t>...] [--n 16]");
  const s = await open(name);
  try {
    mkdirSync(P.checks, { recursive: true });
    for (const t of times) {
      const file = join(P.checks, `3d-${safeName(name)}-${String(t).replace(".", "_")}.png`);
      const started = Date.now();
      writeFileSync(file, await s.grab(Math.min(t, s.total), n));
      console.log(`${rel(file)}  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    }
    if (s.problems.length) console.log(`note: the scene reported: ${s.problems[0]} (an effect may be missing: look at the still)`);
    console.log("Read the PNGs to look at them.");
  } finally {
    await s.close();
  }
}

async function render(name: string, n: number, fromArg?: string, toArg?: string) {
  const s = await open(name);
  const ff = need("ffmpeg");
  const fps = config.fps;
  const from = Math.max(0, Number(fromArg ?? 0));
  const to = Math.min(s.total, Number(toArg ?? s.total));
  const frames = Math.max(1, Math.round((to - from) * fps));
  const out = join(DIR, "assets", "broll", `${safeName(name)}.mp4`);
  mkdirSync(join(DIR, "assets", "broll"), { recursive: true });
  let child: ChildProcess | undefined;
  try {
    child = spawn(ff.cmd, [
      ...ff.pre, "-y", "-v", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
      "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out,
    ], { env: { ...process.env, ...ff.env }, stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise<number>((ok) => child!.on("close", (c) => ok(c ?? 1)));
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      const png = await s.grab(from + i / fps, n);
      if (!child.stdin!.write(png)) await new Promise((ok) => child!.stdin!.once("drain", ok));
      if (i && i % 30 === 0) {
        const sec = (Date.now() - started) / 1000;
        console.log(`frame ${i}/${frames}  ${sec.toFixed(0)} s, about ${((frames - i) * sec / i).toFixed(0)} s left`);
      }
    }
    child.stdin!.end();
    if ((await done) !== 0) fail("ffmpeg couldn't write the 3D clip");
    const line = `- assets/broll/${safeName(name)}.mp4: 3D shot from assets/3d/${safeName(name)}/ (three.js), rendered with: $T 3d render ${safeName(name)} --n ${n}${fromArg ? ` --from ${from}` : ""}${toArg ? ` --to ${to}` : ""}\n`;
    const notes = join(P.notes, "how-assets-were-made.md");
    if (!existsSync(notes) || !readFileSync(notes, "utf8").includes(line.trim())) appendFileSync(notes, line);
    console.log(`${rel(out)}: ${frames} frames, ${(frames / fps).toFixed(2)} s, ${config.width}x${config.height}, no sound (the timeline mixes it), in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
    console.log(`List it in timeline.json "broll" and play it with <Video muted src={staticFile("assets/broll/${safeName(name)}.mp4")} />. Change the scene in assets/3d/${safeName(name)}/film.js and render again.`);
    if (s.problems.length) console.log(`note: the scene reported: ${s.problems[0]}`);
  } finally {
    child?.stdin?.destroy();
    await s.close();
  }
}
