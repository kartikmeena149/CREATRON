// Auto Edit: raw footage in, finished video out, made the way Claude Code edits a video by hand.
// Creatron prepares a folder (work/<video>/autoedit) with the recording, its transcript, an
// optional reference video's frames and a playbook, then runs Claude Code headless there (claude -p
// on this Mac's Claude plan) with real tools: ffmpeg, its own Remotion project for the whole video,
// B-roll search and download, frames and loudness to check its own work.
//
// Fenced in: file tools only reach the folder (--restricted), and every command runs in Claude Code's
// macOS sandbox, which can only write inside the folder, has no network and can't read .env or keys.
// The one exception is Creatron's own tool belt (autoedit-tools.ts: render, stills), which Claude
// can't edit and which only touches the folder; B-roll comes from the app itself (autoedit-broll.ts).
// Anything else is refused (dontAsk), never asked.
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import { ensureBrowser } from "@remotion/renderer";
import { analyze } from "./analyze.ts";
import { startBroker } from "./autoedit-broll.ts";
import { describe } from "./plan.ts";
import { chromeOutsideProtectedFolders } from "./remotion.ts";
import { ROOT, round, run, workDir } from "./tools.ts";

export type AutoEditRequest = { video: string; brief: string; reference?: string; model: string };
export type AutoEditMarker = { n: number; time: number; x: number; y: number };
export type AutoEditResult = { dir: string; final: string; session: string; notes: string; version: number };

/** What the progress view shows. remainingMs is the current guess of the time left. */
export type AutoEditEvent =
  | { type: "log"; text: string; kind: "tool" | "note" | "info" }
  | { type: "progress"; stage: string; fraction: number; elapsedMs: number; remainingMs: number };

// The steps the playbook names (it calls `stage <name>` at each), with the share of the total
// time each usually takes. Used to place the progress bar and to estimate the time left.
const STAGES: [string, number][] = [
  ["look", 0.05], ["cut", 0.06], ["plan", 0.06], ["broll", 0.13], ["build", 0.25], ["render", 0.12], ["check", 0.07], ["fix", 0.26],
];
// A fix: Claude changes things, renders, checks.
const FIX_STAGES: [string, number][] = [["fix", 0.4], ["render", 0.45], ["check", 0.15]];

const TOOLS = join(ROOT, "src", "autoedit-tools.ts");
const EARSHOT_PY = join(homedir(), "Developer", "earshot", ".venv", "bin", "python");
const HISTORY = join(ROOT, "work", "autoedit-history.json");
const TIME_LIMIT = 75 * 60_000;

let current: ChildProcess | undefined;
let cancelled = false;

export const autoEditDir = (video: string) => join(workDir(video), "autoedit");

/** Stops the edit that's running (if any). */
export function cancelAutoEdit() {
  cancelled = true;
  current?.kill("SIGTERM");
}

/** A whole edit from scratch. */
export async function autoEdit(req: AutoEditRequest, emit: (e: AutoEditEvent) => void): Promise<AutoEditResult> {
  cancelled = false;
  const started = Date.now();
  const info = (text: string) => emit({ type: "log", text, kind: "info" });
  info("Reading the recording (transcript and pauses)");
  const analysis = await analyze(req.video, (m) => info(m.replace(/^analyze: /, "")));
  const dir = autoEditDir(req.video);
  prepare(dir, req, analysis);
  if (req.reference) {
    info("Looking at the reference video");
    await prepareReference(dir, req.reference);
  }
  info("Getting the renderer ready");
  const browser = await ensureBrowser();
  if ("path" in browser) chromeOutsideProtectedFolders(browser.path); // made now, so the agent's renders find it

  const estimate = new Estimate(STAGES, firstEstimate(analysis.duration), started, dir, emit);
  const broker = await startBroker(dir);
  const ask = (prompt: string, session?: string) => claude(dir, req.model, prompt, session, emit, estimate, broker.url);
  try {
    let turn = await ask([
      "Read PLAYBOOK.md and follow it to make the finished video. The user's brief is in brief.md.",
      req.reference ? "A reference video's frames are in reference/: copy its style." : "",
    ].join("\n"));
    turn = await ensureRendered(dir, turn, started, emit, ask);
    // A first version is rarely the best one: one review round against a professional bar (and the reference).
    emit({ type: "log", text: "Reviewing the first version like a director", kind: "info" });
    const reviewStart = Date.now();
    await contactSheet(join(dir, "out", "final.mp4"), join(dir, "checks", "review-sheet.jpg"));
    turn = await ask(review(Boolean(req.reference)), turn.session);
    turn = await ensureRendered(dir, turn, reviewStart, emit, ask);
    const result = keepVersion(dir, turn);
    saveHistory(analysis.duration, Date.now() - started, estimate.renderMs);
    return result;
  } finally {
    estimate.stop();
    broker.stop();
  }
}

