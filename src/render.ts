// Step 3: turn an edit plan into a finished video with ffmpeg, on the user's machine.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { drawCues } from "./captions.ts";
import { buildCues, outputDuration } from "./timeline.ts";
import { isIdentity, outputSize, placement } from "./frame.ts";
import { hasOverlay, overlayProps } from "./motion.ts";
import { customDir } from "./customcode.ts";
import { renderOverlay } from "./remotion.ts";
import { mixFilters, prepareAudio, segmentAudio, voiceoverInputs } from "./loudness.ts";
import type { Analysis, EditPlan } from "./schema.ts";
import { checkPlan } from "./schema.ts";
import { run, workDir } from "./tools.ts";
import { effectivePlan } from "./tracks.ts";

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function render(
  plan: EditPlan,
  analysis: Analysis,
  out: string,
  log = console.error,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  // Hidden and muted tracks stay out of the video; higher video tracks go on top.
  plan = effectivePlan(plan);
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
    const zoom =
      s.zoom > 1 ? `,crop=${even(W / s.zoom)}:${even(H / s.zoom)},scale=${W}:${H}:flags=lanczos` : "";
    filters.push(`[${i}:v]scale=${W}:${H},setpts=(PTS-STARTPTS)/${s.speed}${zoom},fps=${fps},setsar=1[v${i}]`);
    pads.push(`[v${i}]`);
    if (analysis.hasAudio) {
      filters.push(segmentAudio(s, i));
      pads.push(`[a${i}]`);
    }
  });
  const n = plan.segments.length;
  filters.push(`${pads.join("")}concat=n=${n}:v=1:a=${analysis.hasAudio ? 1 : 0}[cat]${analysis.hasAudio ? "[acat]" : ""}`);
  filters.push(...frameFilters(plan, W, H, size, fps, total));

  // B-roll on V2: each clip fills the frame for its window; the main video shows again after.
  let videoOut = "[framed]";
  plan.broll.filter((b) => b.file && existsSync(b.file)).forEach((b, k) => {
    const input = args.filter((a) => a === "-i").length;
    args.push("-ss", b.offset.toFixed(3), "-t", b.duration.toFixed(3), "-i", b.file!);
    filters.push(
      `[${input}:v]scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},` +
        `setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS+${b.at.toFixed(3)}/TB[br${k}]`,
      `${videoOut}[br${k}]overlay=eof_action=pass:enable='between(t,${b.at.toFixed(3)},${(b.at + b.duration).toFixed(3)})'[bo${k}]`,
    );
    videoOut = `[bo${k}]`;
  });

  const dir = join(workDir(analysis.source), "render");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Animated captions are drawn by the Remotion layer below; plain ones as pictures here.
  if (plan.captions.enabled && plan.captions.animation === "none" && analysis.words.length) {
    const cues = buildCues(plan, analysis.words);
    log(`render: drawing ${cues.length} captions`);
    const list = drawCues(cues, plan, size.width, size.height, dir, total);
    const input = args.filter((a) => a === "-i").length;
    args.push("-f", "concat", "-safe", "0", "-i", list);
    filters.push(`[${input}:v]format=rgba,setpts=PTS-STARTPTS[caps]`);
    // Captions go on top of everything, B-roll included.
    filters.push(`${videoOut}[caps]overlay=format=auto:shortest=0,format=yuv420p[final]`);
    videoOut = "[final]";
  }
  if (hasOverlay(plan, analysis.words)) {
    // The Remotion layer (animated captions, titles, lower thirds) goes on top of everything.
    log("render: animating text (Remotion)");
    let shown = -1;
    const frames = await renderOverlay(overlayProps(plan, analysis.words, size, fps), join(dir, "motion"), (f) => {
      const pct = Math.floor(f * 20) * 5;
      if (pct !== shown) log(`render: animating text ${(shown = pct)}%`);
    }, customDir(analysis.source));
    const input = args.filter((a) => a === "-i").length;
    args.push("-framerate", String(fps), "-pattern_type", "glob", "-i", frames);
    filters.push(`[${input}:v]format=rgba,setpts=PTS-STARTPTS[motion]`);
    filters.push(`${videoOut}[motion]overlay=format=auto:shortest=0:eof_action=pass,format=yuv420p[moved]`);
    videoOut = "[moved]";
  }
  if (analysis.hasAudio) {
    // Voiceover files come after the segment (and caption) inputs.
    const firstVo = args.filter((a) => a === "-i").length;
    args.push(...voiceoverInputs(plan));
    const { origGainDb, level } = await prepareAudio(plan, analysis, log);
    filters.push(...mixFilters(plan, "[acat]", firstVo, origGainDb));
    filters.push(`[mix]${level},aresample=48000[aout]`);
  }

  args.push("-filter_complex", filters.join(";"), "-map", videoOut);
  if (analysis.hasAudio) args.push("-map", "[aout]", "-c:a", await aacEncoder(), "-b:a", "192k");
  args.push(
    "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-r", String(fps),
    "-movflags", "+faststart", resolve(out),
  );

  log(`render: ${n} segments -> ${total.toFixed(1)}s ${size.width}x${size.height}`);
  // ffmpeg -stats prints "time=00:00:12.34" as it goes; turn that into a 0..1 fraction.
  await run("ffmpeg", args, (chunk) => {
    const m = chunk.match(/time=(\d+):(\d+):([\d.]+)/g)?.at(-1)?.match(/(\d+):(\d+):([\d.]+)/);
    if (m && onProgress) onProgress(Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / total));
  });
  return resolve(out);
}

/** Turns the joined video [cat] into the output frame [framed], placed per plan.transform. */
function frameFilters(
  plan: EditPlan, W: number, H: number, size: { width: number; height: number }, fps: number, total: number,
): string[] {
  const { width: OW, height: OH } = size;
  // Untouched transform: a centered cover crop is all that's needed (and cheapest).
  if (isIdentity(plan.transform)) {
    const k = Math.max(OW / W, OH / H);
    return [`[cat]scale=${even(W * k)}:${even(H * k)}:flags=lanczos,crop=${OW}:${OH},format=yuv420p[framed]`];
  }
  // Otherwise: size the video, rotate it, and place its center on a black frame (bars where it doesn't reach).
  const p = placement(plan, W, H, OW, OH);
  const rad = ((p.rotate * Math.PI) / 180).toFixed(6);
  const rotate = p.rotate ? `,format=rgba,rotate=${rad}:ow='rotw(${rad})':oh='roth(${rad})':c=none` : "";
  return [
    `[cat]scale=${even(p.w)}:${even(p.h)}:flags=lanczos${rotate}[placed]`,
    `color=c=black:s=${OW}x${OH}:r=${fps}:d=${total.toFixed(3)}[bg]`,
    `[bg][placed]overlay=x='${p.cx.toFixed(1)}-overlay_w/2':y='${p.cy.toFixed(1)}-overlay_h/2':shortest=1,format=yuv420p[framed]`,
  ];
}

let aac: Promise<string> | undefined;
/**
 * Apple's AAC encoder (macOS) where available: ffmpeg's built-in one overshoots peaks by up to
 * ~2.5 dB on heavily levelled speech, which clips; Apple's stays within 0.1 dB of the input.
 */
function aacEncoder(): Promise<string> {
  return (aac ??= run("ffmpeg", ["-hide_banner", "-encoders"])
    .then(({ stdout }) => (/\baac_at\b/.test(stdout) ? "aac_at" : "aac"))
    .catch(() => "aac"));
}
