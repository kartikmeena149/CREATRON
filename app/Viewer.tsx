// The program monitor: plays the edit live from the original file, no render needed.
// Cuts are jumps between source ranges, speed is playbackRate, zoom is a CSS scale,
// reframing is object-fit/position (the same crop the renderer does), captions are DOM text,
// and voice tweaks run through Web Audio.
import { useEffect, useMemo, useRef, useState } from "react";
import { buildCues, outputDuration } from "../src/timeline.ts";
import { locate, useEditor } from "./store.ts";
import { timecode } from "./format.ts";

export function Viewer() {
  const { project, plan, time, playing, seek, setPlaying } = useEditor();
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

  useVoicePreview(video, plan.audio);

  const cues = useMemo(() => (a && plan.captions.enabled ? buildCues(plan, a.words) : []), [a, plan]);
  const cue = cues.find((c) => time >= c.start && time < c.end);
  const bold = plan.captions.style === "bold";
  const capSize = Math.min(frameSize.w, frameSize.h) * (bold ? 0.075 : 0.05);

  if (!project) return <div className="viewer" />;
  return (
    <div className="viewer">
      <div className="viewer-stage">
        <div className="viewer-frame" ref={frame} style={{ aspectRatio: String(ratio) }}>
          <video
            ref={video}
            src={project.videoUrl}
            crossOrigin="anonymous"
            preload="auto"
            style={{
              objectPosition: `${plan.reframeX * 100}% 50%`,
              transform: seg && seg.zoom > 1 ? `scale(${seg.zoom})` : undefined,
            }}
          />
          {cue && (
            <div
              className={`caption ${bold ? "bold" : "minimal"}`}
              style={{ top: `${bold ? 70 : 85}%`, fontSize: capSize }}
            >
              <span>{bold ? cue.text.toUpperCase() : cue.text}</span>
            </div>
          )}
        </div>
      </div>
      <div className="transport">
        <span className="tc">{timecode(time)}</span>
        <div className="transport-buttons">
          <button className="icon" title="Back to start" onClick={() => seek(0)}>⏮</button>
          <button className="icon play" title="Play / pause (Space)" onClick={() => setPlaying(!playing)}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button className="icon" title="Go to end" onClick={() => seek(total)}>⏭</button>
        </div>
        <span className="tc dim">{timecode(total)}</span>
      </div>
    </div>
  );
}

/** Routes the preview's sound through the same voice tweaks the export applies. */
function useVoicePreview(video: React.RefObject<HTMLVideoElement | null>, audio: { denoise: boolean; clarity: number; normalize: boolean; volumeDb: number }) {
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
    n.gain.gain.value = audio.normalize ? 1 : 10 ** (audio.volumeDb / 20);
  }, [audio.denoise, audio.clarity, audio.normalize, audio.volumeDb]);
}
