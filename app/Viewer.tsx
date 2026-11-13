// The program monitor: plays the edit live from the original file, no render needed.
// Cuts are jumps between source ranges, speed is playbackRate, zoom is a CSS scale,
// reframing is object-fit/position (the same crop the renderer does), captions are DOM text,
// and voice tweaks run through Web Audio.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaptionOverlay } from "./CaptionOverlay.tsx";
import { CaptionToolbar } from "./CaptionToolbar.tsx";
import { cropBox, cropOf, isIdentity, pictureSize, placeBox, placement } from "../src/frame.ts";
import { buildCues, clipStarts, editDuration, outputDuration } from "../src/timeline.ts";
import { MotionPreview } from "./MotionPreview.tsx";
import { locate, useEditor } from "./store.ts";
import { isImage, mediaUrl, timecode } from "./format.ts";
import type { Broll, Voiceover } from "../src/schema.ts";
import { effectivePlan, trackSetting } from "../src/tracks.ts";

export function Viewer() {
  const { project, plan, time, playing, seek, setPlaying, markers, pointing, busy, status } = useEditor();
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
  // Where the frame sits in the stage: selection boxes are drawn on a layer there, so their corner
  // handles aren't cut off at the frame's edge.
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const mainEnd = outputDuration(plan);
  const a = project?.analysis;

  const ratio = useMemo(() => {
    if (!a) return 16 / 9;
    if (plan.aspect === "source") return pictureSize(a).width / pictureSize(a).height;
    const [w, h] = plan.aspect.split(":").map(Number);
    return w / h;
  }, [a, plan.aspect]);

  useEffect(() => {
    if (!frame.current) return;
    const ro = new ResizeObserver(([e]) => setFrameSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(frame.current);
    return () => ro.disconnect();
  }, [project]);

  // Paused: keep the picture on the frame under the playhead.
  const { index, offset } = locate(plan, time);
  const seg = plan.segments[index];
  // In the empty gap before a clip (magnet off): black and silent, like the export.
  const inGap = Boolean(seg) && time < offset - 0.001;
  useEffect(() => {
    const v = video.current;
    if (!v || playing || !seg) return;
    const target = seg.start + (time - offset) * seg.speed;
    if (Math.abs(v.currentTime - target) > 0.02) v.currentTime = target;
  }, [time, playing, seg, offset]);

  // Playing: follow the video clock and hop to the next kept range at every cut. After the main
  // track ends (when other clips run longer), a wall clock moves the playhead over black.
  useEffect(() => {
    const v = video.current;
    if (!v || !playing) return;
    const mainEnd = outputDuration(plan);
    const end = editDuration(plan);
    if (end <= 0) return setPlaying(false);
    let raf = 0;
    let i = 0;
    let clock: { t0: number; at: number } | null = null;
    let until: number | null = null; // while the clock runs over a gap: when the next clip starts
    const starts = clipStarts(plan);
    const runClock = (at: number) => {
      v.pause();
      clock = { t0: performance.now(), at };
    };
    const from = useEditor.getState().time >= end - 0.05 ? 0 : useEditor.getState().time;
    if (from >= mainEnd - 0.01) runClock(from);
    else {
      const loc = locate(plan, from);
      i = loc.index;
      const s = plan.segments[i];
      if (from < loc.offset) runClock(from), (until = loc.offset);
      else {
        v.currentTime = s.start + (from - loc.offset) * s.speed;
        v.playbackRate = s.speed;
        v.play().catch(() => setPlaying(false));
      }
    }
    const tick = () => {
      if (clock) {
        const t = clock.at + (performance.now() - clock.t0) / 1000;
        // Through a gap: the clip after it starts when the clock reaches it.
        if (until !== null && t >= until) {
          clock = null;
          until = null;
          v.currentTime = plan.segments[i].start;
          v.playbackRate = plan.segments[i].speed;
          v.play().catch(() => setPlaying(false));
          raf = requestAnimationFrame(tick);
          return;
        }
        if (t >= end) return seek(end), setPlaying(false);
        seek(t);
        raf = requestAnimationFrame(tick);
        return;
      }
      const s = plan.segments[i];
      if (v.currentTime >= s.end - 0.01) {
        if (i + 1 >= plan.segments.length) {
          if (end > mainEnd + 0.05) {
            runClock(mainEnd);
            raf = requestAnimationFrame(tick);
            return;
          }
          v.pause();
          seek(end);
          setPlaying(false);
          return;
        }
        i += 1;
        // A gap before the next clip: run the clock over it, black and silent.
        if (plan.segments[i].gap) {
          runClock(starts[i] - plan.segments[i].gap!);
          until = starts[i];
          raf = requestAnimationFrame(tick);
          return;
        }
        v.currentTime = plan.segments[i].start;
        v.playbackRate = plan.segments[i].speed;
      }
      const cur = plan.segments[i];
      seek(starts[i] + Math.max(0, v.currentTime - cur.start) / cur.speed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      v.pause();
    };
    // Restart the loop when the edit changes mid-play so it follows the new cuts.
  }, [playing, plan]);

  // What plays: hidden and muted tracks left out, like the export.
  const shown = useMemo(() => effectivePlan(plan), [plan]);
  // While a voiceover plays, dip the original like the export does (music and SFX don't).
  const underVoiceover = shown.voiceovers.some((v) => (v.kind ?? "voice") === "voice" && time >= v.at && time < v.at + v.duration);
  // The clip under the playhead sets its own volume (1 = as recorded, 0 = muted), and Track 1 can be muted.
  const clipVolume = trackSetting(plan, "video:1").muted || seg?.sound === false || inGap ? 0 : (seg?.volume ?? 1);
  useVoicePreview(video, plan.audio, (underVoiceover && plan.audio.duckDb < 0 ? 10 ** (plan.audio.duckDb / 20) : 1) * clipVolume);
  useVoiceoverPlayback(shown.voiceovers, time, playing);

  const cues = useMemo(() => (a && plan.captions.enabled ? buildCues(plan, a.words) : []), [a, plan]);
  const cue = cues.find((c) => time >= c.start && time < c.end);
  const cutoutUrl = useEditor((s) => s.cutoutUrl);
  // Text behind me: a caption, or an animation, set to go behind the person.
  const behindMotion = shown.motion.filter((m) => m.behind && !m.hidden);
  const behind = Boolean(cue?.look.behind) || behindMotion.some((m) => time >= m.at && time < m.at + m.duration);
  // Make (or load the cached) person cutout once.
  const anyBehind = cues.some((c) => c.look.behind) || behindMotion.length > 0;
  useEffect(() => void (anyBehind && !cutoutUrl && useEditor.getState().prepareCutout()), [anyBehind, cutoutUrl]);
  const place = placement(plan, a ? pictureSize(a).width : 16, a ? pictureSize(a).height : 9, frameSize.w, frameSize.h);
  const mainSelected = useEditor((s) => s.selected !== null && s.selectedPart === "picture" && s.selectedBroll === null) && Boolean(a?.width);
  // The crop cuts the picture's own edges (as a clip on its box, like the export's crop filter).
  const crop = cropOf(plan.transform);
  const clip = crop.left || crop.top || crop.right || crop.bottom
    ? `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)` : undefined;
  const [guides, setGuides] = useState({ x: false, y: false });

  /**
   * Where a move lands after snapping: the kept part's middle within SNAP px of the frame's centre
   * lines goes onto them, and an unturned picture's edges within SNAP px of the frame's edges go
   * onto those. Says which centre line it snapped to, for the guides.
   */
  const snapMove = (start: typeof plan, x: number, y: number) => {
    const SNAP = 6;
    const W = frameSize.w;
    const H = frameSize.h;
    const base = placement({ ...start, transform: { ...start.transform, x: 0, y: 0 } }, pictureSize(a!).width, pictureSize(a!).height, W, H);
    const kept0 = cropBox(base, cropOf(start.transform)); // where the kept part is with no shift
    const offX = kept0.cx - W / 2;
    const offY = kept0.cy - H / 2;
    let cx = false;
    let cy = false;
    const midX = W / 2 + x * W + offX;
    const midY = H / 2 + y * H + offY;
    if (Math.abs(midX - W / 2) < SNAP) (x = -offX / W), (cx = true);
    else if (!start.transform.rotate) {
      for (const edge of [midX - kept0.w / 2, midX + kept0.w / 2 - W])
        if (Math.abs(edge) < SNAP) { x -= edge / W; break; }
    }
    if (Math.abs(midY - H / 2) < SNAP) (y = -offY / H), (cy = true);
    else if (!start.transform.rotate) {
      for (const edge of [midY - kept0.h / 2, midY + kept0.h / 2 - H])
        if (Math.abs(edge) < SNAP) { y -= edge / H; break; }
    }
    return { x, y, cx, cy };
  };

  // Drag the picture to move it, like in a phone editor. One undo step per drag.
  const [dragging, setDragging] = useState(false);
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 || !frameSize.w) return;
    useEditor.getState().selectCue(null); // clicking the picture (not a caption) closes the caption's style bar
    const { checkpoint, live } = useEditor.getState();
    const start = useEditor.getState().plan;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
        moved = true;
        checkpoint();
        setDragging(true);
      }
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      let x = clamp(start.transform.x + (ev.clientX - x0) / frameSize.w);
      let y = clamp(start.transform.y + (ev.clientY - y0) / frameSize.h);
      // Snapping (hold ⌘ to place freely): the kept part's middle onto the frame's centre lines and,
      // when the picture isn't turned, its edges onto the frame's edges.
      const snapped = snapMove(start, x, y);
      if (!ev.metaKey) (x = snapped.x), (y = snapped.y);
      setGuides(ev.metaKey ? { x: false, y: false } : { x: snapped.cx, y: snapped.cy });
      live({ ...start, transform: { ...start.transform, x, y } });
    };
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      setGuides({ x: false, y: false });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  // Moving or sizing a picture shows all of it, like a pro editor: what falls outside the frame
  // stays visible under a dark veil, so you can see where it is. The export only keeps the frame.
  const brollSelected = useEditor((s) => s.selectedBroll !== null);
  const reveal = (mainSelected && time < mainEnd) || dragging || brollSelected;

  if (!project) return <div className="viewer" />;
  return (
    <div className="viewer">
      <div className="viewer-stage" ref={stage}>
        <div
          className={`viewer-frame ${dragging ? "dragging" : ""} ${reveal ? "reveal" : ""}`}
          ref={frame}
          style={{ aspectRatio: String(ratio) }}
          onPointerDown={startDrag}
          title="Drag to move the video"
        >
          {/* Same placement math as the export. The box clips the per-clip punch-in like the renderer's crop. */}
          <div
            className="video-box"
            style={{
              // Past the end of the main track, or where a clip's picture was deleted, the picture is
              // black (its sound still plays), like the export.
              visibility: time >= mainEnd || seg?.picture === false || inGap ? "hidden" : undefined,
              width: place.w,
              height: place.h,
              left: place.cx - place.w / 2,
              top: place.cy - place.h / 2,
              transform: place.rotate ? `rotate(${place.rotate}deg)` : undefined,
              clipPath: clip,
            }}
          >
            <video
              ref={video}
              src={project.videoUrl}
              crossOrigin="anonymous"
              preload="auto"
              style={{ transform: pictureTransform(seg?.zoom ?? 1, plan.transform.flip) }}
            />
          </div>
          <BrollLayer broll={shown.broll} time={time} playing={playing} frame={frameSize} overlay={overlay} />
          {reveal && <div className="frame-veil" aria-hidden="true" />}
          {guides.x && <div className="snap-guide v" />}
          {guides.y && <div className="snap-guide h" />}
          {/* The main video's box while its clip is selected: corners resize it, dragging moves it. */}
          {mainSelected && time < mainEnd && frameSize.w > 0 && overlay && (
            <SizeBox overlay={overlay} place={place} frame={frameSize} t={plan.transform} moving={dragging} cropping
              onStart={() => useEditor.getState().checkpoint()}
              onChange={(t) => {
                const s = useEditor.getState();
                const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
                s.live({ ...s.plan, transform: { ...s.plan.transform, scale: clamp(t.scale, 0.1, 3), x: clamp(t.x, -1, 1), y: clamp(t.y, -1, 1), rotate: t.rotate, ...(t.crop ? { crop: t.crop } : {}) } });
              }} />
          )}
          {/* Animated captions are drawn by the Remotion layer; the caption here is then an invisible
              box in the same place, so they can still be picked, dragged and edited. */}
          {cue && frameSize.w > 0 && <CaptionOverlay key={cue.index} cue={cue} frame={frameSize} ghost={plan.captions.animation !== "none"} />}
          <MotionPreview />
          {/* "Behind me": the person, cut out, drawn over the caption (same place and zoom as the video). */}
          {cutoutUrl && (
            <div
              className="video-box cutout-box"
              style={{
                visibility: behind && time < mainEnd && seg?.picture !== false && !inGap ? "visible" : "hidden",
                width: place.w,
                height: place.h,
                left: place.cx - place.w / 2,
                top: place.cy - place.h / 2,
                transform: place.rotate ? `rotate(${place.rotate}deg)` : undefined,
                clipPath: clip,
              }}
            >
              <CutoutVideo url={cutoutUrl} main={video} zoom={seg?.zoom ?? 1} flip={plan.transform.flip} />
            </div>
          )}
          {/* Markers near the playhead (all of them while pointing), numbered like in the AI box. */}
          {markers
            .filter((m) => pointing || Math.abs(m.time - time) < 0.4)
            .map((m) => (
              <div key={m.n} className="marker-pin" style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }} title={`Marker ${m.n} at ${timecode(m.time)}`}>
                {m.n}
              </div>
            ))}
          {busy && (
            <div className="stage-status"><span className="mini-spin" /> {status || "Thinking"}</div>
          )}
          {pointing && <div className="stage-status point">Click the video to drop a marker for the AI</div>}
          {pointing && (
            <div
              className="point-catcher"
              onPointerDown={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                const s = useEditor.getState();
                s.setPlaying(false);
                s.addMarker({ time: s.time, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
              }}
            />
          )}
        </div>
        <div className="frame-overlay" ref={setOverlay}
          style={frame.current ? { left: frame.current.offsetLeft, top: frame.current.offsetTop, width: frameSize.w, height: frameSize.h } : undefined} />
        {mainSelected && !isIdentity(plan.transform) && (
          <button className="viewer-reset" title="Put the picture back: no move, size, turn, crop or flip"
            onClick={() => { const s = useEditor.getState(); s.commit({ ...s.plan, transform: { scale: 1, x: 0, y: 0, rotate: 0 } }); }}>
            ↺ Reset
          </button>
        )}
        <CaptionToolbar stage={stage} />
      </div>
    </div>
  );
}