/** A follow-up change: resumes the same Claude session with the message and pictures of the marked spots. */
export async function autoEditFix(
  video: string,
  session: string,
  model: string,
  message: string,
  markers: AutoEditMarker[],
  emit: (e: AutoEditEvent) => void,
): Promise<AutoEditResult> {
  cancelled = false;
  const started = Date.now();
  const dir = autoEditDir(video);
  const final = join(dir, "out", "final.mp4");
  const pictures = markers.length ? await markerFrames(dir, final, markers) : [];
  const estimate = new Estimate(FIX_STAGES, fixEstimate(), started, dir, emit);
  estimate.stage("fix");
  const broker = await startBroker(dir);
  const ask = (prompt: string, s?: string) => claude(dir, model, prompt, s, emit, estimate, broker.url);
  try {
    let turn = await ask([
      `The user watched out/final.mp4 and asks: ${message}`,
      pictures.length ? `\nWhat they're pointing at (Read each image; the red box is the spot they clicked):\n${pictures.join("\n")}` : "",
      "\nMake the change, re-render with the render command, check what you changed, and reply in 1-2 plain sentences.",
      "Call `stage render` before rendering and `stage check` before checking.",
    ].join("\n"), session);
    turn = await ensureRendered(dir, turn, started, emit, ask);
    return keepVersion(dir, turn);
  } finally {
    estimate.stop();
    broker.stop();
  }
}

/** The review prompt: score the video honestly, then fix the biggest gaps. */
function review(withReference: boolean): string {
  return [
    "Creatron's review. Read checks/review-sheet.jpg (16 frames of your out/final.mp4, left to right, top to bottom)" +
      (withReference ? " and reference/sheet.jpg (16 frames of the reference)." : "."),
    "Be a demanding director. Score 1-10: layout variety, motion and transitions, B-roll (relevant, enough, well framed),",
    "captions, graphics and annotations, sound design (music level, number and timing of sound effects), pacing" +
      (withReference ? ", and how closely it matches the reference's style." : "."),
    "List the 5 biggest gaps between this and what a top professional editor would deliver" + (withReference ? " in the reference's style" : "") + ".",
    "Then fix all of them (call `stage fix`), re-render (`stage render`), check (`stage check`) and look at the new frames.",
    "Reply with 2-4 plain sentences for the user about the finished video (no tables, lists or scores).",
  ].join("\n");
}

/** 16 frames of a video in one picture (4 by 4), for a quick look at the whole thing. */
async function contactSheet(video: string, out: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]);
  const every = Math.max(0.2, (Number(stdout.trim()) || 16) / 16);
  await run("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", `fps=1/${every.toFixed(3)},scale=-2:480,tile=4x4:padding=6:color=white`, "-frames:v", "1", out]);
}

/** If Claude stopped without a fresh out/final.mp4, ask it once to finish. */
async function ensureRendered(dir: string, turn: Turn, since: number, emit: (e: AutoEditEvent) => void, ask: (prompt: string, session?: string) => Promise<Turn>): Promise<Turn> {
  const final = join(dir, "out", "final.mp4");
  if (existsSync(final) && statSync(final).mtimeMs > since) return turn;
  emit({ type: "log", text: "No finished video yet: asking Claude to finish", kind: "info" });
  turn = await ask("out/final.mp4 hasn't been rendered (or wasn't updated). Finish the work: render it, check it, and reply with your summary.", turn.session);
  if (!existsSync(final) || statSync(final).mtimeMs <= since) throw new Error(`Claude stopped without rendering the video. Its last words: ${turn.text.slice(0, 400)}`);
  return turn;
}

