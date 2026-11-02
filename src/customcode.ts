// Animations the AI writes for a project live in work/<video>/agent/custom/<Name>.tsx (one
// component per PascalCase file; helpers may sit in custom/lib/). This compiles them for the
// app's live preview (esbuild, a few ms) and writes the entry Remotion's bundler uses to export.
import { build } from "esbuild";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, workDir } from "./tools.ts";

export const agentDir = (source: string) => join(workDir(source), "agent");
export const customDir = (source: string) => join(agentDir(source), "custom");

/** The component files: custom/<Name>.tsx with a PascalCase name. */
export function customFiles(dir: string): { name: string; file: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[A-Z][A-Za-z0-9]*\.tsx$/.test(f))
    .map((f) => ({ name: f.replace(/\.tsx$/, ""), file: join(dir, f) }));
}

/** Changes whenever any custom file changes, so compiled code and bundles are reused until then. */
export function customVersion(dir: string): string {
  if (!existsSync(dir)) return "none";
  const stamp = (d: string): number[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? stamp(join(d, e.name)) : [statSync(join(d, e.name)).mtimeMs]));
  return `${stamp(dir).length}-${Math.max(0, ...stamp(dir))}`;
}

export type Compiled = { version: string; code: Record<string, string>; errors: string[] };
const compiled = new Map<string, Compiled>();

/**
 * Each component as CommonJS for the preview, with react / remotion left as imports the app
 * provides (so there's one copy of each). errors lists anything that didn't compile.
 */
export async function compileCustom(dir: string): Promise<Compiled> {
  const version = customVersion(dir);
  const hit = compiled.get(dir);
  if (hit?.version === version) return hit;
  const code: Record<string, string> = {};
  const errors: string[] = [];
  for (const { name, file } of customFiles(dir)) {
    try {
      const out = await build({
        entryPoints: [file],
        bundle: true,
        write: false,
        format: "cjs",
        platform: "browser",
        jsx: "automatic",
        target: "es2022",
        logLevel: "silent",
        external: ["react", "react/jsx-runtime", "react-dom", "remotion"],
      });
      code[name] = out.outputFiles[0].text;
    } catch (e: any) {
      const msgs = (e?.errors ?? []).map((m: any) => `${name}.tsx${m.location ? `:${m.location.line}` : ""}: ${m.text}`);
      errors.push(...(msgs.length ? msgs : [`${name}.tsx: ${e?.message ?? e}`]));
    }
  }
  const result = { version, code, errors };
  compiled.set(dir, result);
  return result;
}

/** Writes agent/entry.tsx: registers the custom components and the normal Remotion root. */
export function writeCustomEntry(dir: string): string {
  const files = customFiles(dir);
  const entry = join(dir, "..", "entry.tsx");
  const lines = [
    "// Written by Creatron for the export: the project's custom animations, then the Remotion root.",
    `import { registerCustom } from ${JSON.stringify(join(ROOT, "motion", "custom.ts"))};`,
    ...files.map((f, i) => `import C${i} from ${JSON.stringify(`./custom/${f.name}.tsx`)};`),
    `import { registerRoot } from "remotion";`,
    `import { Root } from ${JSON.stringify(join(ROOT, "motion", "Root.tsx"))};`,
    `registerCustom({ ${files.map((f, i) => `${f.name}: C${i}`).join(", ")} });`,
    "registerRoot(Root);",
  ];
  writeFileSync(entry, `${lines.join("\n")}\n`);
  return entry;
}
