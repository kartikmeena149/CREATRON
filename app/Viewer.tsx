// The program monitor: plays the edit live from the original file, no render needed.
// Cuts are jumps between source ranges, speed is playbackRate, zoom is a CSS scale,
// reframing is object-fit/position (the same crop the renderer does), captions are DOM text,
// and voice tweaks run through Web Audio.
import { useEffect, useMemo, useRef, useState } from "react";
import { CaptionOverlay } from "./CaptionOverlay.tsx";
import { placement } from "../src/frame.ts";
import { buildCues, outputDuration } from "../src/timeline.ts";
import { MotionPreview } from "./MotionPreview.tsx";
import { locate, useEditor } from "./store.ts";
import { mediaUrl, timecode } from "./format.ts";
import type { Broll, Voiceover } from "../src/schema.ts";
import { effectivePlan, trackSetting } from "../src/tracks.ts";

export function Viewer() {
  const { project, plan, time, playing, seek, setPlaying, markers, pointing, busy, status } = useEditor();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
  const total = outputDuration(plan);
  const a = project?.analysis;

  const ratio = useMemo(() => {
    if (!a) return 16 / 9;
    if (plan.aspect === "source") return a.width / a.height;
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
  useEffect(() => {
    const v = video.current;
    if (!v || playing || !seg) return;
    const target = seg.start + (time - offset) * seg.speed;
    if (Math.abs(v.currentTime - target) > 0.02) v.currentTime = target;
  }, [time, playing, seg, offset]);

  // Playing: follow the video clock and hop to the next kept range at every cut.
  useEffect(() => {
    const v = video.current;
    if (!v || !playing) return;
    let raf = 0;
    let i = locate(plan, useEditor.getState().time).index;
    const start = () => {
      const st = useEditor.getState();
      const loc = locate(plan, st.time >= total - 0.05 ? 0 : st.time);
      i = loc.index;
      const s = plan.segments[i];
      v.currentTime = s.start + ((st.time >= total - 0.05 ? 0 : st.time) - loc.offset) * s.speed;
      v.playbackRate = s.speed;
      v.play().catch(() => setPlaying(false));
    };
    const tick = () => {
      const s = plan.segments[i];
      if (v.currentTime >= s.end - 0.01) {
        if (i + 1 >= plan.segments.length) {
          v.pause();
          seek(total);
          setPlaying(false);
          return;
        }
        i += 1;
        v.currentTime = plan.segments[i].start;
        v.playbackRate = plan.segments[i].speed;
      }
      let off = 0;
      for (let n = 0; n < i; n++) off += (plan.segments[n].end - plan.segments[n].start) / plan.segments[n].speed;
      const cur = plan.segments[i];
      seek(off + Math.max(0, v.currentTime - cur.start) / cur.speed);
      raf = requestAnimationFrame(tick);
    };
    start();
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
  const clipVolume = trackSetting(plan, "video:1").muted ? 0 : (seg?.volume ?? 1);
  useVoicePreview(video, plan.audio, (underVoiceover && plan.audio.duckDb < 0 ? 10 ** (plan.audio.duckDb / 20) : 1) * clipVolume);
  useVoiceoverPlayback(shown.voiceovers, time, playing);

  const cues = useMemo(() => (a && plan.captions.enabled ? buildCues(plan, a.words) : []), [a, plan]);
  const cue = cues.find((c) => time >= c.start && time < c.end);
  const place = placement(plan, a?.width ?? 16, a?.height ?? 9, frameSize.w, frameSize.h);

  // Drag the picture to move it, like in a phone editor. One undo step per drag.
  const [dragging, setDragging] = useState(false);
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 || !frameSize.w) return;
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
      live({
        ...start,
        transform: {
          ...start.transform,
          x: clamp(start.transform.x + (ev.clientX - x0) / frameSize.w),
          y: clamp(start.transform.y + (ev.clientY - y0) / frameSize.h),
        },
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  if (!project) return <div className="viewer" />;
  return (
    <div className="viewer">
      <div className="viewer-stage">
        <div
          className={`viewer-frame ${dragging ? "dragging" : ""}`}
          ref={frame}
          style={{ aspectRatio: String(ratio) }}
          onPointerDown={startDrag}
          title="Drag to move the video"
        >
          {/* Same placement math as the export. The box clips the per-clip punch-in like the renderer's crop. */}
          <div
            className="video-box"
            style={{
              width: place.w,
              height: place.h,
              left: place.cx - place.w / 2,
              top: place.cy - place.h / 2,
              transform: place.rotate ? `rotate(${place.rotate}deg)` : undefined,
            }}
          >
            <video
              ref={video}
              src={project.videoUrl}
              crossOrigin="anonymous"
              preload="auto"
              style={{ transform: seg && seg.zoom > 1 ? `scale(${seg.zoom})` : undefined }}
            />
          </div>
          <BrollLayer broll={shown.broll} time={time} playing={playing} />
          {/* Animated captions are drawn by the Remotion layer instead of the editable plain caption. */}
          {cue && frameSize.w > 0 && plan.captions.animation === "none" && <CaptionOverlay key={cue.index} cue={cue} frame={frameSize} />}
          <MotionPreview />
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
      </div>
    </div>
  );
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
      a.volume = Math.min(1, 10 ** (v.volumeDb / 20));
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
function BrollLayer({ broll, time, playing }: { broll: Broll[]; time: number; playing: boolean }) {
  const refs = useRef(new Map<string, HTMLVideoElement>());
  useEffect(() => {
    for (const b of broll) {
      const v = refs.current.get(b.id);
      if (!v) continue;
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

  return (
    <>
      {broll.filter((b) => b.file).map((b) => (
        <video
          key={b.id}
          className="broll-layer"
          ref={(el) => {
            if (el) refs.current.set(b.id, el);
            else refs.current.delete(b.id);
          }}
          src={mediaUrl(b.file!)}
          muted
          preload="auto"
          style={{ visibility: time >= b.at && time < b.at + b.duration ? "visible" : "hidden" }}
        />
      ))}
    </>
  );
}