/** The see-through person, kept on the same frame as the main video (it plays muted alongside it). */
function CutoutVideo({ url, main, zoom, flip }: { url: string; main: React.RefObject<HTMLVideoElement | null>; zoom: number; flip?: boolean }) {
  const el = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let raf = 0;
    const sync = () => {
      const v = main.current;
      const c = el.current;
      if (v && c && c.readyState > 0) {
        if (Math.abs(c.currentTime - v.currentTime) > (v.paused ? 0.02 : 0.12)) c.currentTime = v.currentTime;
        c.playbackRate = v.playbackRate;
        if (v.paused && !c.paused) c.pause();
        if (!v.paused && c.paused) c.play().catch(() => {});
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [main]);
  return <video ref={el} src={url} muted preload="auto" style={{ transform: pictureTransform(zoom, flip) }} />;
}

/** Routes the preview's sound through the same voice tweaks the export applies. */
function useVoicePreview(
  video: React.RefObject<HTMLVideoElement | null>,
  audio: { denoise: boolean; clarity: number; normalize: boolean; volumeDb: number },
  duck: number,
) {
  const nodes = useRef<{ ctx: AudioContext; hp: BiquadFilterNode; eq: BiquadFilterNode; gain: GainNode }>(null);
  useEffect(() => {
    const v = video.current;
    if (!v || nodes.current) return;
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(v);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    const eq = ctx.createBiquadFilter();
    eq.type = "peaking";
    eq.frequency.value = 3500;
    eq.Q.value = 1;
    const gain = ctx.createGain();
    src.connect(hp).connect(eq).connect(gain).connect(ctx.destination);
    nodes.current = { ctx, hp, eq, gain };
    const resume = () => ctx.resume();
    v.addEventListener("play", resume);
    return () => v.removeEventListener("play", resume);
  });
  useEffect(() => {
    const n = nodes.current;
    if (!n) return;
    n.hp.frequency.value = audio.denoise ? 80 : 10;
    n.eq.gain.value = audio.clarity;
    const level = (audio.normalize ? 1 : 10 ** (audio.volumeDb / 20)) * duck;
    n.gain.gain.setTargetAtTime(level, n.ctx.currentTime, 0.08); // smooth, like the export's ramp
  }, [audio.denoise, audio.clarity, audio.normalize, audio.volumeDb, duck]);
}

/** Plays each A2 voiceover in step with the edit's clock while the preview plays. */
function useVoiceoverPlayback(voiceovers: Voiceover[], time: number, playing: boolean) {
  const players = useRef(new Map<string, HTMLAudioElement>());
  useEffect(() => {
    const map = players.current;
    // Drop players for voiceovers that were deleted.
    for (const [id, a] of map) if (!voiceovers.some((v) => v.id === id)) (a.pause(), map.delete(id));
    for (const v of voiceovers) {
      let a = map.get(v.id);
      if (!a) {
        a = new Audio(mediaUrl(v.file));
        a.preload = "auto";
        map.set(v.id, a);
      }
      // Fades ramp the level like the export's afade.
      const into = time - v.at;
      const half = v.duration / 2;
      const fin = Math.min(v.fadeIn ?? 0, half);
      const fout = Math.min(v.fadeOut ?? 0, half);
      const ramp = Math.max(0, Math.min(1, fin > 0 ? into / fin : 1, fout > 0 ? (v.duration - into) / fout : 1));
      a.volume = Math.min(1, 10 ** (v.volumeDb / 20)) * ramp;
      const inside = playing && time >= v.at && time < v.at + v.duration;
      const want = v.offset + (time - v.at);
      if (!inside) {
        if (!a.paused) a.pause();
      } else if (a.paused) {
        a.currentTime = want;
        a.play().catch(() => {});
      } else if (Math.abs(a.currentTime - want) > 0.2) a.currentTime = want; // re-sync after a seek
    }
  }, [voiceovers, time, playing]);
  useEffect(() => () => players.current.forEach((a) => a.pause()), []);
}

/** V2 B-roll in the preview: each clip covers the frame during its window, muted, in sync. */
function BrollLayer({ broll, time, playing, frame, overlay }: { broll: Broll[]; time: number; playing: boolean; frame: { w: number; h: number }; overlay: HTMLDivElement | null }) {
  const refs = useRef(new Map<string, HTMLVideoElement>());
  useEffect(() => {
    for (const b of broll) {
      const v = refs.current.get(b.id);
      if (!v) continue;
      // Its own sound plays unless muted (the plan given here already says which, track mute included).
      v.muted = b.muted !== false;
      const active = time >= b.at && time < b.at + b.duration;
      const want = b.offset + (time - b.at);
      if (!active) {
        if (!v.paused) v.pause();
      } else if (playing) {
        if (v.paused) {
          v.currentTime = want;
          v.play().catch(() => {});
        } else if (Math.abs(v.currentTime - want) > 0.25) v.currentTime = want;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want;
      }
    }
  }, [broll, time, playing]);

  // Each picture's own shape (known once it loads), so it's placed like the main video.
  const [shape, setShape] = useState<Record<string, [number, number]>>({});
  const known = (id: string, w: number, h: number) => w && h && setShape((m) => (m[id]?.[0] === w && m[id]?.[1] === h ? m : { ...m, [id]: [w, h] }));
  const selectedBroll = useEditor((s) => s.selectedBroll);
  if (!frame.w) return null;
  // Higher tracks on top; the clip under the pointer is the one a click picks.
  const list = broll.filter((b) => b.file).sort((p, q) => (p.track ?? 2) - (q.track ?? 2));
  return (
    <>
      {list.map((b) => {
        const [w, h] = shape[b.id] ?? [frame.w, frame.h];
        const p = placeBox(b, w, h, frame.w, frame.h);
        const on = time >= b.at && time < b.at + b.duration;
        const style: React.CSSProperties = {
          left: p.cx - p.w / 2, top: p.cy - p.h / 2, width: p.w, height: p.h, visibility: on ? "visible" : "hidden",
          transform: b.rotate ? `rotate(${b.rotate}deg)` : undefined,
        };
        const media = isImage(b.file!) ? (
          <img src={mediaUrl(b.file!)} alt="" onLoad={(e) => known(b.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
        ) : (
          <video
            ref={(el) => {
              if (el) refs.current.set(b.id, el);
              else refs.current.delete(b.id);
            }}
            src={mediaUrl(b.file!)}
            muted
            preload="auto"
            onLoadedMetadata={(e) => known(b.id, e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
          />
        );
        return (
          <div key={b.id} className="broll-box" style={style} onPointerDown={(e) => on && moveBroll(e, b, frame)}>
            {media}
          </div>
        );
      })}
      {list.filter((b) => b.id === selectedBroll && time >= b.at && time < b.at + b.duration).map((b) => {
        const [w, h] = shape[b.id] ?? [frame.w, frame.h];
        return overlay && <SizeBox key={b.id} overlay={overlay} place={placeBox(b, w, h, frame.w, frame.h)} frame={frame} t={b}
          onStart={() => useEditor.getState().checkpoint()}
          onChange={(t) => useEditor.getState().updateBroll(b.id, t, false)} />;
      })}
    </>
  );
}

/** Drag a photo or video on an upper track around the frame (it's selected first). One undo step. */
function moveBroll(e: React.PointerEvent, b: Broll, frame: { w: number; h: number }) {
  if (e.button !== 0) return;
  e.stopPropagation(); // not the main video under it
  const s = useEditor.getState();
  s.selectBroll(b.id);
  const x0 = e.clientX;
  const y0 = e.clientY;
  const start = { x: b.x ?? 0, y: b.y ?? 0 };
  let moved = false;
  const clamp = (v: number) => Math.max(-1.5, Math.min(1.5, v));
  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
    if (!moved) (moved = true), useEditor.getState().checkpoint();
    useEditor.getState().updateBroll(b.id, { x: clamp(start.x + (ev.clientX - x0) / frame.w), y: clamp(start.y + (ev.clientY - y0) / frame.h) }, false);
  };
  const up = () => (window.removeEventListener("pointermove", onMove), window.removeEventListener("pointerup", up));
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
}

/** The picture's own CSS transform: the clip's punch-in zoom, mirrored when flipped. */
function pictureTransform(zoom: number, flip?: boolean): string | undefined {
  const parts = [zoom > 1 ? `scale(${zoom})` : "", flip ? "scaleX(-1)" : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

type Crop = { left: number; top: number; right: number; bottom: number };
type Edge = "left" | "top" | "right" | "bottom";

/**
 * The selected picture's box, like a pro editor's transform box. It outlines what's kept of the
 * picture (after its crop). Corners resize it, its shape kept, while the opposite corner stays put;
 * the bars on its edges crop that side (the picture stays where it is, only the edge moves in);
 * dragging just outside a corner, or the handle on top, turns it (snaps to straight angles, ⇧ for
 * 15° steps). While anything is being dragged a rule-of-thirds grid shows inside it.
 */
function SizeBox({ overlay, place, frame, t, moving, cropping, onStart, onChange }: {
  overlay: HTMLDivElement;
  place: { w: number; h: number; cx: number; cy: number };
  frame: { w: number; h: number };
  t: { scale?: number; x?: number; y?: number; rotate?: number; crop?: Partial<Crop> };
  moving?: boolean;
  cropping?: boolean;
  onStart: () => void;
  onChange: (t: { scale: number; x: number; y: number; rotate: number; crop?: Crop }) => void;
}) {
  const [turning, setTurning] = useState<number | null>(null);
  const [active, setActive] = useState<null | "size" | "crop" | "turn">(null);
  const deg = t.rotate ?? 0;
  const rad = (deg * Math.PI) / 180;
  const c: Crop = cropOf(t);
  // A point in the box's own (unrotated) frame, offset from its middle, turned onto the frame; and back.
  const turn = (dx: number, dy: number) => [dx * Math.cos(rad) - dy * Math.sin(rad), dx * Math.sin(rad) + dy * Math.cos(rad)];
  const unturn = (dx: number, dy: number) => [dx * Math.cos(rad) + dy * Math.sin(rad), -dx * Math.sin(rad) + dy * Math.cos(rad)];
  // The kept part's edges, in the picture's own frame (its middle at 0, 0).
  const L = -place.w / 2 + c.left * place.w;
  const R = place.w / 2 - c.right * place.w;
  const T = -place.h / 2 + c.top * place.h;
  const B = place.h / 2 - c.bottom * place.h;
  const [kdx, kdy] = turn((L + R) / 2, (T + B) / 2);
  const kept = { w: R - L, h: B - T, cx: place.cx + kdx, cy: place.cy + kdy };

  const drag = (e: React.PointerEvent, kind: "size" | "crop" | "turn", move: (x: number, y: number, ev: PointerEvent) => void, up?: () => void) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const fr = overlay.getBoundingClientRect(); // lined up with the frame
    let started = false;
    const onMove = (ev: PointerEvent) => {
      if (!started) (started = true), onStart(), setActive(kind);
      move(ev.clientX - fr.left, ev.clientY - fr.top, ev);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setActive(null);
      up?.();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return fr;
  };

  const resize = (corner: "nw" | "ne" | "sw" | "se") => (e: React.PointerEvent) => {
    // The kept part's opposite corner (on the frame, rotation included) stays where it is.
    const ox = corner.endsWith("e") ? L : R;
    const oy = corner.startsWith("s") ? T : B;
    const [ax0, ay0] = turn(ox, oy);
    const ax = place.cx + ax0;
    const ay = place.cy + ay0;
    const s0 = t.scale ?? 1;
    let d0 = 0;
    const fr = drag(e, "size", (x, y) => {
      const k = Math.max(0.05 / s0, Math.min(5 / s0, Math.hypot(x - ax, y - ay) / d0));
      const [hx, hy] = turn(ox * k, oy * k);
      onChange({ scale: s0 * k, x: (ax - hx - frame.w / 2) / frame.w, y: (ay - hy - frame.h / 2) / frame.h, rotate: deg });
    });
    if (fr) d0 = Math.max(4, Math.hypot(e.clientX - fr.left - ax, e.clientY - fr.top - ay));
  };

  const cropEdge = (edge: Edge) => (e: React.PointerEvent) => {
    if (!cropping) return;
    drag(e, "crop", (x, y) => {
      const [px, py] = unturn(x - place.cx, y - place.cy);
      const next = { ...c };
      const MIN = 0.05; // never crop the picture away entirely
      if (edge === "left") next.left = Math.max(0, Math.min(1 - c.right - MIN, (px + place.w / 2) / place.w));
      if (edge === "right") next.right = Math.max(0, Math.min(1 - c.left - MIN, (place.w / 2 - px) / place.w));
      if (edge === "top") next.top = Math.max(0, Math.min(1 - c.bottom - MIN, (py + place.h / 2) / place.h));
      if (edge === "bottom") next.bottom = Math.max(0, Math.min(1 - c.top - MIN, (place.h / 2 - py) / place.h));
      // Within a few pixels of the picture's own edge it lets go of the crop.
      for (const k of ["left", "right"] as const) if (next[k] * place.w < 4) next[k] = 0;
      for (const k of ["top", "bottom"] as const) if (next[k] * place.h < 4) next[k] = 0;
      const round = (v: number) => Math.round(v * 1000) / 1000;
      onChange({ scale: t.scale ?? 1, x: t.x ?? 0, y: t.y ?? 0, rotate: deg, crop: { left: round(next.left), top: round(next.top), right: round(next.right), bottom: round(next.bottom) } });
    });
  };

  const rotate = (e: React.PointerEvent) => {
    let a0 = 0;
    const fr = drag(e, "turn", (x, y, ev) => {
      let next = deg + ((Math.atan2(y - place.cy, x - place.cx) - a0) * 180) / Math.PI;
      next = ((((next + 180) % 360) + 360) % 360) - 180; // -180…180
      if (ev.shiftKey) next = Math.round(next / 15) * 15;
      else for (const straight of [-180, -90, 0, 90, 180]) if (Math.abs(next - straight) < 4) next = straight;
      setTurning(next);
      onChange({ scale: t.scale ?? 1, x: t.x ?? 0, y: t.y ?? 0, rotate: Math.round(next * 10) / 10 });
    }, () => setTurning(null));
    if (fr) a0 = Math.atan2(e.clientY - fr.top - place.cy, e.clientX - fr.left - place.cx);
  };

  const box = (b: { w: number; h: number; cx: number; cy: number }) =>
    ({ left: b.cx - b.w / 2, top: b.cy - b.h / 2, width: b.w, height: b.h, transform: deg ? `rotate(${deg}deg)` : undefined });
  const grid = Boolean(moving || active);
  return createPortal(
    <>
      {/* While cropping: the whole picture's outline, so you see what you're cutting from. */}
      {active === "crop" && <div className="crop-full" style={box(place)} />}
      <div className={`size-box ${grid ? "gridded" : ""}`} style={box(kept)}>
        {grid && <i className="thirds" />}
        {(["nw", "ne", "sw", "se"] as const).map((k) => (
          <span key={k}>
            <i className={`rot-zone ${k}`} title="Drag to rotate (⇧ for 15° steps)" onPointerDown={rotate} />
            <i className={`cap-handle ${k}`} onPointerDown={resize(k)} />
          </span>
        ))}
        {cropping && (["left", "top", "right", "bottom"] as const).map((k) => (
          <i key={k} className={`crop-bar ${k}`} title="Drag to crop this side" onPointerDown={cropEdge(k)} />
        ))}
        <i className="rotate-stem" />
        <i className="rotate-handle" title="Drag to rotate (⇧ for 15° steps)" onPointerDown={rotate} />
        {turning !== null && <span className="rotate-angle" style={{ transform: `rotate(${-deg}deg)` }}>{Math.round(turning)}°</span>}
        {active === "crop" && (
          <span className="crop-read" style={{ transform: deg ? `rotate(${-deg}deg)` : undefined }}>
            {Math.round(kept.w / frame.w * 100)}% × {Math.round(kept.h / frame.h * 100)}%
          </span>
        )}
      </div>
    </>,
    overlay,
  );
}
