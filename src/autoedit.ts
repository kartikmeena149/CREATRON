// Auto Edit: raw footage in, an open editable project out (and its exported video), made the way
// Claude Code edits a video by hand. Three parts (docs/WORKFLOW.md):
//   1. The brain: Claude (claude -p on this Mac's Claude plan) makes every editing decision.
//   2. The hands: tools behind the toolchain wall (toolchain.ts). Their health is checked before
//      every job and written to notes/TOOLS.md; a broken tool means a fallback, never a dead job.
//   3. The output: always an editable project (project.ts): source/ untouched, assets/ as separate
//      files, project/ with cuts, captions, music and colours as plain values, Export/ the MP4.
//      validateProject is the rule in code; Claude is sent back until it passes.
// Creatro prepares the folder (work/<video>/autoedit) from the project scaffold, adds the
// transcript, an optional reference video's frames and a playbook, then runs Claude there.
//
// Free: no sandbox and no permission checks. Claude has every tool, the internet, and the user's
// skills and MCP servers, like Claude Code at a keyboard. Only .env and key files stay unreadable.
// Its tool belt (autoedit-tools.ts) and the ffmpeg/ffprobe wrappers first on its PATH still send
// tools through the wall, and validateProject still keeps the result an editable project.
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import { ensureBrowser } from "@remotion/renderer";
import { analyze } from "./analyze.ts";
import { startBroker } from "./autoedit-broll.ts";
import { describe } from "./plan.ts";
import { finalFile, projectName, projectPaths, scaffoldProject, validateProject } from "./project.ts";
import { type Storyboard, approvedPrompt, checkScenes, parseStoryboard, redrawPrompt, sayingTime, scenesOf } from "./storyboard.ts";
import { chromeOutsideProtectedFolders } from "./remotion.ts";
import { find, health, healthProblems, healthReport } from "./toolchain.ts";
import { ROOT, round, run, workDir } from "./tools.ts";

/**
 * Shows the storyboard to the user and waits for their answer: approve (with their edits), or
 * changes to redraw. Without one (the command line), the edit doesn't stop for a storyboard.
 */
export type StoryboardReview = (board: Storyboard, dir: string, round: number) => Promise<{ approve: true; board: Storyboard } | { approve: false; board: Storyboard; changes: string }>;
/** clips: the user's own clips (the library), linked into assets/clips/ for Claude to use. */
export type AutoEditRequest = { video: string; brief: string; reference?: string; model: string; clips?: string[]; review?: StoryboardReview };
export type AutoEditMarker = { n: number; time: number; x: number; y: number };
/** dir is the open project folder; project is the part to import into the timeline; final is the exported video. */
export type AutoEditResult = { dir: string; project: string; final: string; session: string; notes: string; version: number };

/** What the progress view shows. remainingMs is the current guess of the time left. */
export type AutoEditEvent =
  | { type: "log"; text: string; kind: "tool" | "note" | "info" }
  | { type: "progress"; stage: string; fraction: number; elapsedMs: number; remainingMs: number };

// The steps the playbook names (it calls `stage <name>` at each), with the share of the total
// time each usually takes. Used to place the progress bar and to estimate the time left.
const STAGES: [string, number][] = [
  ["look", 0.05], ["cut", 0.06], ["plan", 0.06], ["broll", 0.13], ["build", 0.25], ["render", 0.12], ["check", 0.07], ["fix", 0.26],
];
// The storyboard, before the edit: Claude looks and draws (the wait for the user isn't counted).
const BOARD_STAGES: [string, number][] = [["board", 1]];
// A fix: Claude changes things, renders, checks.
const FIX_STAGES: [string, number][] = [["fix", 0.4], ["render", 0.45], ["check", 0.15]];

