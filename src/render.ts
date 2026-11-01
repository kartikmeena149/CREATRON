// Step 3: turn an edit plan into a finished video with ffmpeg, on the user's machine.
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildCues, drawCues, outputDuration } from "./captions.ts";
import type { Analysis, EditPlan } from "./schema.ts";
import { checkPlan } from "./schema.ts";
import { run, workDir } from "./tools.ts";

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output frame size for an aspect, capped so the long side is at most 1920. */
export function outputSize(plan: EditPlan, a: Analysis): { width: number; height: number } {
  if (plan.aspect === "9:16") return { width: 1080, height: 1920 };
  if (plan.aspect === "1:1") return { width: 1080, height: 1080 };
  if (plan.aspect === "16:9") return { width: 1920, height: 1080 };
  const scale = Math.min(1, 1920 / Math.max(a.width, a.height));
  return { width: even(a.width * scale), height: even(a.height * scale) };
}

export async function render(plan: EditPlan, analysis: Analysis, out: string, log = console.error): Promise<string> {
  const problems = checkPlan(plan, analysis);
  if (problems.length) throw new Error(`edit plan does not fit this video:\n- ${problems.join("\n- ")}`);

  const W = even(analysis.width);
  const H = even(analysis.height);
  const fps = analysis.fps;
  const size = outputSize(plan, analysis);
  const total = outputDuration(plan);

  // One input per kept segment: seeking each one is much faster than trimming a long file.
  const args: string[] = ["-y", "-v", "error", "-stats"];
  for (const s of plan.segments) args.push("-ss", String(s.start), "-to", String(s.end), "-i", analysis.source);

  const filters: string[] = [];
  const pads: string[] = [];
  plan.segments.forEach((s, i) => {
    const dur = (s.end - s.start) / s.speed;
    const zoom =
      s.zoom > 1 ? `,crop=${even(W / s.zoom)}:${even(H / s.zoom)},scale=${W}:${H}:flags=lanczos` : "";
    filters.push(`[${i}:v]scale=${W}:${H},setpts=(PTS-STARTPTS)/${s.speed}${zoom},fps=${fps},setsar=1[v${i}]`);
    pads.push(`[v${i}]`);
    if (analysis.hasAudio) {
      // 10 ms fades at every cut so joins don't click.
      const fadeOut = Math.max(dur - 0.01, 0).toFixed(3);
      filters.push(
        `[${i}:a]asetpts=PTS-STARTPTS,atempo=${s.speed},afade=t=in:d=0.01,afade=t=out:st=${fadeOut}:d=0.01,aresample=48000[a${i}]`,
      );
      pads.push(`[a${i}]`);
    }
  });
  const n = plan.segments.length;
  filters.push(`${pads.join("")}concat=n=${n}:v=1:a=${analysis.hasAudio ? 1 : 0}[cat]${analysis.hasAudio ? "[acat]" : ""}`);
  filters.push(`[cat]${reframe(plan, W, H)}scale=${size.width}:${size.height}:flags=lanczos,format=yuv420p[framed]`);

  let videoOut = "[framed]";
  const dir = join(workDir(analysis.source), "render");
  if (plan.captions.enabled && analysis.words.length) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const cues = buildCues(plan, analysis.words);
    log(`render: drawing ${cues.length} captions`);
    const list = drawCues(cues, plan, size.width, size.height, dir, total);
    args.push("-f", "concat", "-safe", "0", "-i", list);
    filters.push(`[${n}:v]format=rgba,setpts=PTS-STARTPTS[caps]`);
    filters.push(`[framed][caps]overlay=format=auto:shortest=0,format=yuv420p[final]`);
    videoOut = "[final]";
  }
  if (analysis.hasAudio) filters.push(`[acat]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);

  args.push("-filter_complex", filters.join(";"), "-map", videoOut);
  if (analysis.hasAudio) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  args.push(
    "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-r", String(fps),
    "-movflags", "+faststart", resolve(out),
  );

  log(`render: ${n} segments -> ${total.toFixed(1)}s ${size.width}x${size.height}`);
  await run("ffmpeg", args);
  return resolve(out);
}

/** Crop the source to the target aspect around plan.reframeX. Empty when no crop is needed. */
function reframe(plan: EditPlan, W: number, H: number): string {
  if (plan.aspect === "source") return "";
  const [aw, ah] = plan.aspect.split(":").map(Number);
  const target = aw / ah;
  if (Math.abs(W / H - target) < 0.01) return "";
  if (W / H > target) {
    const cw = even(H * target);
    return `crop=${cw}:${H}:${Math.round((W - cw) * plan.reframeX)}:0,`;
  }
  const ch = even(W / target);
  return `crop=${W}:${ch}:0:${Math.round((H - ch) / 2)},`;
}
