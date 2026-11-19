// The Mac the render runs on: how much memory is free right now, what a render may use, and where
// Remotion's Chrome may run from. No Remotion or webpack here, so anything can import it cheaply.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { freemem, homedir, totalmem } from "node:os";
import { basename, dirname, join, relative } from "node:path";

const GB = 2 ** 30;

/** The smallest media cache Remotion accepts (240 MB); anything less stops the render with an error. */
export const MIN_MEDIA_CACHE = 256 * 2 ** 20;

/**
 * The memory other work could take right now without the Mac running out. macOS keeps this as a
 * percentage (the number Activity Monitor's memory pressure is drawn from); Node's own freemem()
 * counts only untouched pages there and reads close to zero on a healthy Mac.
 */
export function freeMemory(): number {
  if (process.platform === "darwin") {
    const r = spawnSync("/usr/sbin/sysctl", ["-n", "kern.memorystatus_level"], { encoding: "utf8", timeout: 2000 });
    const percent = Number(r.stdout);
    if (r.status === 0 && percent > 0 && percent <= 100) return (percent / 100) * totalmem();
    return totalmem() / 4; // can't tell: assume little
  }
  return process.availableMemory?.() ?? freemem();
}

/**
 * What a render may use right now. Each worker is a Chrome tab with its own decoder and frame
 * cache, so workers and caches are sized from the memory that is free at this moment, not from
 * what the Mac has: a render started while Chrome and other apps are open slows down instead of
 * pushing the Mac out of memory. 1.5 GB always stays with the rest of the Mac.
 */
export function renderBudget(maxWorkers: number, workerGB = 1) {
  const free = freeMemory();
  const spare = Math.max(0, free - 1.5 * GB);
  const cap = Math.max(1, Math.min(maxWorkers, Math.floor((totalmem() / GB) * (3 / 8) / workerGB)));
  const workers = Math.max(1, Math.min(cap, Math.floor(spare / (workerGB * GB))));
  const within = (n: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, n)));
  return {
    workers,
    /** True when even one worker is more than what is spare: the render goes on, as lightly as it can. */
    tight: spare < workerGB * GB,
    freeGB: free / GB,
    /** Each tab's own cache of decoded frames (Remotion's default is half the memory, per tab). */
    mediaCache: within(spare / workers / 3, MIN_MEDIA_CACHE, 512 * 2 ** 20),
    /** The shared decoder's cache, for the videos that fall back to it. */
    offthreadCache: within(spare / 6, 128 * 2 ** 20, 512 * 2 ** 20),
  };
}

/**
 * Creatro's own temporary files: ~/Library/Caches/Creatron/<parts>. Outside the Desktop, so a synced
 * folder (Google Drive, iCloud) never uploads them or keeps copies of them, and macOS may clear it
 * when the disk runs low.
 */
export function scratchDir(...parts: string[]): string {
  return join(homedir(), "Library", "Caches", "Creatron", ...parts);
}

/**
 * macOS guards Desktop, Documents and Downloads: when the app is the one asking, Chrome's helper
 * processes may not read their own files there and crash ("icudtl.dat not found", "Target closed").
 * So Creatro runs a copy of Remotion's Chrome from ~/Library/Caches/Creatron, made once.
 */
export function chromeOutsideProtectedFolders(exe: string): string {
  const cache = scratchDir();
  if (process.platform !== "darwin" || !relative(cache, exe).startsWith("..")) return exe;
  const folder = dirname(exe);
  // Named by the folder and the build's time, so a newer Remotion Chrome gets a fresh copy.
  const target = join(cache, `${basename(folder)}-${Math.round(statSync(exe).mtimeMs)}`);
  const copy = join(target, basename(exe));
  if (!existsSync(copy)) {
    mkdirSync(cache, { recursive: true });
    const part = `${target}.part`; // a half-finished copy never looks like a finished one
    rmSync(part, { recursive: true, force: true });
    cpSync(folder, part, { recursive: true, verbatimSymlinks: true });
    renameSync(part, target);
  }
  return copy;
}
