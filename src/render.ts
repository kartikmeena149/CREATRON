// Step 3: turn an edit plan into a finished video with ffmpeg, on the user's machine.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { drawCues } from "./captions.ts";
import { buildCues, clipLength, editDuration, outputDuration } from "./timeline.ts";
import { TRANSITION_TYPES, clipHandles, placedTransitions } from "./transitions.ts";
import { ffExpr } from "./keyframes.ts";
import { cropBox, cropOf, isCropped, isIdentity, outputSize, pictureSize, placement } from "./frame.ts";
import { hasOverlay, overlayProps } from "./motion.ts";
import { sceneLibrary } from "./sceneFiles.ts";
import { customDir } from "./customcode.ts";
import { renderOverlay, renderOverlayStill } from "./remotion.ts";
import { mixFilters, prepareAudio, segmentAudio, voiceoverInputs } from "./loudness.ts";
import type { Analysis, EditPlan } from "./schema.ts";
import { checkPlan } from "./schema.ts";
import { run, workDir } from "./tools.ts";
import { effectivePlan } from "./tracks.ts";
import { DEFAULT_EXPORT, type ExportOptions, encoderArgs, exportSize } from "./exportOptions.ts";
import { personCutout } from "./person.ts";

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function render(
  plan: EditPlan,
  analysis: Analysis,
  out: string,
  log = console.error,
  onProgress?: (fraction: number) => void,
  options: ExportOptions & {
    /**
     * Stills instead of a video: PNG frames of the edit at these output seconds, exactly as the
     * export draws them (no sound), written to `out` as a pattern with %02d, in time order. What
     * the AI looks at to see its own edits.
     */
    stills?: number[];
  } = DEFAULT_EXPORT,
): Promise<string> {
  const stills = options.stills?.length ? [...new Set(options.stills.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b) : undefined;
  // Hidden and muted tracks stay out of the video; higher video tracks go on top.
  plan = effectivePlan(plan);
  // B-roll that plays its own sound joins the mix like a sound effect (it doesn't dip the voice).
  plan = { ...plan, voiceovers: [...plan.voiceovers, ...(await brollAudio(plan))] };
  const problems = checkPlan(plan, analysis);
  if (problems.length) throw new Error(`edit plan does not fit this video:\n- ${problems.join("\n- ")}`);

  // A voice recording as the main track has no picture: it plays over black.
  const picture = analysis.width > 0;
  // Stills are pictures only: no sound to mix or level.
  const sound = analysis.hasAudio && !stills;
  const W = even(pictureSize(analysis).width);
  const H = even(pictureSize(analysis).height);
  // The chosen frame rate and size: captions, text and B-roll are drawn at that size, not scaled up.
  const fps = options.fps;
  const size = exportSize(outputSize(plan, analysis), options.resolution);
  // The edit runs to the end of its last clip: past the main track the picture is black and its
  // sound silent, under whatever B-roll, text or audio is still going.
  const total = editDuration(plan);
  const tail = Math.max(0, total - outputDuration(plan));

  // Transitions play over the cuts without moving anything: each clip's picture runs on past its
  // ends by half of each transition (its handles), read from the recording around the clip.
  const transitions = picture ? placedTransitions(plan) : [];
  const handles = clipHandles(plan);
  const reach = plan.segments.map((s, i) => ({
    before: transitions.length ? Math.min(handles[i].before * s.speed, s.start) : 0,
    after: transitions.length ? Math.min(handles[i].after * s.speed, Math.max(0, analysis.duration - s.end)) : 0,
  }));
  if (transitions.length) log(`render: ${transitions.length} ${transitions.length === 1 ? "transition" : "transitions"}`);

  // One input per kept segment: seeking each one is much faster than trimming a long file.
  const args: string[] = ["-y", "-v", "error", "-stats"];
  plan.segments.forEach((s, i) => args.push("-ss", String(s.start - reach[i].before), "-to", String(s.end + reach[i].after), "-i", analysis.source));

  const filters: string[] = [];
  const apads: string[] = [];
  // Each clip's picture: sized, sped up or slowed, punched in (or painted black when its picture was
  // deleted; its sound stays). The person mask goes through the same steps.
  const segVideo = (s: EditPlan["segments"][number], i: number, input: string, out: string): string[] => {
    const h = handles[i];
    const lead = h.before; // output seconds before the clip's own first frame
    const zoomKeys = s.keys?.zoom?.length ? s.keys.zoom : undefined;
    const head = `${input}scale=${W}:${H},setpts=(PTS-STARTPTS)/${s.speed}`;
    const rest =
      (s.picture === false ? ",drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill" : "") +
      `,fps=${fps},setsar=1` +
      // Past the recording's ends, a transition holds the first or last frame.
      (h.before - reach[i].before / s.speed > 0.001 ? `,tpad=start_mode=clone:start_duration=${(h.before - reach[i].before / s.speed).toFixed(3)}` : "") +
      (h.after - reach[i].after / s.speed > 0.001 ? `,tpad=stop_mode=clone:stop_duration=${(h.after - reach[i].after / s.speed).toFixed(3)}` : "") +
      // The empty gap before the clip (magnet off): black first.
      (s.gap ? `,tpad=start_mode=add:start_duration=${s.gap.toFixed(3)}:color=black` : "") +
      (transitions.length ? ",settb=AVTB" : "");
    if (!zoomKeys) {
      const zoom = s.zoom > 1 ? `,crop=${even(W / s.zoom)}:${even(H / s.zoom)},scale=${W}:${H}:flags=lanczos` : "";
      return [`${head}${zoom}${rest}${out}`];
    }
    // An animated punch-in: the picture grows frame by frame around its middle on a frame-sized canvas.
    const z = ffExpr(zoomKeys, `(t-${lead.toFixed(3)})`, s.zoom, (v) => `max(1,${v})`);
    return [
      `${head},scale=w='trunc(${W}*${z}/2)*2':h='trunc(${H}*${z}/2)*2':eval=frame[zi${out.slice(1, -1)}]`,
      `color=c=black:s=${W}x${H}:r=${fps}[zb${out.slice(1, -1)}]`,
      `[zb${out.slice(1, -1)}][zi${out.slice(1, -1)}]overlay=x='(main_w-overlay_w)/2':y='(main_h-overlay_h)/2':shortest=1${rest}${out}`,
    ];
  };
  // How long each clip's picture runs, handles and gap included.
  const runLength = (i: number) => (plan.segments[i].gap ?? 0) + clipLength(plan.segments[i]) + handles[i].before + handles[i].after;
  // The clips' pictures one after another into [<p>cat0]: joined straight, or crossed over where there's a transition.
  const joinPictures = (labels: string[], p: string): string[] => {
    if (!transitions.length) return [`${labels.join("")}concat=n=${labels.length}:v=1:a=0[${p}cat0]`];
    const out: string[] = [];
    const into = new Map(transitions.map((t) => [t.index, t]));
    // Runs of clips with no transition between them are joined first.
    const runs: { from: number; to: number }[] = [];
    labels.forEach((_, i) => (i === 0 || into.has(i) ? runs.push({ from: i, to: i }) : (runs.at(-1)!.to = i)));
    let acc = "";
    let length = 0;
    runs.forEach((r, k) => {
      const name = `[${p}run${k}]`;
      const n = r.to - r.from + 1;
      out.push(n === 1 ? `${labels[r.from]}null${name}` : `${labels.slice(r.from, r.to + 1).join("")}concat=n=${n}:v=1:a=0${name}`);
      let len = 0;
      for (let i = r.from; i <= r.to; i++) len += runLength(i);
      if (!acc) return void ((acc = name), (length = len));
      const t = into.get(r.from)!;
      const next = `[${p}x${k}]`;
      out.push(`${acc}${name}xfade=transition=${TRANSITION_TYPES[t.type].xfade}:duration=${t.duration.toFixed(3)}:offset=${Math.max(0, length - t.duration).toFixed(3)}${next}`);
      acc = next;
      length += len - t.duration;
    });
    out.push(`${acc}null[${p}cat0]`);
    return out;
  };
  const vpads: string[] = [];
  plan.segments.forEach((s, i) => {
    if (picture) {
      filters.push(...segVideo(s, i, `[${i}:v]`, `[v${i}]`));
      vpads.push(`[v${i}]`);
    }
    if (sound) {
      filters.push(segmentAudio(s, i, transitions.length ? reach[i].before : undefined));
      apads.push(`[a${i}]`);
    }
  });
  const n = plan.segments.length;
  if (sound) filters.push(`${apads.join("")}concat=n=${n}:v=0:a=1[acat0]`);
  if (picture) {
    filters.push(...joinPictures(vpads, ""));
    filters.push(tail > 0.01 ? `[cat0]tpad=stop_mode=add:stop_duration=${tail.toFixed(3)}:color=black[cat]` : "[cat0]null[cat]");
  } else filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${total.toFixed(3)},format=yuv420p[cat]`);
  if (sound) filters.push(tail > 0.01 ? `[acat0]apad=pad_dur=${tail.toFixed(3)}[acat]` : "[acat0]anull[acat]");
  filters.push(...frameFilters(plan, W, H, size, fps, total));

  // "Behind me" captions: the person is cut out of the framed main video (Apple Vision mask, sent
  // through the same cuts, speed, zoom and framing) and laid back over the captions while they show.
  // Animations set to go behind the person use the same cut-out, while they show.
  const behind = !picture ? [] : [
    ...(plan.captions.enabled ? buildCues(plan, analysis.words).filter((c) => c.look.behind) : []),
    ...plan.motion.filter((m) => m.behind && !m.hidden).map((m) => ({ start: m.at, end: m.at + m.duration })),
  ];
  let videoOut = "[framed]";
  if (behind.length) {
    log("render: cutting you out for the text behind you");
    const { mask } = await personCutout(analysis.source, log);
    filters.push("[framed]split[framedmain][framedperson]");
    videoOut = "[framedmain]";
    const mpads = plan.segments.map((s, i) => {
      const input = args.filter((a) => a === "-i").length;
      args.push("-ss", String(s.start - reach[i].before), "-to", String(s.end + reach[i].after), "-i", mask);
      filters.push(...segVideo(s, i, `[${input}:v]`, `[mkc${i}]`), `[mkc${i}]format=gray[mk${i}]`);
      return `[mk${i}]`;
    });
    filters.push(...joinPictures(mpads, "m"));
    filters.push(tail > 0.01 ? `[mcat0]tpad=stop_mode=add:stop_duration=${tail.toFixed(3)}:color=black[mcat]` : "[mcat0]null[mcat]");
    filters.push(...frameFilters(plan, W, H, size, fps, total, "m"));
    filters.push("[mframed]format=gray[mgray]", "[framedperson][mgray]alphamerge,format=yuva420p[person]");
  }

  // B-roll on V2: each clip fills the frame for its window; the main video shows again after.
  plan.broll.filter((b) => b.file && existsSync(b.file)).forEach((b, k) => {
    const input = args.filter((a) => a === "-i").length;
    // A photo is held as a still for the clip's length; a video plays from its offset. -itsoffset
    // tells ffmpeg when the clip starts, so it reads the inputs in time order: without it every clip
    // looks like it starts at 0, gets read up front, and with many clips the queues fill and the
    // render freezes.
    const offset = ["-itsoffset", b.at.toFixed(3)];
    if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(b.file!)) args.push("-loop", "1", "-framerate", String(fps), "-t", b.duration.toFixed(3), ...offset, "-i", b.file!);
    else args.push("-ss", b.offset.toFixed(3), "-t", b.duration.toFixed(3), ...offset, "-i", b.file!);
    // Its size and place in the frame (placeBox): the frame-covering size times its scale, its middle
    // shifted by x / y; whatever falls outside the frame is cut off by the overlay. Keyframed
    // properties change frame by frame (t is the edit's clock, so the clip's own time is t - at).
    const keys = b.keys ?? {};
    const at = b.at.toFixed(3);
    // Animated size: drawn at its largest first, then shrunk frame by frame from there.
    const s = keys.scale?.length ? Math.max(0.05, ...keys.scale.map((k) => k.v)) : (b.scale ?? 1);
    const ox = `(main_w-overlay_w)/2+(${ffExpr(keys.x, `(t-${at})`, b.x ?? 0)})*${size.width}`;
    const oy = `(main_h-overlay_h)/2+(${ffExpr(keys.y, `(t-${at})`, b.y ?? 0)})*${size.height}`;
    const rad = ((b.rotate ?? 0) * Math.PI / 180).toFixed(6);
    // Turned around its middle (the corners outside stay see-through); overlay keeps that middle in place.
    // An animated turn first gets a see-through border wide enough that every pixel it draws comes
    // from inside the picture: the rotate filter leaves old pixels where it would fill instead.
    const turn = keys.rotate?.length
      ? "format=rgba,pad=w='ceil(hypot(iw,ih)*1.415/2)*2':h='ceil(hypot(iw,ih)*1.415/2)*2':x='(ow-iw)/2':y='(oh-ih)/2':color=black@0," +
        `rotate='(${ffExpr(keys.rotate, "t", 0)})*PI/180':ow='trunc(iw/1.414/2)*2':oh='trunc(iw/1.414/2)*2':c=none,`
      : b.rotate ? `format=rgba,rotate=${rad}:ow='rotw(${rad})':oh='roth(${rad})':c=none,` : "";
    const opacity = keys.opacity?.length
      ? `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${ffExpr(keys.opacity, "T", 1)},0,1)',`
      : (b.opacity ?? 1) < 1 ? `format=rgba,colorchannelmixer=aa=${(b.opacity ?? 1).toFixed(3)},` : "";
    const grow = keys.scale?.length
      ? `,scale=w='max(2,trunc(iw*(${ffExpr(keys.scale, "t", s)})/${s}/2)*2)':h='max(2,trunc(ih*(${ffExpr(keys.scale, "t", s)})/${s}/2)*2)':eval=frame`
      : "";
    filters.push(
      `[${input}:v]setpts=PTS-STARTPTS,scale=${Math.round(size.width * s)}:${Math.round(size.height * s)}:force_original_aspect_ratio=increase:force_divisible_by=2,` +
        `${turn}${opacity}format=yuva420p,setsar=1${grow},fps=${fps},setpts=PTS-STARTPTS+${at}/TB[br${k}]`,
      `${videoOut}[br${k}]overlay=x='${ox}':y='${oy}':eof_action=pass:enable='between(t,${at},${(b.at + b.duration).toFixed(3)})'[bo${k}]`,
    );
    videoOut = `[bo${k}]`;
  });

  // Its own folder for stills, so looking never disturbs an export running at the same time.
  const dir = join(workDir(analysis.source), stills ? "look-render" : "render");
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
  if (hasOverlay(plan, analysis.words) && stills) {
    // Stills: the Remotion layer drawn only at those moments, each laid on its own frame.
    log(`render: drawing ${stills.length} frames of the animated layer`);
    const props = overlayProps(plan, analysis.words, size, fps, await sceneLibrary(plan));
    for (const [k, t] of stills.entries()) {
      const file = join(dir, `layer-${k}.png`);
      await renderOverlayStill(props, Math.round(t * fps), file, customDir(analysis.source));
      const input = args.filter((a) => a === "-i").length;
      args.push("-loop", "1", "-framerate", String(fps), "-t", total.toFixed(3), "-i", file);
      filters.push(`[${input}:v]format=rgba,setpts=PTS-STARTPTS[still${k}]`);
      filters.push(`${videoOut}[still${k}]overlay=format=auto:shortest=0:eof_action=pass:enable='${frameAt(t, fps)}',format=yuv420p[stilled${k}]`);
      videoOut = `[stilled${k}]`;
    }
  } else if (hasOverlay(plan, analysis.words)) {
    // The Remotion layer (animated captions, titles, lower thirds) goes on top of everything.
    log("render: animating text (Remotion)");
    let shown = -1;
    const frames = await renderOverlay(overlayProps(plan, analysis.words, size, fps, await sceneLibrary(plan)), join(dir, "motion"), (f) => {
      const pct = Math.floor(f * 20) * 5;
      if (pct !== shown) log(`render: animating text ${(shown = pct)}%`);
    }, customDir(analysis.source));
    // The frames become one video (with its see-through parts) before the render. Read as a PNG
    // sequence inside the big render, ffmpeg froze partway through edits with many cuts, B-roll and
    // sounds; as a video it doesn't, and the render runs about 10× faster.
    const layer = join(dir, "motion.mov");
    await run("ffmpeg", ["-y", "-v", "error", "-framerate", String(fps), "-pattern_type", "glob", "-i", frames, "-c:v", "qtrle", layer]);
    const input = args.filter((a) => a === "-i").length;
    args.push("-i", layer);
    filters.push(`[${input}:v]format=rgba,setpts=PTS-STARTPTS[motion]`);
    filters.push(`${videoOut}[motion]overlay=format=auto:shortest=0:eof_action=pass,format=yuv420p[moved]`);
    videoOut = "[moved]";
  }
  if (behind.length) {
    // The person on top of the captions and the text layer, only while something "behind me" shows.
    const when = behind.map((c) => `between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})`).join("+");
    filters.push(`${videoOut}[person]overlay=format=auto:enable='${when}',format=yuv420p[behindout]`);
    videoOut = "[behindout]";
  }
  if (sound) {
    // Voiceover files come after the segment (and caption) inputs.
    const firstVo = args.filter((a) => a === "-i").length;
    args.push(...voiceoverInputs(plan));
    const { origGainDb, level } = await prepareAudio(plan, analysis, log);
    filters.push(...mixFilters(plan, "[acat]", firstVo, origGainDb));
    filters.push(`[mix]${level},aresample=48000[aout]`);
  }

  if (stills) {
    // Only the frames at those moments, as pictures.
    filters.push(`${videoOut}select='${stills.map((t) => frameAt(t, fps)).join("+")}'[picked]`);
    args.push("-filter_complex", filters.join(";"), "-map", "[picked]", "-fps_mode", "passthrough", "-frames:v", String(stills.length), resolve(out));
  } else {
    args.push("-filter_complex", filters.join(";"), "-map", videoOut);
    if (sound) args.push("-map", "[aout]", "-c:a", await aacEncoder(), "-b:a", "192k");
    args.push(
      "-t", total.toFixed(3),
      ...encoderArgs(options), "-r", String(fps),
      "-movflags", "+faststart", resolve(out),
    );
  }

  log(`render: ${n} segments -> ${total.toFixed(1)}s ${size.width}x${size.height}`);
  // ffmpeg -stats prints "time=00:00:12.34" as it goes; turn that into a 0..1 fraction.
  await run("ffmpeg", args, (chunk) => {
    const m = chunk.match(/time=(\d+):(\d+):([\d.]+)/g)?.at(-1)?.match(/(\d+):(\d+):([\d.]+)/);
    if (m && onProgress) onProgress(Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / total));
  });
  // The sound on its own as well, next to the video.
  if (options.mp3 && sound) {
    log("render: saving the sound as mp3");
    await run("ffmpeg", ["-y", "-v", "error", "-i", resolve(out), "-vn", "-c:a", "libmp3lame", "-b:a", "192k", resolve(out).replace(/\.mp4$/i, "") + ".mp3"]);
  }
  return resolve(out);
}