const TOOLS = join(ROOT, "src", "autoedit-tools.ts");
// How Claude names the tool belt in a command: its path, or the playbook's $T shortcut.
const BELT = /(?:autoedit-tools\.ts|\$\{?T\}?)/;
const HISTORY = join(ROOT, "work", "autoedit-history.json");
const TIME_LIMIT = 75 * 60_000;

let current: ChildProcess | undefined;
let cancelled = false;
/** Ends a wait for the user (the storyboard) when the edit is stopped. */
let abortWait: ((e: Error) => void) | undefined;

export const autoEditDir = (video: string) => join(workDir(video), "autoedit");
/** The agent's latest session in this folder, written as soon as it starts (a failed edit can be continued). */
export const lastSessionFile = (dir: string) => join(projectPaths(dir).internal, "agent-session");

/** Stops the edit that's running (if any). */
export function cancelAutoEdit() {
  cancelled = true;
  current?.kill("SIGTERM");
  abortWait?.(new Error("Stopped."));
}

/** Waits for the user, unless the edit is stopped first. */
function waitForUser<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((ok, fail) => {
    abortWait = fail;
    p.then(ok, fail);
  }).finally(() => (abortWait = undefined));
}

export const storyboardFile = (dir: string) => join(projectPaths(dir).notes, "storyboard.json");

/** The storyboard's first turn for a recording: decide the edit from the footage and its transcript. */
function fromRecording(dir: string): string {
  return [
    "Read notes/PLAYBOOK.md. This first turn is only the storyboard (section \"Storyboard first\"): call `stage board`, read the notes, look at a few frames, decide the whole edit and write notes/storyboard.json. The user's brief is in notes/brief.md.",
    existsSync(join(dir, "assets", "clips")) ? "The user's own clips are in assets/clips/: look at them and use them where they fit." : "",
    existsSync(join(projectPaths(dir).notes, "reference")) ? "A reference video's frames are in notes/reference/: its style is the look to copy." : "",
    "Then stop and reply with the video's idea in one sentence. Don't cut, download or build anything yet: the user approves the storyboard first.",
  ].filter(Boolean).join("\n");
}

/** The storyboard's first turn for a script: nothing is filmed yet, so the plan comes from the words and the user's assets. */
function fromScript(dir: string): string {
  const assets = existsSync(join(dir, "assets", "clips")) && readdirSync(join(dir, "assets", "clips")).length > 0;
  return [
    "Read notes/PLAYBOOK.md, section \"Storyboard first\". There is no recording yet: notes/script.md is the script as numbered scenes (what will be said, in order) and notes/brief.md is the user's direction. Call `stage board`, then plan the video as a storyboard in notes/storyboard.json, in the playbook's format, with these differences:",
    "- Each numbered scene is exactly one shot, in the same order: scene 1 is shot `s1`, scene 2 is `s2`, and so on. No extra shots, none merged or split. `line` is that scene's words, exactly as written.",
    "- `from`/`to` are where each shot falls in the finished video, in seconds from 0, back to back: each scene gets the time notes/script.md gives it (its words at a natural pace), a little more where the picture needs a beat to land.",
    "- Nothing of the speaker is filmed yet: a shot of them talking is kind \"talking\" with no `source`; say in `why` how to frame it when they film it.",
    assets
      ? "- The user's own assets are in assets/clips/: look at each one (frames with ffmpeg) and use them where they fit, with `source` { \"file\": \"assets/clips/<name>\", \"at\": <seconds> }. Everything else is B-roll to find (`query`), title cards, graphics."
      : "- The user gave no footage: every picture is B-roll to find (`query`), a title card, a graphic, or the speaker on camera.",
    "- Direct it like a director: a hook in the first 2 seconds, a reason to keep watching, a clear ending; motion (`enter`, `to`, `focus`) and sound on every shot that needs them.",
    "Then stop and reply with the video's idea in one sentence. Don't download or build anything: this is the plan for a video not filmed yet.",
  ].join("\n");
}

