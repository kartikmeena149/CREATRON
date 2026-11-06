// The imported Claude edits a plan uses, and Creatron's font library, read from disk for the
// export (and the AI's frame checks), with a local server their files load from. The app's preview reads
// them through the main process instead (load-scene).
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { assetPrefix } from "./fileServer.ts";
import { fontsDir, libraryFonts } from "./fontLibrary.ts";
import type { SceneLibrary } from "./motion.ts";
import type { Scene } from "./scene.ts";
import type { EditPlan } from "./schema.ts";

export async function sceneLibrary(plan: EditPlan): Promise<SceneLibrary | undefined> {
  const files = [...new Set(plan.motion.filter((m) => m.template === "scene" && m.scene).map((m) => m.scene!))].filter((f) => existsSync(f));
  const fonts = libraryFonts();
  if (!files.length && !fonts.length) return undefined;
  const scenes = Object.fromEntries(files.map((f) => [f, JSON.parse(readFileSync(f, "utf8")) as Scene]));
  // Files the user swapped into a scene (a replaced clip) are served too.
  const swapped = plan.motion.flatMap((m) => Object.values(m.layers ?? {}).flatMap((e) => (e.src?.startsWith("/") ? [dirname(e.src)] : [])));
  return { scenes, fonts, prefix: await assetPrefix([...files.map(dirname), fontsDir(), ...swapped]) };
}
