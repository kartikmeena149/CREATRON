// cutout: the speaker without their background (Apple Vision, on this Mac).
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readTimeline, writeTimeline } from "../project.ts";
import { FALLBACK, find } from "../toolchain.ts";
import { ROOT, round, run } from "../tools.ts";
import { DIR, P, SOURCE, config, fail } from "./context.ts";

/**
 * The speaker cut out of their background (Apple Vision, on this Mac), as a see-through video
 * in assets/cutouts/speaker.webm. It is made from the SOURCE, for every cut plus half a second
 * on each side, and timeline.json's "cutout" says which source seconds sit where in the file:
 * the Cutout component follows the cuts, so trimming a cut by hand keeps working. A cut moved
 * outside what was covered needs this command again (check says so).
 */
export async function cutout() {
  if (!config.hasVideo) fail("the recording has no picture, so there is nobody to cut out");
  if (!find("swiftc") && !existsSync(join(homedir(), "Library", "Caches", "Creatron", "person-mask"))) fail(`The cutout tool isn't available (no Swift compiler). ${FALLBACK.swiftc.without}.`);
  const helper = join(homedir(), "Library", "Caches", "Creatron", "person-mask");
  if (!existsSync(helper)) {
    console.error("building the person-mask helper (once, about a minute)");
    mkdirSync(join(homedir(), "Library", "Caches", "Creatron"), { recursive: true });
    await run("swiftc", ["-O", join(ROOT, "tools", "person-mask.swift"), "-o", helper]);
  }
  const timeline = readTimeline(DIR);
  const facts = existsSync(P.facts) ? JSON.parse(readFileSync(P.facts, "utf8")) : {};
  const length = Number(facts.duration) || Math.max(...timeline.cuts.map((c) => c.end));
  // Source ranges to cover: each cut with handles, overlapping ones merged.
  const padded = timeline.cuts.map((c) => [Math.max(0, c.start - 0.5), Math.min(length, c.end + 0.5)] as [number, number]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of padded) merged.length && r[0] <= merged.at(-1)![1] ? (merged.at(-1)![1] = Math.max(merged.at(-1)![1], r[1])) : merged.push([...r]);
  // Whole frames, so the file's own timing matches what timeline.json says.
  const fps = timeline.fps;
  const ranges = merged.map(([s, e]) => [Math.floor(s * fps) / fps, Math.ceil(e * fps) / fps] as [number, number]);
  const work = join(P.internal, "cutout");
  mkdirSync(work, { recursive: true });
  // Vision works at any size; 1920 tall is plenty and keeps it quick.
  const small = join(work, "in.mp4");
  const parts = ranges.map(([s, e], i) => `[0:v]trim=${s}:${e},setpts=PTS-STARTPTS,fps=${fps}[v${i}]`);
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", SOURCE,
    "-filter_complex", `${parts.join(";")};${ranges.map((_, i) => `[v${i}]`).join("")}concat=n=${ranges.length}:v=1:a=0,scale=-2:'min(1920,ih)'[v]`,
    "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-an", small,
  ]);
  const mask = join(work, "mask.mp4");
  await run(helper, [small, mask]);
  const file = join("assets", "cutouts", "speaker.webm");
  mkdirSync(join(DIR, "assets", "cutouts"), { recursive: true });
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", small, "-i", mask,
    "-filter_complex", "[1:v]format=gray[m];[0:v][m]alphamerge,format=yuva420p",
    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-b:v", "6M", "-an", join(DIR, file),
  ]);
  rmSync(work, { recursive: true, force: true });
  let at = 0;
  timeline.cutout = { file, ranges: ranges.map(([s, e]) => [round(s, 3), round(e, 3), round((at += e - s) - (e - s), 3)]) };
  writeTimeline(DIR, timeline);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "csv=p=0", join(DIR, file)]);
  console.log(`${file} (${stdout.trim().replace(/\n/g, ", ")}): the speaker with a see-through background, for every cut plus 0.5 s each side.`);
  console.log('Use <Cutout /> from "./creatron/Footage" (it follows the cuts) and keep the sound on <Footage />. Layer it over a designed background.');
}
