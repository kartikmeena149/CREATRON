// "Behind me" captions: where the person is in each frame of the main video, found on this Mac
// with Apple Vision (tools/person-mask.swift). Made once per video and cached next to its analysis:
// mask.mp4 (white = person) for the export, cutout.webm (the person on a see-through background)
// for the live preview, which plays it over the caption.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ROOT, run, workDir } from "./tools.ts";

const HELPER = join(homedir(), "Library", "Caches", "Creatron", "person-mask");

export async function personCutout(source: string, log: (m: string) => void = () => {}): Promise<{ mask: string; cutout: string }> {
  const dir = join(workDir(source), "person");
  const mask = join(dir, "mask.mp4");
  const cutout = join(dir, "cutout.webm");
  if (existsSync(mask) && existsSync(cutout)) return { mask, cutout };
  mkdirSync(dir, { recursive: true });
  if (!existsSync(HELPER)) {
    log("setting up person detection (once, about a minute)");
    mkdirSync(join(homedir(), "Library", "Caches", "Creatron"), { recursive: true });
    try {
      await run("swiftc", ["-O", join(ROOT, "tools", "person-mask.swift"), "-o", HELPER]);
    } catch (e) {
      throw new Error(`Couldn't set up person detection (it needs Apple's command line tools: run xcode-select --install). ${e instanceof Error ? e.message : e}`);
    }
  }
  // Vision works at any size; 1280 tall keeps it quick and is plenty for an edge around a person.
  const small = join(dir, "in.mp4");
  log("finding you in the video");
  await run("ffmpeg", ["-y", "-v", "error", "-i", source, "-vf", "scale=-2:'min(1280,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", small]);
  await run(HELPER, [small, mask]);
  log("making the cutout");
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", small, "-i", mask,
    "-filter_complex", "[1:v]format=gray[m];[0:v][m]alphamerge,format=yuva420p",
    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-b:v", "4M", "-an", cutout,
  ]);
  rmSync(small, { force: true });
  return { mask, cutout };
}
