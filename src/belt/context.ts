// What every tool-belt command shares: the project folder it works on, its paths and timeline,
// and the two ways a command ends badly (a clear one-line error). Nothing here starts a tool.
import { existsSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { projectPaths, readTimeline } from "../project.ts";

export function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const dir = process.env.CREATRON_AUTOEDIT_DIR;
if (!dir || !existsSync(projectPaths(dir).timeline)) fail("this isn't a Creatro project folder (no project/timeline.json). Set CREATRON_AUTOEDIT_DIR, or use: creatron project <command> <folder>");

/** The project folder. Everything a command reads or writes is inside it. */
export const DIR: string = dir;
export const P = projectPaths(DIR);
/** The timeline as it was when the command started (commands that change it read it again). */
export const config = readTimeline(DIR);
/** The original recording (source/...). Read, never written. */
export const SOURCE = join(DIR, config.source);

/** A path inside the folder, from a name the agent gave. Anything pointing outside is refused. */
export function inside(...parts: string[]): string {
  const p = resolve(DIR, ...parts);
  if (relative(DIR, p).startsWith("..")) fail(`${parts.join("/")} is outside the project folder`);
  return p;
}

export const safeName = (name: string) => basename(name).replace(/[^\w.-]+/g, "-");
export const rel = (p: string) => relative(DIR, p);
export const firstLine = (e: unknown, max = 120) => String(e instanceof Error ? e.message : e).split("\n")[0]!.slice(0, max);