/** An ffmpeg expression true on the one frame at output second t. */
const frameAt = (t: number, fps: number) => `between(t,${(t - 0.5 / fps).toFixed(4)},${(t + 0.5 / fps - 0.0001).toFixed(4)})`;

/** Turns the joined video [cat] into the output frame [framed], placed per plan.transform (labels prefixed with p_). */
function frameFilters(
  plan: EditPlan, W: number, H: number, size: { width: number; height: number }, fps: number, total: number, p_ = "",
): string[] {
  const { width: OW, height: OH } = size;
  // Untouched transform: a centered cover crop is all that's needed (and cheapest).
  if (isIdentity(plan.transform)) {
    const k = Math.max(OW / W, OH / H);
    return [`[${p_}cat]scale=${even(W * k)}:${even(H * k)}:flags=lanczos,crop=${OW}:${OH},format=yuv420p[${p_}framed]`];
  }
  // Otherwise: size the video, rotate it, and place its center on a black frame (bars where it doesn't reach).
  const p = placement(plan, W, H, OW, OH);
  const rad = ((p.rotate * Math.PI) / 180).toFixed(6);
  const rotate = p.rotate ? `,format=rgba,rotate=${rad}:ow='rotw(${rad})':oh='roth(${rad})':c=none` : "";
  // Mirrored first, then the edges cut (the crop is of the picture as you see it), then turned.
  const sw = even(p.w);
  const sh = even(p.h);
  const c = cropOf(plan.transform);
  const flip = plan.transform.flip ? ",hflip" : "";
  const crop = isCropped(plan.transform)
    ? `,crop=${even(sw * (1 - c.left - c.right))}:${even(sh * (1 - c.top - c.bottom))}:${Math.round(sw * c.left)}:${Math.round(sh * c.top)}`
    : "";
  const kept = cropBox(p, c);
  return [
    `[${p_}cat]scale=${sw}:${sh}:flags=lanczos${flip}${crop}${rotate}[${p_}placed]`,
    `color=c=black:s=${OW}x${OH}:r=${fps}:d=${total.toFixed(3)}[${p_}bg]`,
    `[${p_}bg][${p_}placed]overlay=x='${kept.cx.toFixed(1)}-overlay_w/2':y='${kept.cy.toFixed(1)}-overlay_h/2':shortest=1,format=yuv420p[${p_}framed]`,
  ];
}

/** Audio clips for the B-roll clips that play their sound (files without an audio track are skipped). */
async function brollAudio(plan: EditPlan): Promise<EditPlan["voiceovers"]> {
  const out: EditPlan["voiceovers"] = [];
  for (const b of plan.broll) {
    if (b.muted || !b.file || !existsSync(b.file)) continue;
    const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", b.file]);
    if (!stdout.trim()) continue;
    out.push({ id: `broll-${b.id}`, kind: "sfx", track: 1, file: b.file, text: "", voice: "", at: b.at, offset: b.offset, duration: b.duration, volumeDb: 0 });
  }
  return out;
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