/** Copies the new out/final.mp4 to versions/vN.mp4 so every result stays playable and comparable. */
function keepVersion(dir: string, turn: Turn): AutoEditResult {
  mkdirSync(join(dir, "versions"), { recursive: true });
  const version = readdirSync(join(dir, "versions")).filter((f) => /^v\d+\.mp4$/.test(f)).length + 1;
  const final = join(dir, "versions", `v${version}.mp4`);
  copyFileSync(join(dir, "out", "final.mp4"), final);
  writeFileSync(join(dir, "session.json"), JSON.stringify({ session: turn.session, version }));
  return { dir, final, session: turn.session, notes: turn.text, version };
}

/** The folder Claude works in. A previous Auto Edit of this video is kept as autoedit-<time>. */
function prepare(dir: string, req: AutoEditRequest, analysis: Awaited<ReturnType<typeof analyze>>) {
  if (existsSync(dir)) renameSync(dir, `${dir}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
  for (const d of ["public", "checks", "out", "src"]) mkdirSync(join(dir, d), { recursive: true });
  const hasVideo = analysis.width > 0;
  const media = join(dir, "public", `source${extname(req.video).toLowerCase()}`);
  linkOrCopy(req.video, media);
  writeFileSync(
    join(dir, "autoedit.json"),
    JSON.stringify({ source: analysis.source, media, hasVideo, width: analysis.width, height: analysis.height, fps: hasVideo ? analysis.fps : 30, duration: analysis.duration }, null, 1),
  );
  writeFileSync(join(dir, "transcript.json"), JSON.stringify({ note: "SOURCE seconds", words: analysis.words, pauses: analysis.silences }, null, 1));
  writeFileSync(join(dir, "transcript.md"), describe(analysis));
  writeFileSync(join(dir, "brief.md"), `# What the user wants\n\n${req.brief.trim() || "(nothing specific: make a strong 9:16 social edit of the whole idea)"}\n`);
  if (!hasVideo) appendFileSync(join(dir, "brief.md"), "\nThe recording is AUDIO ONLY: build every picture yourself (B-roll, graphics, captions).\n");
  writeFileSync(join(dir, "PLAYBOOK.md"), playbook());
  writeFileSync(join(dir, "agent-log.jsonl"), "");
}

async function prepareReference(dir: string, reference: string) {
  const out = join(dir, "reference");
  mkdirSync(out, { recursive: true });
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", reference]);
  const probe = JSON.parse(stdout);
  const duration = Number(probe.format.duration) || 30;
  const v = probe.streams.find((s: any) => s.width);
  const count = 16;
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) * duration) / count;
    await run("ffmpeg", ["-y", "-v", "error", "-ss", t.toFixed(2), "-i", reference, "-frames:v", "1", "-vf", "scale=-2:720", join(out, `ref-${String(i + 1).padStart(2, "0")}.jpg`)]);
  }
  linkOrCopy(reference, join(out, `reference${extname(reference).toLowerCase()}`));
  await contactSheet(reference, join(out, "sheet.jpg"));
  writeFileSync(
    join(out, "info.md"),
    [
      `# Reference video (copy its style, not its content)`,
      `${v ? `${v.width}x${v.height}, ` : ""}${round(duration, 1)} s. ${count} frames, evenly spaced: ref-01.jpg ... ref-${count}.jpg, and all of them in one picture: sheet.jpg.`,
      `The full file is reference/${basename(join(out, `reference${extname(reference).toLowerCase()}`))}: extract more frames or listen-measure its audio with ffmpeg if useful.`,
    ].join("\n"),
  );
}

function linkOrCopy(from: string, to: string) {
  try {
    linkSync(from, to); // same disk: instant and no extra space
  } catch {
    copyFileSync(from, to);
  }
}

