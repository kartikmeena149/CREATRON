// The see-through Remotion layer drawn over the edited video: animated captions and the M1
// Motion track (titles, lower thirds). The app shows it live with <Player>; the export renders
// it with @remotion/renderer and lays it on top. Props come from overlayProps() in src/motion.ts.
import type React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { OverlayCue, OverlayProps } from "../src/motion.ts";

const FONT = "Arial, Helvetica, sans-serif";
// Outline drawn with shadows around the letters, the same look as the plain captions.
const OUTLINE = [
  "0.08em 0 0 #000", "-0.08em 0 0 #000", "0 0.08em 0 #000", "0 -0.08em 0 #000",
  "0.056em 0.056em 0 #000", "-0.056em 0.056em 0 #000", "0.056em -0.056em 0 #000", "-0.056em -0.056em 0 #000",
].join(", ");

export const Overlay: React.FC<OverlayProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      {props.motion.filter((m) => t >= m.at && t < m.at + m.duration).map((m, i) =>
        m.template === "title" ? <Title key={i} {...m} W={props.width} H={props.height} /> : <LowerThird key={i} {...m} W={props.width} H={props.height} />,
      )}
      {props.captions && <Captions {...props.captions} t={t} W={props.width} H={props.height} />}
    </AbsoluteFill>
  );
};

/** Seconds since `at`, and a 0→1 spring that starts there. */
function useEntry(at: number, config = { damping: 13, stiffness: 180, mass: 0.6 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - Math.round(at * fps);
  return { local: local / fps, s: spring({ frame: local, fps, config }) };
}

function Captions(c: NonNullable<OverlayProps["captions"]> & { t: number; W: number; H: number }) {
  const cue = c.cues.find((q) => c.t >= q.start && c.t < q.end);
  if (!cue) return null;
  return <Cue key={cue.start} cue={cue} {...c} />;
}

function Cue({ cue, ...c }: { cue: OverlayCue } & NonNullable<OverlayProps["captions"]> & { t: number; W: number; H: number }) {
  const { s } = useEntry(cue.start);
  // The word being said: the last one that has started.
  const current = cue.words.reduce((n, w, i) => (c.t >= w.start ? i : n), 0);
  const box: React.CSSProperties = {
    position: "absolute",
    left: `${(0.5 + cue.x) * 100}%`,
    top: `${(0.5 + cue.y) * 100}%`,
    width: "max-content",
    maxWidth: c.W * 0.86,
    textAlign: "center",
    lineHeight: 1.2,
    fontWeight: 700,
    fontSize: c.fontSize,
    color: c.color,
    textTransform: c.uppercase ? "uppercase" : "none",
    whiteSpace: "pre-wrap",
    ...(c.style === "bold"
      ? { textShadow: OUTLINE }
      : { background: "rgba(0,0,0,0.55)", padding: "0.15em 0.5em", borderRadius: "0.3em" }),
  };

  if (c.animation === "word") {
    const w = cue.words[current];
    return <Word key={current} text={w.text} at={w.start} box={{ ...box, fontSize: c.fontSize * 1.45, color: c.highlight }} />;
  }
  const scale = c.animation === "pop" ? interpolate(s, [0, 1], [0.55, 1]) : interpolate(s, [0, 1], [0.9, 1]);
  return (
    <div style={{ ...box, transform: `translate(-50%, -50%) scale(${scale})`, opacity: Math.min(1, s * 1.6) }}>
      {cue.words.map((w, i) => (
        <span key={i}>
          {c.animation === "highlight" ? <Lit on={i === current} at={w.start} color={c.highlight} text={w.text} /> : w.text}
          {i < cue.words.length - 1 ? " " : ""}
        </span>
      ))}
    </div>
  );
}

/** One word of a highlight caption: lights up and grows a little while it's being said. */
function Lit({ on, at, color, text }: { on: boolean; at: number; color: string; text: string }) {
  const { s } = useEntry(at, { damping: 12, stiffness: 260, mass: 0.5 });
  const grow = on ? interpolate(s, [0, 1], [1, 1.12]) : 1;
  return <span style={{ display: "inline-block", color: on ? color : undefined, transform: `scale(${grow})` }}>{text}</span>;
}

/** One big word at a time, popping in as it's said. */
function Word({ text, at, box }: { text: string; at: number; box: React.CSSProperties }) {
  const { s } = useEntry(at, { damping: 10, stiffness: 240, mass: 0.5 });
  return <div style={{ ...box, transform: `translate(-50%, -50%) scale(${interpolate(s, [0, 1], [0.4, 1])})`, opacity: Math.min(1, s * 2) }}>{text}</div>;
}

type Item = OverlayProps["motion"][number] & { W: number; H: number };

/** Fades the last 0.3 s so items leave softly. */
const exit = (local: number, duration: number) => interpolate(local, [duration - 0.3, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

function Title({ text, subtext, at, duration, color, W, H }: Item) {
  const { local, s } = useEntry(at);
  const size = Math.min(W, H) * 0.11;
  const bar = interpolate(local, [0.15, 0.55], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: "50%", top: "38%", transform: `translate(-50%, -50%) scale(${interpolate(s, [0, 1], [0.6, 1])})`, opacity: Math.min(1, s * 1.5) * exit(local, duration), textAlign: "center", width: W * 0.88 }}>
      <div style={{ fontSize: size, fontWeight: 800, color: "#fff", lineHeight: 1.05, textShadow: OUTLINE, textTransform: "uppercase" }}>{text}</div>
      <div style={{ height: size * 0.12, width: `${bar * 60}%`, margin: `${size * 0.18}px auto 0`, background: color, borderRadius: size }} />
      {subtext && <div style={{ fontSize: size * 0.55, fontWeight: 700, color: "#fff", marginTop: size * 0.2, textShadow: OUTLINE }}>{subtext}</div>}
    </div>
  );
}

function LowerThird({ text, subtext, at, duration, color, W, H }: Item) {
  const { local, s } = useEntry(at, { damping: 16, stiffness: 140, mass: 0.7 });
  const size = Math.min(W, H) * 0.06;
  const out = interpolate(local, [duration - 0.35, duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const x = interpolate(s, [0, 1], [-W * 0.9, 0]) - out * W * 0.9;
  return (
    <div style={{ position: "absolute", left: W * 0.06, top: H * 0.74, transform: `translateX(${x}px)`, display: "flex", alignItems: "stretch", maxWidth: W * 0.88 }}>
      <div style={{ width: size * 0.22, background: color, borderRadius: size * 0.1 }} />
      <div style={{ background: "rgba(10,10,14,0.82)", padding: `${size * 0.3}px ${size * 0.55}px`, borderRadius: `0 ${size * 0.2}px ${size * 0.2}px 0` }}>
        <div style={{ fontSize: size, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>{text}</div>
        {subtext && <div style={{ fontSize: size * 0.55, fontWeight: 600, color, marginTop: size * 0.12 }}>{subtext}</div>}
      </div>
    </div>
  );
}
