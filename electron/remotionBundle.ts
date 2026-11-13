// A Claude edit made with Remotion, built so a hidden window can play it frame by frame
// (sceneImport.ts). Bundled with Creatro's own Remotion, React and fonts, so a project needn't
// have its node_modules installed, and with the media stand-ins (motion/import/) that show which
// file each video plays. The project's files are never changed.
import { bundle } from "@remotion/bundler";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { ROOT } from "../src/tools.ts";

export type RemotionProject = { root: string; entry: string };

/** The Remotion project a path is in (its folder, or any file inside it), with the file that calls registerRoot. */
export function remotionProject(path: string): RemotionProject | undefined {
  if (!existsSync(path)) return undefined;
  let dir = statSync(path).isDirectory() ? path : dirname(path);
  for (let up = 0; up < 4; up++, dir = dirname(dir)) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg) && /"remotion"\s*:/.test(readFileSync(pkg, "utf8"))) {
      const entry = findEntry(dir);
      return entry ? { root: dir, entry } : undefined;
    }
    if (dir === dirname(dir)) break;
  }
  return undefined;
}

function findEntry(root: string): string | undefined {
  // remotion.config.ts may name it; otherwise src/index.* (Remotion's default), otherwise any file calling registerRoot.
  const config = ["remotion.config.ts", "remotion.config.js"].map((f) => join(root, f)).find(existsSync);
  const named = config && /setEntryPoint\(\s*["'`]([^"'`]+)/.exec(readFileSync(config, "utf8"))?.[1];
  if (named && existsSync(join(root, named))) return join(root, named);
  const src = join(root, "src");
  for (const f of ["index.ts", "index.tsx", "index.js", "index.jsx"]) if (existsSync(join(src, f))) return join(src, f);
  if (!existsSync(src)) return undefined;
  return readdirSync(src)
    .filter((f) => /\.[jt]sx?$/.test(f))
    .map((f) => join(src, f))
    .find((f) => readFileSync(f, "utf8").includes("registerRoot("));
}

/** Changes whenever any of the project's code changes (public/ is served live, not bundled). */
function codeVersion(root: string): string {
  const stamp = (d: string): number[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.name === "node_modules" || e.name === "public" || e.name === "out" || e.name.startsWith(".") ? []
      : e.isDirectory() ? stamp(join(d, e.name))
      : /\.(tsx?|jsx?|json|css)$/.test(extname(e.name)) ? [statSync(join(d, e.name)).mtimeMs] : []);
  const all = stamp(root);
  return `${all.length}-${Math.max(0, ...all)}`;
}

const built = new Map<string, Promise<string>>();

/**
 * The bundle's folder (index.html + code), with `head` (the page setup) put first in its <head>.
 * Rebuilt only when the project's code changes. public/ isn't copied: the import serves it.
 */
export function remotionBundle(project: RemotionProject, head: string): Promise<string> {
  const key = `${project.entry}|${codeVersion(project.root)}`;
  let out = built.get(key);
  if (!out) {
    const empty = join(tmpdir(), "creatron-empty-public");
    mkdirSync(empty, { recursive: true });
    const mods = join(ROOT, "node_modules");
    out = bundle({
      entryPoint: project.entry,
      publicDir: empty,
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          // The stand-ins first: Remotion's own `remotion` alias would otherwise win (aliases match in order).
          alias: {
            remotion$: join(ROOT, "motion", "import", "remotion.ts"),
            "@remotion/media$": join(ROOT, "motion", "import", "remotion-media.ts"),
            ...Object.fromEntries(Object.entries((config.resolve?.alias ?? {}) as Record<string, string>).filter(([k]) => k !== "remotion")),
          },
          // Creatro's packages first (Remotion's must all be one version); the project's own for anything else.
          modules: [mods, join(project.root, "node_modules"), "node_modules"],
        },
      }),
    }).then((dir) => {
      const index = join(dir, "index.html");
      writeFileSync(index, readFileSync(index, "utf8").replace(/<head>/i, (m) => `${m}\n${head}`));
      return dir;
    });
    out.catch(() => built.delete(key)); // try building again next time
    built.set(key, out);
  }
  return out;
}
