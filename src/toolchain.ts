// The wall between Creatron's brain and the tools on this Mac.
//
// The brain (the AI and the editing code) decides WHAT should happen. Tools only do it. Every
// tool sits behind one thin wrapper here, and this file is the only place that knows where a
// tool lives, whether it works, and what to use when it doesn't. tools.ts `run()` sends every
// known tool name through `find()`, so no other file starts a tool directly.
//
// A broken tool never ends a job: `find()` falls back where a backup exists, and `health()` and
// `routing()` say in one line each what works now and what each job will use instead.
// Design and the full fallback table: docs/WORKFLOW.md.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const ROOT = process.env.CREATRON_ROOT || resolve(import.meta.dirname, "..");

export type ToolName = "ffmpeg" | "ffprobe" | "whisper" | "remotion" | "hyperframes" | "yt-dlp" | "earshot" | "swiftc";
export const TOOL_NAMES: ToolName[] = ["ffmpeg", "ffprobe", "whisper", "remotion", "hyperframes", "yt-dlp", "earshot", "swiftc"];

/** How to start a tool: the program, arguments that go first, and extra environment. */
export type Found = {
  cmd: string;
  pre: string[];
  env?: Record<string, string>;
  /** Where it comes from, in plain words ("Homebrew", "bundled with Remotion"). */
  via: string;
  /** True when this is not the first choice. */
  backup: boolean;
  /** For whisper: the model file. */
  model?: string;
};

// The app opened from the Finder gets a short PATH, so the usual install folders are looked in too.
const EXTRA_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", join(homedir(), ".local", "bin")];

function which(name: string): string | undefined {
  const dirs = [...(process.env.PATH ?? "").split(delimiter).filter(Boolean), ...EXTRA_DIRS];
  for (const d of dirs) if (existsSync(join(d, name))) return join(d, name);
  return undefined;
}

/**
 * For tests: CREATRON_BREAK="ffmpeg,yt-dlp" pretends the first choice of those tools is missing
 * (the backup is still used); "ffmpeg:all" pretends every choice is missing.
 */
function broken(tool: ToolName): "no" | "first" | "all" {
  for (const entry of (process.env.CREATRON_BREAK ?? "").split(",").map((s) => s.trim())) {
    if (entry === tool) return "first";
    if (entry === `${tool}:all`) return "all";
  }
  return "no";
}

/** ffmpeg and ffprobe that ship inside Remotion (fewer filters than Homebrew's, enough to cut and encode). */
function bundledFf(name: "ffmpeg" | "ffprobe"): Found | undefined {
  const dir = join(ROOT, "node_modules", "@remotion", `compositor-${process.platform}-${process.arch}`);
  const cmd = join(dir, name);
  if (!existsSync(cmd)) return undefined;
  return { cmd, pre: [], env: { DYLD_LIBRARY_PATH: dir, LD_LIBRARY_PATH: dir }, via: "bundled with Remotion (fewer filters)", backup: true };
}

const WHISPER_MODEL_DIRS = () => [join(ROOT, "models"), join(homedir(), ".cache", "hyperframes", "whisper", "models"), join(homedir(), ".cache", "whisper.cpp"), "/opt/homebrew/share/whisper-cpp"];

/** The Whisper model to use: the one asked for, else small.en, else any model on this Mac. */
export function whisperModelFile(): { file: string; backup: boolean } | undefined {
  const asked = process.env.CREATRON_WHISPER_MODEL;
  if (asked && existsSync(asked)) return { file: asked, backup: false };
  for (const d of WHISPER_MODEL_DIRS()) if (existsSync(join(d, "ggml-small.en.bin"))) return { file: join(d, "ggml-small.en.bin"), backup: false };
  for (const d of WHISPER_MODEL_DIRS()) {
    if (!existsSync(d)) continue;
    const other = readdirSync(d).filter((f) => /^ggml-.*\.bin$/.test(f)).sort((a, b) => Number(/\.en\./.test(b)) - Number(/\.en\./.test(a)))[0];
    if (other) return { file: join(d, other), backup: true };
  }
  return undefined;
}

/** The HyperFrames CLI: the one inside the Claude plugin, else a copy npx already downloaded. Never downloads. */
function hyperframesCli(): Found | undefined {
  const node = which("node") ?? process.execPath;
  const plugins = join(homedir(), ".claude", "plugins", "cache", "hyperframes", "hyperframes");
  if (existsSync(plugins)) {
    const versions = readdirSync(plugins).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse();
    for (const v of versions) {
      const cli = join(plugins, v, "skills", "hyperframes", "scripts", "plugin-cli.mjs");
      if (existsSync(cli)) return { cmd: node, pre: [cli], via: `Claude plugin ${v}`, backup: false };
    }
  }
  const npx = join(homedir(), ".npm", "_npx");
  if (existsSync(npx))
    for (const d of readdirSync(npx)) {
      const bin = join(npx, d, "node_modules", ".bin", "hyperframes");
      if (existsSync(bin)) return { cmd: bin, pre: [], via: "npx cache", backup: true };
    }
  return undefined;
}