function playbook(): string {
  const text = readFileSync(join(ROOT, "src", "autoedit-playbook.md"), "utf8");
  const earshot = existsSync(EARSHOT_PY) ? `${EARSHOT_PY} -m earshot` : "earshot-not-installed";
  return text.replaceAll("$T", `node ${TOOLS}`).replaceAll("$EARSHOT", earshot);
}

/** The edited frame at each marker with a red box where the user clicked, for Claude to look at. */
async function markerFrames(dir: string, video: string, markers: AutoEditMarker[]): Promise<string[]> {
  mkdirSync(join(dir, "markers"), { recursive: true });
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-select_streams", "v:0", "-of", "csv=p=0", video]);
  const [w, h] = stdout.trim().split(",").map(Number);
  const out: string[] = [];
  for (const m of markers) {
    const box = Math.round(Math.min(w, h) * 0.14);
    const file = join("markers", `marker-${m.n}.png`);
    await run("ffmpeg", [
      "-y", "-v", "error", "-ss", Math.max(0, m.time).toFixed(3), "-i", video,
      "-vf", `drawbox=x=${Math.round(m.x * w - box / 2)}:y=${Math.round(m.y * h - box / 2)}:w=${box}:h=${box}:color=red@0.95:t=${Math.max(4, Math.round(box / 18))},scale=-2:'min(960,ih)'`,
      "-frames:v", "1", join(dir, file),
    ]);
    out.push(`- #${m.n} at ${m.time.toFixed(2)} s of the video: ${file}`);
  }
  return out;
}

// ---- Claude ----

type Turn = { text: string; session: string };

/** One claude -p turn in the folder, streaming what it does. */
function claude(
  dir: string,
  model: string,
  prompt: string,
  session: string | undefined,
  emit: (e: AutoEditEvent) => void,
  estimate: Estimate,
  broker: string,
): Promise<Turn> {
  // A clean environment: no API key (that would bill the API instead of the plan) and none of a
  // parent Claude session's settings.
  const env = {
    HOME: homedir(), USER: process.env.USER ?? "", PATH: process.env.PATH ?? "", LANG: process.env.LANG ?? "en_US.UTF-8", TMPDIR: tmpdir(),
    CREATRON_AUTOEDIT_DIR: dir, CREATRON_ROOT: ROOT, CREATRON_BROKER: broker,
    NUMBA_CACHE_DIR: join(dir, ".cache", "numba"), // earshot's compiled DSP, cached where the sandbox may write
  };
  const tools = `node ${TOOLS}`;
  // Any command may run inside the sandbox (it can only write in this folder, has no network and
  // can't read the secrets below); only the tool belt runs outside it, and only it is named here.
  // The everyday commands are also named, because a chain like "ffmpeg ... && ffmpeg ..." isn't auto-allowed.
  const everyday = ["ffmpeg", "ffprobe", "node", "cd", "ls", "cat", "head", "tail", "wc", "mkdir", "cp", "mv", "rm", "echo", "sort", "grep", "find", "du", "file", "python3", "sed", "awk", "jq"];
  const allowed = [
    "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", `Bash(${tools})`, `Bash(${tools} *)`,
    ...everyday.flatMap((c) => [`Bash(${c})`, `Bash(${c} *)`]),
    ...(existsSync(EARSHOT_PY) ? [`Bash(${EARSHOT_PY} -m earshot *)`] : []),
  ];
  const settings = {
    permissions: {
      // Secrets stay unreadable even to sandboxed commands.
      deny: [`Read(/${join(ROOT, ".env")})`, `Read(/${join(homedir(), ".ssh")}/**)`, `Read(/${join(homedir(), ".aws")}/**)`, `Read(/${join(homedir(), ".claude.json")})`],
    },
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      // Remotion's Chrome can't start inside the sandbox; only Creatron's own tool belt runs outside it.
      excludedCommands: [tools, `${tools} *`],
      network: { allowLocalBinding: true },
    },
  };
  const args = [
    "-p", "--model", model, "--output-format", "stream-json", "--verbose",
    "--restricted", "--tools", "Bash,Read,Write,Edit,Glob,Grep,WebSearch,WebFetch",
    "--allowedTools", ...allowed,
    "--permission-mode", "dontAsk", "--permission-prompts", "none",
    "--strict-mcp-config", "--setting-sources", "project", "--disable-slash-commands",
    "--settings", JSON.stringify(settings),
    ...(session ? ["--resume", session] : []),
  ];
  const log = join(dir, "agent-log.jsonl");
  return new Promise((ok, fail) => {
    if (cancelled) return fail(new Error("Stopped."));
    const child = spawn("claude", args, { env, cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
    current = child;
    const timer = setTimeout(() => child.kill("SIGTERM"), TIME_LIMIT);
    let buffer = "";
    let stderr = "";
    let result: any;
    let sessionId = session ?? "";
    child.stdout.on("data", (d) => {
      buffer += d;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        appendFileSync(log, `${line}\n`);
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.session_id) sessionId = msg.session_id;
        if (msg.type === "result") result = msg;
        else if (msg.type === "assistant") for (const block of msg.message?.content ?? []) onBlock(block);
      }
    });
    const onBlock = (block: any) => {
      if (block.type === "text" && block.text?.trim()) emit({ type: "log", text: block.text.trim().slice(0, 400), kind: "note" });
      if (block.type !== "tool_use") return;
      const stage = String(block.input?.command ?? "").match(/autoedit-tools\.ts stage (\w+)/)?.[1];
      if (stage) return estimate.stage(stage);
      emit({ type: "log", text: describeTool(dir, block.name, block.input ?? {}), kind: "tool" });
    };
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => fail(new Error(`could not start claude: ${e.message}`)));
    child.on("close", () => {
      clearTimeout(timer);
      current = undefined;
      if (cancelled) return fail(new Error("Stopped."));
      if (!result) return fail(new Error(`Claude stopped unexpectedly: ${(stderr || buffer).trim().slice(-400) || "no output"}`));
      if (result.is_error) return fail(new Error(`Claude: ${String(result.result ?? result.subtype ?? "error").slice(0, 400)}`));
      ok({ text: String(result.result ?? "").trim(), session: result.session_id ?? sessionId });
    });
    child.stdin.end(prompt);
  });
}