/**
 * The storyboard step: Claude draws notes/storyboard.json, the user sees it and approves it or asks
 * for changes (Claude redraws, same session), as many rounds as they like. Returns Claude's last turn
 * and the approved storyboard, which is then the plan.
 */
async function storyboard(
  dir: string, review: StoryboardReview, ask: (prompt: string, session?: string) => Promise<Turn>, info: (text: string) => void,
  first = fromRecording(dir), check: (b: Storyboard) => string[] = () => [],
  /** A storyboard drawn before (reopened later): shown as it is, no first turn. */
  start?: { turn: Turn; board: Storyboard },
): Promise<{ turn: Turn; board: Storyboard }> {
  const file = storyboardFile(dir);
  const read = async (turn: Turn): Promise<{ turn: Turn; board: Storyboard }> => {
    for (let attempt = 0; ; attempt++) {
      const parsed = existsSync(file) ? parseStoryboard(readFileSync(file, "utf8")) : { board: undefined, problems: ["notes/storyboard.json wasn't written"] };
      const { board } = parsed;
      const problems = [...parsed.problems, ...(board ? check(board) : [])];
      if (board && (!problems.length || attempt > 0)) return { turn, board };
      if (attempt > 0) throw new Error(`The storyboard couldn't be made: ${problems[0]}`);
      info("Fixing the storyboard");
      turn = await ask(["The storyboard isn't usable yet:", ...problems.map((p) => `- ${p}`), "Fix notes/storyboard.json (the format is in notes/PLAYBOOK.md, \"Storyboard first\") and stop. Don't build anything yet."].join("\n"), turn.session);
    }
  };
  let { turn, board } = start ?? (await read(await ask(first)));
  for (let round = 1; ; round++) {
    info("Storyboard ready: waiting for your OK");
    const answer = await waitForUser(review(board, dir, round));
    writeFileSync(file, JSON.stringify(answer.board, null, 2));
    if (answer.approve) return { turn, board: answer.board };
    info("Redrawing the storyboard");
    ({ turn, board } = await read(await ask(redrawPrompt(answer.board, answer.changes), turn.session)));
  }
}

/** A whole edit from scratch. */
export async function autoEdit(req: AutoEditRequest, emit: (e: AutoEditEvent) => void): Promise<AutoEditResult> {
  cancelled = false;
  const started = Date.now();
  const info = (text: string) => emit({ type: "log", text, kind: "info" });
  // Before every job: which tools work. A broken one is said in one line and its fallback is used.
  const tools = health(true);
  for (const line of healthProblems(tools)) info(`Tools: ${line}`);
  info("Reading the recording (transcript and pauses)");
  const analysis = await analyze(req.video, (m) => info(m.replace(/^analyze: /, "")));
  const dir = autoEditDir(req.video);
  prepare(dir, req, analysis, healthReport(tools));
  if (req.reference) {
    info("Looking at the reference video");
    await prepareReference(dir, req.reference);
  }
  info("Getting the renderer ready");
  try {
    const browser = await ensureBrowser();
    if ("path" in browser) chromeOutsideProtectedFolders(browser.path); // made now, so the agent's renders find it
  } catch (e) {
    // No Remotion browser: the playbook's fallback engines still make the video.
    info(`Tools: Remotion's browser isn't ready (${String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 100)}). Using a fallback engine.`);
    appendFileSync(join(projectPaths(dir).notes, "TOOLS.md"), "\nBROKEN  remotion browser  -> build the video as a HyperFrames project (project/index.html) if hyperframes is OK above.\n");
  }

  let estimate = new Estimate(req.review ? BOARD_STAGES : STAGES, req.review ? 3 * 60_000 : firstEstimate(analysis.duration), started, dir, emit);
  const broker = await startBroker(dir);
  const ask = (prompt: string, session?: string) => claude(dir, req.model, prompt, session, emit, estimate, broker.url);
  try {
    let turn: Turn;
    let building = started;
    if (req.review) {
      // Storyboard first: nothing is built until the user approves how the video will look.
      const board = await storyboard(dir, req.review, ask, info);
      estimate.stop();
      building = Date.now(); // the time it took the user to approve isn't edit time
      estimate = new Estimate(STAGES, firstEstimate(analysis.duration), building, dir, emit);
      turn = await ask([
        "Now make the finished video as an editable project, following notes/PLAYBOOK.md from step 1 (look).",
        approvedPrompt(board.board),
        req.reference ? "Copy the reference video's style (notes/reference/)." : "",
      ].filter(Boolean).join("\n"), board.turn.session);
    } else {
      turn = await ask([
        "Read notes/PLAYBOOK.md and follow it to make the finished video as an editable project. The user's brief is in notes/brief.md.",
        req.reference ? "A reference video's frames are in notes/reference/: copy its style." : "",
      ].join("\n"));
    }
    turn = await ensureRendered(dir, turn, building, emit, ask);
    // A first version is rarely the best one: one review round against a professional bar (and the reference).
    emit({ type: "log", text: "Reviewing the first version like a director", kind: "info" });
    const reviewStart = Date.now();
    await contactSheet(finalFile(dir), join(projectPaths(dir).checks, "review-sheet.jpg"));
    turn = await ask(review(Boolean(req.reference)), turn.session);
    turn = await ensureRendered(dir, turn, reviewStart, emit, ask);
    const result = keepVersion(dir, turn);
    saveHistory(analysis.duration, Date.now() - building, estimate.renderMs);
    return result;
  } finally {
    estimate.stop();
    broker.stop();
  }
}