function candidates(tool: ToolName): (Found | undefined)[] {
  const onMac = (name: string, via = "on this Mac"): Found | undefined => {
    const cmd = which(name);
    return cmd ? { cmd, pre: [], via: cmd.startsWith("/opt/homebrew") || cmd.startsWith("/usr/local") ? "Homebrew" : via, backup: false } : undefined;
  };
  switch (tool) {
    case "ffmpeg":
    case "ffprobe":
      return [onMac(tool), bundledFf(tool)];
    case "whisper": {
      const cli = which("whisper-cli");
      const model = whisperModelFile();
      return [cli && model ? { cmd: cli, pre: [], via: `whisper.cpp + ${model.file.split("/").pop()}`, backup: model.backup, model: model.file } : undefined];
    }
    case "remotion": {
      const ok = existsSync(join(ROOT, "node_modules", "@remotion", "renderer")) && existsSync(join(ROOT, "node_modules", "@remotion", "bundler"));
      return [ok ? { cmd: "", pre: [], via: "inside Creatron", backup: false } : undefined];
    }
    case "hyperframes":
      return [hyperframesCli()];
    case "yt-dlp":
      return [onMac("yt-dlp")];
    case "earshot": {
      const python = process.env.EARSHOT_PYTHON || join(homedir(), "Developer", "earshot", ".venv", "bin", "python");
      return [existsSync(python) ? { cmd: python, pre: ["-m", "earshot"], via: dirname(dirname(dirname(python))), backup: false } : undefined];
    }
    case "swiftc":
      return [onMac("swiftc", "Xcode tools")];
  }
}

const cache = new Map<ToolName, Found | undefined>();

/** Forget what was found (a tool was installed, or a test changed CREATRON_BREAK). */
export function refreshTools() {
  cache.clear();
  healthCache = undefined;
}

/** How to start a tool now: the first choice that exists, else its backup, else undefined. */
export function find(tool: ToolName): Found | undefined {
  if (cache.has(tool)) return cache.get(tool);
  const state = broken(tool);
  const list = candidates(tool).filter((c): c is Found => Boolean(c));
  const usable = state === "all" ? [] : state === "first" ? list.slice(1).map((c) => ({ ...c, backup: true })) : list;
  const found = usable[0];
  cache.set(tool, found);
  return found;
}

/** What each tool is for and what happens without it: the fallback table, as data. */
export const FALLBACK: Record<ToolName, { job: string; backup: string; without: string }> = {
  ffmpeg: { job: "cut, encode, measure sound", backup: "the ffmpeg bundled with Remotion", without: "nothing can be cut or exported: this is the one tool with no way round" },
  ffprobe: { job: "read a file's size, length and tracks", backup: "the ffprobe bundled with Remotion", without: "files can't be read" },
  whisper: { job: "transcribe speech", backup: "another Whisper model on this Mac, then HyperFrames' transcriber", without: "no transcript: captions are typed by hand and cuts follow the pauses only" },
  remotion: { job: "build and render the video", backup: "a HyperFrames project, then Creatron's own edit plan (ffmpeg)", without: "the video is built as an edit plan on the timeline" },
  hyperframes: { job: "second engine for building and rendering", backup: "Remotion", without: "Remotion does everything" },
  "yt-dlp": { job: "download web videos and Creative Commons music", backup: "stock clips (Pixabay) and Wikimedia files", without: "no web videos: stock clips and the files you add" },
  earshot: { job: "sound-effect bank and listening checks", backup: "sound effects made with ffmpeg, loudness from ffmpeg's meters", without: "simple ffmpeg sound effects" },
  swiftc: { job: "cut the speaker out of the background", backup: "none", without: "no cutout: the speaker is shown as a card or split screen" },
};

/** Thrown when a tool is needed and neither it nor a backup works. One plain line. */
export class ToolMissing extends Error {
  tool: ToolName;
  constructor(tool: ToolName) {
    super(`${tool} isn't working on this Mac. Without it: ${FALLBACK[tool].without}.`);
    this.tool = tool;
  }
}

/** Like find, but a missing tool is an error that says what happens without it. */
export function need(tool: ToolName): Found {
  const f = find(tool);
  if (!f) throw new ToolMissing(tool);
  return f;
}

/** The tool a command name belongs to, for run() ("whisper-cli" → whisper). */
export function toolOf(cmd: string): ToolName | undefined {
  if (cmd === "whisper-cli") return "whisper";
  return (TOOL_NAMES as string[]).includes(cmd) && cmd !== "remotion" && cmd !== "hyperframes" && cmd !== "earshot" ? (cmd as ToolName) : undefined;
}