/** One line for the progress view: what Claude is doing, in plain words. */
function describeTool(dir: string, name: string, input: any): string {
  const rel = (p: string) => (p ? relative(dir, p) || p : "");
  if (name === "Bash") {
    const cmd = String(input.command ?? "");
    const tool = cmd.match(/autoedit-tools\.ts (\w+)(?: (\w+))?(.*)/);
    if (tool) {
      const [, what, sub, rest] = tool;
      if (what === "render") return "Rendering the video";
      if (what === "still") return `Rendering a test frame${rest ? ` (${sub}${rest})`.slice(0, 60) : ""}`;
      if (what === "check") return "Checking the video: loudness, peaks, frames";
      if (what === "cut") return "Cutting dead air and retakes";
      if (what === "broll") return sub === "search" ? `Searching B-roll:${rest}`.slice(0, 120) : `Downloading B-roll: ${rest.trim().split(" ")[0] ?? ""}`.slice(0, 120);
    }
    if (input.description) return String(input.description).slice(0, 140);
    return cmd.replace(new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/?", "g"), "").slice(0, 140);
  }
  if (name === "Read") {
    const f = rel(input.file_path);
    return /\.(png|jpe?g)$/i.test(f) ? `Looking at ${f}` : `Reading ${f}`;
  }
  if (name === "Write") return `Writing ${rel(input.file_path)}`;
  if (name === "Edit") return `Editing ${rel(input.file_path)}`;
  if (name === "WebSearch") return `Searching the web: ${input.query ?? ""}`;
  if (name === "WebFetch") return `Reading ${input.url ?? "a web page"}`;
  if (name === "Glob" || name === "Grep") return `Looking through files (${input.pattern ?? ""})`;
  return name;
}

// ---- Time left ----

/**
 * Guesses the time left from where Claude is (the stage it announced, and the render's own
 * progress), how long such a stage usually takes, and how fast this run has gone so far.
 */
class Estimate {
  private current = 0;
  private stageStart: number;
  private renderStart = 0;
  renderMs = 0;
  private timer: NodeJS.Timeout;
  private stages: [string, number][];
  private nominalMs: number;
  private started: number;
  private dir: string;
  private emit: (e: AutoEditEvent) => void;
  constructor(stages: [string, number][], nominalMs: number, started: number, dir: string, emit: (e: AutoEditEvent) => void) {
    this.stages = stages;
    this.nominalMs = nominalMs;
    this.started = started;
    this.dir = dir;
    this.emit = emit;
    this.stageStart = started;
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stage(name: string) {
    const i = this.stages.findIndex(([s]) => s === name);
    if (i < 0) return;
    if (this.stages[this.current][0] === "render" && this.renderStart) this.renderMs = Date.now() - this.renderStart;
    if (name === "render") this.renderStart = Date.now();
    // Steps only move forward on the bar; going back to fix after a check counts as "fix".
    if (i > this.current || name === "fix") this.current = Math.max(i, this.current);
    this.stageStart = Date.now();
    this.emit({ type: "log", text: `Step: ${name}`, kind: "info" });
    this.tick();
  }

  fraction(): number {
    const before = this.stages.slice(0, this.current).reduce((a, [, w]) => a + w, 0);
    const [name, width] = this.stages[this.current];
    let inside: number;
    const progress = join(this.dir, ".render-progress");
    if (name === "render" && existsSync(progress)) inside = Math.min(0.95, Number(readFileSync(progress, "utf8")) || 0) * 0.85; // levelling and check follow
    else {
      // Without a signal: approach the end of the stage, never reach it.
      const expected = width * this.nominalMs;
      inside = 1 - Math.exp(-(Date.now() - this.stageStart) / expected);
      inside *= 0.9;
    }
    return Math.min(0.99, before + width * inside);
  }

  tick() {
    const elapsed = Date.now() - this.started;
    const f = this.fraction();
    // Pace: how much slower (or faster) than usual this run is going, trusted more as it goes on.
    const rawPace = f > 0.02 ? elapsed / (f * this.nominalMs) : 1;
    const pace = 1 + Math.min(f * 1.5, 1) * (Math.min(Math.max(rawPace, 0.4), 3) - 1);
    const remaining = Math.max(15_000, (1 - f) * this.nominalMs * pace);
    this.emit({ type: "progress", stage: this.stages[this.current][0], fraction: f, elapsedMs: elapsed, remainingMs: remaining });
  }

  stop() {
    clearInterval(this.timer);
  }
}

type History = { runs: { sourceSeconds: number; ms: number; renderMs: number; at: string }[] };

function readHistory(): History {
  try {
    return JSON.parse(readFileSync(HISTORY, "utf8"));
  } catch {
    return { runs: [] };
  }
}

/** Usual total time for a recording this long: from past runs when there are some. */
function firstEstimate(sourceSeconds: number): number {
  const runs = readHistory().runs.slice(-6);
  if (runs.length) {
    const perSecond = runs.map((r) => (r.ms - 6 * 60_000) / Math.max(r.sourceSeconds, 10)).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
    return Math.min(Math.max(6 * 60_000 + perSecond * sourceSeconds, 8 * 60_000), 45 * 60_000);
  }
  return Math.min(Math.max(10 * 60_000 + sourceSeconds * 8_000, 12 * 60_000), 40 * 60_000);
}

function fixEstimate(): number {
  const last = readHistory().runs.at(-1);
  return 3 * 60_000 + (last?.renderMs || 3 * 60_000) * 1.3;
}

function saveHistory(sourceSeconds: number, ms: number, renderMs: number) {
  const h = readHistory();
  h.runs.push({ sourceSeconds: round(sourceSeconds, 1), ms, renderMs, at: new Date().toISOString() });
  h.runs = h.runs.slice(-20);
  writeFileSync(HISTORY, JSON.stringify(h, null, 1));
}