export type PlanRequest = {
  /** The video's name, if the user gave one. */
  title?: string;
  /** What will be said, in order. */
  script: string;
  /** How they want it: style, mood, audience, length. */
  direction?: string;
  format: Storyboard["format"];
  /** Their own clips, photos and music, to use where they fit. */
  assets: string[];
  model: string;
  review: StoryboardReview;
};

/** Where storyboards made from a script live: work/storyboards/<name>-<time>/. */
export function planDir(title: string): string {
  const slug = title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "storyboard";
  return join(ROOT, "work", "storyboards", `${slug}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
}

/**
 * A storyboard from a script, before anything is filmed: the same storyboard step as a full edit
 * (Claude draws it; the user draws on it, redraws and approves it), made from the words, the
 * direction and the user's own assets. The folder keeps it all: notes/script.md, notes/brief.md,
 * notes/storyboard.json, assets/clips/, and Export/ for its PDF.
 */
export async function planStoryboard(req: PlanRequest, emit: (e: AutoEditEvent) => void, dir = planDir(req.title || req.script.split(/\s+/).slice(0, 6).join(" "))): Promise<{ dir: string; board: Storyboard }> {
  cancelled = false;
  const started = Date.now();
  const info = (text: string) => emit({ type: "log", text, kind: "info" });
  const tools = health(true);
  for (const line of healthProblems(tools)) info(`Tools: ${line}`);
  const p = projectPaths(dir);
  for (const d of [p.notes, p.internal, p.exports]) mkdirSync(d, { recursive: true });
  // One line, one scene: numbered, with the time it takes to say, so the storyboard is shot for scene.
  const scenes = scenesOf(req.script);
  let at = 0;
  const numbered = scenes.map((line, i) => {
    const d = Math.max(1.2, sayingTime(line));
    const row = `${i + 1}. ${line}   (${round(at, 1)}-${round((at += d), 1)} s)`;
    return row;
  });
  writeFileSync(join(p.notes, "script.md"), `# The script\n\nWhat will be said, one scene per line, in order. Nothing is filmed yet. The times are each line's speaking time at a natural pace.\n\n${numbered.join("\n")}\n`);
  writeFileSync(join(p.notes, "brief.md"), `# What the user wants\n\n${req.title?.trim() ? `Title: ${req.title.trim()}\n` : ""}Format: ${req.format}\n\n${req.direction?.trim() || "(no direction given: plan the strongest video for this script and format)"}\n`);
  writeFileSync(join(p.notes, "TOOLS.md"), `# Tools on this Mac, checked just now\n\n\`\`\`\n${healthReport(tools)}\n\`\`\`\n`);
  writeFileSync(join(p.notes, "PLAYBOOK.md"), playbook());
  const assets = req.assets.filter((a) => existsSync(a));
  if (assets.length) {
    const into = join(dir, "assets", "clips");
    mkdirSync(into, { recursive: true });
    const used = new Set<string>();
    for (const a of assets) {
      let name = basename(a).replace(/[^\w.-]+/g, "-");
      while (used.has(name)) name = `x-${name}`;
      used.add(name);
      linkOrCopy(a, join(into, name));
    }
  }
  writeFileSync(join(p.internal, "agent-log.jsonl"), "");
  writeShims(dir);
  info(assets.length ? `Reading your script and ${assets.length} asset${assets.length > 1 ? "s" : ""}` : "Reading your script");
  const estimate = new Estimate(BOARD_STAGES, 2 * 60_000, started, dir, emit);
  const broker = await startBroker(dir);
  const ask = (prompt: string, session?: string) => claude(dir, req.model, prompt, session, emit, estimate, broker.url);
  try {
    writePlanInfo(dir, { title: req.title?.trim() || "", format: req.format, scenes, model: req.model, created: new Date().toISOString() });
    const { board } = await storyboard(dir, req.review, ask, info, fromScript(dir), (b) => checkScenes(b, scenes));
    writePlanInfo(dir, { approved: new Date().toISOString() });
    return { dir, board };
  } finally {
    estimate.stop();
    broker.stop();
  }
}

/** What Creatro keeps about a storyboard made from a script (.creatron/plan.json). */
export type PlanInfo = { title: string; format: Storyboard["format"]; scenes: string[]; model: string; created: string; approved?: string };
const planInfoFile = (dir: string) => join(projectPaths(dir).internal, "plan.json");
export function readPlanInfo(dir: string): Partial<PlanInfo> {
  try {
    return JSON.parse(readFileSync(planInfoFile(dir), "utf8"));
  } catch {
    return {};
  }
}
function writePlanInfo(dir: string, patch: Partial<PlanInfo>) {
  writeFileSync(planInfoFile(dir), JSON.stringify({ ...readPlanInfo(dir), ...patch }, null, 1));
}

/**
 * A storyboard from the Storyboard creator, opened again later: shown as it was saved, with drawing,
 * Redraw and Approve. A redraw goes on in the same Claude session (it remembers the script and why it
 * planned each shot); without one, Claude starts from the folder's notes.
 */
export async function reopenPlan(dir: string, model: string, review: StoryboardReview, emit: (e: AutoEditEvent) => void): Promise<{ dir: string; board: Storyboard }> {
  cancelled = false;
  const info = (text: string) => emit({ type: "log", text, kind: "info" });
  const file = storyboardFile(dir);
  const { board } = existsSync(file) ? parseStoryboard(readFileSync(file, "utf8")) : { board: undefined };
  if (!board) throw new Error("This storyboard's file is missing or can't be read.");
  const saved = existsSync(lastSessionFile(dir)) ? readFileSync(lastSessionFile(dir), "utf8").trim() : "";
  const scenes = readPlanInfo(dir).scenes;
  writeShims(dir);
  const estimate = new Estimate(BOARD_STAGES, 60_000, Date.now(), dir, emit);
  const broker = await startBroker(dir);
  const ask = (prompt: string, session?: string) =>
    claude(dir, model, session || saved ? prompt : `Read notes/PLAYBOOK.md, section "Storyboard first", notes/script.md and notes/brief.md: you planned this storyboard earlier.\n\n${prompt}`, session || saved || undefined, emit, estimate, broker.url);
  try {
    const r = await storyboard(dir, review, ask, info, "", scenes?.length ? (b) => checkScenes(b, scenes) : undefined, { turn: { text: "", session: saved }, board });
    writePlanInfo(dir, { approved: new Date().toISOString() });
    return { dir, board: r.board };
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
  const final = finalFile(dir);
  const pictures = markers.length ? await markerFrames(dir, final, markers) : [];
  const estimate = new Estimate(FIX_STAGES, fixEstimate(), started, dir, emit);
  estimate.stage("fix");
  const broker = await startBroker(dir);
  const ask = (prompt: string, s?: string) => claude(dir, model, prompt, s, emit, estimate, broker.url);
  try {
    let turn = await ask([
      `The user watched the exported video (${relative(dir, final)}) and asks: ${message}`,
      pictures.length ? `\nWhat they're pointing at (Read each image; the red box is the spot they clicked):\n${pictures.join("\n")}` : "",
      "\nMake the change in the editable project (values in project/timeline.json, looks in project/src), re-render with the render command, check what you changed, and reply in 1-2 plain sentences.",
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
    "Creatro's review. Read notes/checks/review-sheet.jpg (16 frames of your exported video, left to right, top to bottom)" +
      (withReference ? " and notes/reference/sheet.jpg (16 frames of the reference)." : "."),
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

/**
 * If Claude stopped without a fresh export, ask it once to finish. Then the editable-output rule:
 * whatever validateProject finds (a baked cut, captions outside timeline.json, a changed source,
 * media from the internet, a missing README...) goes back to Claude to fix, once.
 */
async function ensureRendered(dir: string, turn: Turn, since: number, emit: (e: AutoEditEvent) => void, ask: (prompt: string, session?: string) => Promise<Turn>): Promise<Turn> {
  const final = finalFile(dir);
  const fresh = () => existsSync(final) && statSync(final).mtimeMs > since;
  if (!fresh()) {
    emit({ type: "log", text: "No finished video yet: asking Claude to finish", kind: "info" });
    turn = await ask(`${relative(dir, final)} hasn't been rendered (or wasn't updated). Finish the work: render it with the render command, check it, and reply with your summary.`, turn.session);
    if (!fresh()) throw new Error(`Claude stopped without rendering the video. Its last words: ${turn.text.slice(0, 400)}`);
  }
  const problems = validateProject(dir, { needExport: true });
  if (problems.length) {
    emit({ type: "log", text: `Keeping the result editable: ${problems.length} thing${problems.length > 1 ? "s" : ""} to fix`, kind: "info" });
    turn = await ask(
      ["The video must stay an open project the user can edit by hand (notes/PLAYBOOK.md, \"Editable, always\"). These break that:", ...problems.map((p) => `- ${p}`),
        "Fix every one of them, render again with the render command, and reply with your summary for the user."].join("\n"),
      turn.session,
    );
    const left = validateProject(dir, { needExport: true });
    if (left.length) emit({ type: "log", text: `Still not fully editable: ${left[0]}`, kind: "info" });
  }
  return turn;
}

/** Copies the new export to Export/versions/vN.mp4 so every result stays playable and comparable. */
function keepVersion(dir: string, turn: Turn): AutoEditResult {
  const p = projectPaths(dir);
  mkdirSync(p.versions, { recursive: true });
  const version = readdirSync(p.versions).filter((f) => /^v\d+\.mp4$/.test(f)).length + 1;
  const final = join(p.versions, `v${version}.mp4`);
  copyFileSync(finalFile(dir), final);
  writeFileSync(join(p.internal, "session.json"), JSON.stringify({ session: turn.session, version }));
  return { dir, project: join(dir, "project"), final, session: turn.session, notes: turn.text, version };
}

/**
 * The folder Claude works in: the editable project scaffold (it already renders: the whole
 * recording with captions from the transcript), plus the working notes. A previous Auto Edit
 * of this video is kept as autoedit-<time>.
 */
function prepare(dir: string, req: AutoEditRequest, analysis: Awaited<ReturnType<typeof analyze>>, tools: string) {
  if (existsSync(dir)) renameSync(dir, `${dir}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
  scaffoldProject(dir, { name: projectName(req.video), video: req.video, analysis });
  const { notes, internal } = projectPaths(dir);
  const hasVideo = analysis.width > 0;
  writeFileSync(join(notes, "source.json"), JSON.stringify({ hasVideo, width: analysis.width, height: analysis.height, fps: hasVideo ? analysis.fps : 30, duration: analysis.duration }, null, 1));
  writeFileSync(join(notes, "transcript.md"), describe(analysis));
  writeFileSync(join(notes, "brief.md"), `# What the user wants\n\n${req.brief.trim() || "(nothing specific: make a strong 9:16 social edit of the whole idea)"}\n`);
  if (!hasVideo) appendFileSync(join(notes, "brief.md"), "\nThe recording is AUDIO ONLY: build every picture yourself (B-roll, graphics, captions).\n");
  if (!analysis.words.length) appendFileSync(join(notes, "brief.md"), "\nThere is NO TRANSCRIPT (no speech, or the transcriber isn't working): cut on the pauses and type any captions yourself into project/timeline.json.\n");
  writeFileSync(join(notes, "TOOLS.md"), `# Tools on this Mac, checked just now\n\n\`\`\`\n${tools}\n\`\`\`\n\nBROKEN or FALLBACK lines: don't try that tool, use what the line says instead and carry on. Mention it in one sentence of your summary.\n`);
  writeFileSync(join(notes, "PLAYBOOK.md"), playbook());
  // The user's own clips (their library), linked in so the project stays local and complete.
  const clips = (req.clips ?? []).filter((c) => c !== req.video && existsSync(c));
  if (clips.length) {
    const into = join(dir, "assets", "clips");
    mkdirSync(into, { recursive: true });
    const used = new Set<string>();
    for (const c of clips) {
      let name = basename(c).replace(/[^\w.-]+/g, "-");
      while (used.has(name)) name = `x-${name}`;
      used.add(name);
      linkOrCopy(c, join(into, name));
    }
  }
  writeFileSync(join(internal, "agent-log.jsonl"), "");
  writeShims(dir);
}

/**
 * The wall, on Claude's side: `ffmpeg` and `ffprobe` in its shell are thin wrappers in
 * .creatron/bin (first on its PATH) that start whatever the toolchain found, backup included.
 */
function writeShims(dir: string) {
  const bin = join(projectPaths(dir).internal, "bin");
  mkdirSync(bin, { recursive: true });
  for (const tool of ["ffmpeg", "ffprobe"] as const) {
    const f = find(tool);
    if (!f) continue;
    const env = Object.entries(f.env ?? {}).map(([k, v]) => `export ${k}="${v}"\n`).join("");
    writeFileSync(join(bin, tool), `#!/bin/bash\n# ${tool} through Creatro's toolchain (${f.via})\n${env}exec "${f.cmd}" "$@"\n`, { mode: 0o755 });
  }
}

async function prepareReference(dir: string, reference: string) {
  const out = join(projectPaths(dir).notes, "reference");
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
      `The full file is notes/reference/${basename(join(out, `reference${extname(reference).toLowerCase()}`))}: extract more frames or listen-measure its audio with ffmpeg if useful.`,
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
  const earshot = find("earshot") ? `${find("earshot")!.cmd} -m earshot` : "earshot-not-installed";
  return text.replaceAll("$T", `node ${TOOLS}`).replaceAll("$EARSHOT", earshot);
}

/** The edited frame at each marker with a red box where the user clicked, for Claude to look at. */
async function markerFrames(dir: string, video: string, markers: AutoEditMarker[]): Promise<string[]> {
  mkdirSync(join(dir, "notes", "markers"), { recursive: true });
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-select_streams", "v:0", "-of", "csv=p=0", video]);
  const [w, h] = stdout.trim().split(",").map(Number);
  const out: string[] = [];
  for (const m of markers) {
    const box = Math.round(Math.min(w, h) * 0.14);
    const file = join("notes", "markers", `marker-${m.n}.png`);
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
    HOME: homedir(), USER: process.env.USER ?? "", PATH: `${join(projectPaths(dir).internal, "bin")}:${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin`, LANG: process.env.LANG ?? "en_US.UTF-8", TMPDIR: tmpdir(),
    CREATRON_AUTOEDIT_DIR: dir, CREATRON_ROOT: ROOT, CREATRON_BROKER: broker,
    NUMBA_CACHE_DIR: join(dir, ".cache", "numba"), // earshot's compiled DSP, cached inside the folder
  };
  // Free, like Claude Code at a keyboard: no sandbox, every tool, the internet, your skills and MCP
  // servers (HyperFrames, Remotion, earshot...), and no permission checks. The project rules still
  // hold: validateProject checks the result and sends Claude back until it passes.
  // Only the key files stay unreadable (deny rules apply even with permission checks off).
  const settings = {
    permissions: {
      deny: [`Read(/${join(ROOT, ".env")})`, `Read(/${join(homedir(), ".ssh")}/**)`, `Read(/${join(homedir(), ".aws")}/**)`, `Read(/${join(homedir(), ".claude.json")})`],
    },
  };
  const args = [
    "-p", "--model", model, "--output-format", "stream-json", "--verbose",
    "--dangerously-skip-permissions",
    "--settings", JSON.stringify(settings),
    ...(session ? ["--resume", session] : []),
  ];
  const log = join(projectPaths(dir).internal, "agent-log.jsonl");
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
        if (msg.session_id && msg.session_id !== sessionId) {
          sessionId = msg.session_id;
          // Kept on disk at once: if the edit fails later, the next request continues this session.
          writeFileSync(lastSessionFile(dir), sessionId);
        }
        if (msg.type === "result") result = msg;
        else if (msg.type === "assistant") for (const block of msg.message?.content ?? []) onBlock(block);
      }
    });
    const onBlock = (block: any) => {
      if (block.type === "text" && block.text?.trim()) emit({ type: "log", text: block.text.trim().slice(0, 400), kind: "note" });
      if (block.type !== "tool_use") return;
      // The last `stage` in the command (Claude may chain several steps in one call).
      const stage = [...String(block.input?.command ?? "").matchAll(new RegExp(`${BELT.source}\\s+stage\\s+(\\w+)`, "g"))].at(-1)?.[1];
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
    const tool = cmd.match(new RegExp(`${BELT.source} (\\w+)(?: (\\w+))?(.*)`));
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
// A few past runs are a hint, not the truth: one slow run must not set every guess. History is
// trusted more as runs pile up, and the live pace (Estimate.tick) corrects the guess as steps pass.
function firstEstimate(sourceSeconds: number): number {
  const usual = 8 * 60_000 + sourceSeconds * 4_000;
  // Only finished runs (a render happened). Short clips are mostly fixed overhead, so their
  // per-second time is spread over at least a minute of footage.
  const runs = readHistory().runs.filter((r) => r.renderMs > 0).slice(-8);
  let guess = usual;
  if (runs.length) {
    const perSecond = median(runs.map((r) => Math.max(0, r.ms - 6 * 60_000) / Math.max(r.sourceSeconds, 60)));
    const fromHistory = 6 * 60_000 + perSecond * sourceSeconds;
    const trust = runs.length / (runs.length + 2);
    guess = trust * fromHistory + (1 - trust) * usual;
  }
  return Math.min(Math.max(guess, 8 * 60_000), 35 * 60_000);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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