export type Health = { tool: ToolName; ok: boolean; backup: boolean; using: string; note: string };

let healthCache: { at: number; list: Health[] } | undefined;

/**
 * Which tools work right now. Each one is really started once (its version or help), so a tool
 * that exists but crashes counts as broken. Kept for a minute: call it before every job.
 */
export function health(fresh = false): Health[] {
  if (!fresh && healthCache && Date.now() - healthCache.at < 60_000) return healthCache.list;
  if (fresh) cache.clear();
  const list = TOOL_NAMES.map((tool): Health => {
    let f = find(tool);
    let ok = Boolean(f);
    if (f && f.cmd) {
      const probe = tool === "ffmpeg" || tool === "ffprobe" ? ["-version"] : tool === "whisper" ? ["--help"] : tool === "earshot" ? ["--help"] : ["--version"];
      const starts = (c: Found) => spawnSync(c.cmd, [...c.pre, ...probe], { env: { ...process.env, ...c.env }, timeout: 20_000, stdio: "ignore" }).status === 0;
      ok = starts(f);
      if (!ok) {
        // It exists but doesn't start: try the next choice, and remember it for run().
        const next = candidates(tool).filter((c): c is Found => Boolean(c) && c!.cmd !== f!.cmd)[0];
        if (next && starts(next)) {
          f = { ...next, backup: true };
          cache.set(tool, f);
          ok = true;
        } else cache.set(tool, undefined);
      }
    }
    const fb = FALLBACK[tool];
    return {
      tool,
      ok,
      backup: ok && f!.backup,
      using: ok ? f!.via : "missing",
      note: ok ? (f!.backup ? "first choice isn't working, this is the backup" : "") : `not working. Instead: ${fb.without}`,
    };
  });
  healthCache = { at: Date.now(), list };
  return list;
}

/** One job per line: which tool does it now, or what replaces it. First working choice wins. */
export function routing(list = health()): { job: string; using: string; fallback: boolean }[] {
  const ok = (t: ToolName) => list.find((h) => h.tool === t)?.ok ?? false;
  const backup = (t: ToolName) => list.find((h) => h.tool === t)?.backup ?? false;
  const pick = (job: string, options: [works: boolean, label: string][]) => {
    const i = options.findIndex(([works]) => works);
    return { job, using: options[Math.max(i, 0)][1], fallback: i !== 0 };
  };
  return [
    pick("cut, encode, loudness", [
      [ok("ffmpeg") && !backup("ffmpeg"), "ffmpeg"],
      [ok("ffmpeg"), "ffmpeg bundled with Remotion (basic cuts and encodes only)"],
      [true, "NOTHING: ffmpeg is the one tool Creatron can't work without"],
    ]),
    pick("transcribe speech", [
      [ok("whisper") && !backup("whisper"), "whisper.cpp (small.en)"],
      [ok("whisper"), "whisper.cpp with another model"],
      [ok("hyperframes"), "HyperFrames' transcriber"],
      [true, "no transcript: captions typed by hand, cuts from pauses"],
    ]),
    pick("build and render the video", [
      [ok("remotion"), "Remotion project (project/src, values in project/timeline.json)"],
      [ok("hyperframes"), "HyperFrames project (project/index.html)"],
      [true, "Creatron edit plan on the timeline (rendered with ffmpeg)"],
    ]),
    pick("web videos and music", [
      [ok("yt-dlp"), "yt-dlp"],
      [true, "stock clips and Wikimedia only (no YouTube)"],
    ]),
    pick("sound effects", [
      [ok("earshot"), "earshot's sound bank"],
      [true, "simple sound effects made with ffmpeg"],
    ]),
    pick("speaker cutout", [
      [ok("swiftc"), "Apple Vision (tools/person-mask.swift)"],
      [true, "no cutout: speaker as a card or split screen"],
    ]),
  ];
}

/** The health check as text: for the terminal (`creatron doctor`) and for the AI's folder (TOOLS.md). */
export function healthReport(list = health()): string {
  const lines = ["TOOLS"];
  for (const h of list) lines.push(`${h.ok ? (h.backup ? "BACKUP" : "OK    ") : "BROKEN"}  ${h.tool.padEnd(12)} ${h.using}${h.note ? `  (${h.note})` : ""}`);
  lines.push("", "WHAT EACH JOB USES NOW");
  for (const r of routing(list)) lines.push(`${r.fallback ? "FALLBACK" : "        "}  ${r.job.padEnd(28)} -> ${r.using}`);
  return lines.join("\n");
}

/** One plain line per thing that isn't on its first choice, for progress logs. Empty when all is well. */
export function healthProblems(list = health()): string[] {
  return list.filter((h) => !h.ok || h.backup).map((h) => (h.ok ? `${h.tool}: ${h.note}.` : `${h.tool} isn't working. Instead: ${FALLBACK[h.tool].without}.`));
}
