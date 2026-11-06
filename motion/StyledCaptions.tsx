// Kartik's caption styles, ported from his caption skills: kinetic (kinetic-captions), doc
// (doc-captions), glow (block-captions) and spec (kme-tech-reel's spec-stack). The skills design
// each phrase by hand; here every caption is one phrase and its key word (OverlayCue.key) is
// picked in src/motion.ts. Sizes follow the skills' px at 1080 wide, as multiples of the caption's
// own font size, so the style bar's size and font still apply.
import type React from "react";
import { Easing, interpolate, interpolateColors } from "remotion";
import type { OverlayCue, OverlayProps } from "../src/motion.ts";
import { alignBox, captionWrapWidth } from "../src/timeline.ts";

type Caps = NonNullable<OverlayProps["captions"]>;
export type StyledProps = { cue: OverlayCue; prev?: OverlayCue; t: number; fps: number; c: Caps; W: number };

// Instrument Serif when it's installed, else the Mac's closest italic serifs.
const SERIF = `"Instrument Serif", Baskerville, Georgia, serif`;
const MONO = `"SF Mono", Menlo, monospace`;
const GREY = "#8f8a78";

const clampX = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ramp = (t: number, a: number, d: number, easing: (n: number) => number = Easing.out(Easing.quad)) =>
  interpolate(t, [a, a + d], [0, 1], { ...clampX, easing });

const FLEX = { center: "center", left: "flex-start", right: "flex-end" } as const;

/** The caption's place and wrap width, and its text look (font, colour, case). */
function box(cue: OverlayCue, c: Caps, W: number): React.CSSProperties {
  const look = cue.look;
  return {
    position: "absolute",
    left: `${(0.5 + cue.x) * 100}%`,
    top: `${(0.5 + cue.y) * 100}%`,
    width: "max-content",
    maxWidth: captionWrapWidth(look, W),
    // Aligned captions fill their column, so every line starts (or ends) at the same edge.
    ...alignBox(look, W),
    fontFamily: `"${look.font}", Arial, sans-serif`,
    fontWeight: look.bold ? 700 : 400,
    fontStyle: look.italic ? "italic" : "normal",
    fontSize: cue.fontSize,
    color: look.color,
    textTransform: c.uppercase ? "uppercase" : "none",
  };
}

const accentOf = (cue: OverlayCue) => cue.look.highlight ?? cue.look.color;
const isSmall = (w: string) => w.replace(/[^\p{L}]/gu, "").length <= 3;

/**
 * Kinetic: each word previews faint and blurred 0.14 s before it's said, then sharpens and turns
 * from grey to its colour; the key word slams in big (scale 1.45, blur) on its own row in the
 * accent; small connector words run smaller. A new phrase pushes in from 0.88 and the old one
 * pushes past the camera (scale 1.4, blur, fade, 0.26 s).
 */
export function KineticCaption({ cue, prev, t, c, W }: StyledProps) {
  const leaving = prev && t < cue.start + 0.26 ? <KineticPhrase cue={prev} t={t} c={c} W={W} exit={ramp(t, cue.start, 0.26, Easing.in(Easing.quad))} /> : null;
  return <>{leaving}<KineticPhrase cue={cue} t={t} c={c} W={W} exit={0} /></>;
}

function KineticPhrase({ cue, t, c, W, exit }: { cue: OverlayCue; t: number; c: Caps; W: number; exit: number }) {
  const f = cue.fontSize;
  const enter = ramp(t, cue.start - 0.14, 0.45);
  // The key word gets a row of its own (between the words before and after it), as big as fits:
  // 2.1× the running size, smaller for a long word so it stays inside the frame.
  const key = cue.words[cue.key];
  const rows = key
    ? [cue.words.slice(0, cue.key), [key], cue.words.slice(cue.key + 1)].filter((r) => r.length)
    : [cue.words];
  const punch = key ? Math.min(f * 2.1, (W * 0.84) / Math.max(1, key.text.length * 0.5)) : f;
  const shadow = "0 0.05em 0.17em rgba(10,12,12,.55), 0 1px 2px rgba(10,12,12,.4)";
  let n = 0;
  return (
    <div
      style={{
        ...box(cue, c, W),
        maxWidth: undefined,
        textAlign: "left",
        transform: `translate(-50%, -50%) scale(${interpolate(enter, [0, 1], [0.88, 1]) * interpolate(exit, [0, 1], [1, 1.4])})`,
        transformOrigin: "30% 50%",
        opacity: 1 - exit,
        filter: exit ? `blur(${interpolate(exit, [0, 1], [0, 12])}px)` : undefined,
        letterSpacing: "-0.035em",
      }}
    >
      {rows.map((row, ri) => (
        <div key={ri} style={{ whiteSpace: "nowrap", lineHeight: 1.1 }}>
          {row.map((w) => {
            const i = n++;
            const ts = w.start;
            if (i === cue.key) {
              const p = ramp(t, ts - 0.04, 0.22, Easing.out(Easing.cubic));
              return (
                <span key={i} style={{
                  display: "inline-block", fontWeight: 900, fontSize: punch, lineHeight: 0.92, letterSpacing: "-0.075em",
                  marginRight: "0.12em", color: accentOf(cue), opacity: p, transform: `scale(${interpolate(p, [0, 1], [1.45, 1])})`,
                  filter: `blur(${interpolate(p, [0, 1], [14, 0]) * (f / 84)}px)`, textShadow: "0 0.07em 0.13em rgba(10,12,12,.55)",
                }}>{w.text}</span>
              );
            }
            const a = ramp(t, ts - 0.14, 0.12);
            const b = ramp(t, ts - 0.02, 0.16);
            const small = isSmall(w.text) && cue.words.length > 1;
            return (
              <span key={i} style={{
                display: "inline-block", fontSize: small ? f * 0.64 : f, marginRight: small ? "0.2em" : "0.16em", textShadow: shadow,
                opacity: interpolate(b, [0, 1], [0.4 * a, 1]),
                filter: `blur(${interpolate(b, [0, 1], [interpolate(a, [0, 1], [10, 5]), 0]) * (f / 84)}px)`,
                transform: `translateY(${interpolate(b, [0, 1], [interpolate(a, [0, 1], [0.19, 0.1]), 0])}em)`,
                color: interpolateColors(ramp(t, ts + 0.1, 0.18), [0, 1], [GREY, cue.look.color]),
              }}>{w.text}</span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Doc: each word rises 34 px out of a 10 px blur over 6 frames on its timestamp; the word being
 * said pops to 1.25 and settles at 1.06, earlier words sit at 92%. A key word (about one caption
 * in three) is serif italic in the accent, natural case, 1.23× bigger. New groups cut in.
 */
export function DocCaption({ cue, t, fps, c, W }: StyledProps) {
  const f = cue.fontSize;
  const ease = Easing.bezier(0.16, 1, 0.3, 1);
  const current = cue.words.reduce((n, w, i) => (t >= w.start ? i : n), -1);
  return (
    <div style={{ ...box(cue, c, W), transform: "translate(-50%, -50%)", display: "flex", flexWrap: "wrap", justifyContent: FLEX[cue.look.align], alignItems: "baseline", letterSpacing: "0.01em" }}>
      {cue.words.map((w, i) => {
        const p = ramp(t, w.start - 1 / fps, 6 / fps, ease);
        const hot = i === cue.key;
        return (
          <span key={i} style={{
            display: "inline-block", margin: "0 0.15em", lineHeight: 1.05,
            ...(hot ? { fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, fontSize: f * 1.23, textTransform: "none", letterSpacing: "-0.01em", color: accentOf(cue) } : {}),
            opacity: p * (i === current || hot ? 1 : 0.92),
            transform: `translateY(${interpolate(p, [0, 1], [0.35, 0])}em) scale(${i === current ? interpolate(p, [0, 1], [1.25, 1.06]) : 1})`,
            filter: `blur(${interpolate(p, [0, 1], [10, 0]) * (f / 96)}px)`,
            textShadow: "0 0.04em 0.19em rgba(0,0,0,.75), 0 0 2px rgba(0,0,0,.9)",
          }}>{w.text}</span>
        );
      })}
    </div>
  );
}

const GLOW_BLOCK = "#fff8ec";

/**
 * Block glow: words appear one by one (the line grows and re-centres). Each is announced by a
 * warm-white glowing block the size of the word for 2 frames, then the word lands with a bloom that
 * fades over 0.22 s; about half the words get a second 1-frame flicker over their end 2–4 frames
 * later. The key word is serif italic, 1.23×. Phrases hard-cut.
 */
export function GlowCaption({ cue, t, fps, c, W }: StyledProps) {
  const f = cue.fontSize;
  const k = f / 52;
  const glow = `0 0 ${8 * k}px ${2 * k}px rgba(255,248,236,.95), 0 0 ${28 * k}px ${8 * k}px rgba(255,244,228,.55), 0 0 ${70 * k}px ${18 * k}px rgba(255,240,220,.28)`;
  return (
    <div style={{ ...box(cue, c, W), transform: "translate(-50%, -50%)", lineHeight: 0.95, letterSpacing: "-0.04em" }}>
      {cue.words.map((w, i) => {
        const t0 = Math.max(cue.start, w.start - 0.07);
        if (t < t0) return null;
        const block = t < t0 + 2 / fps;
        const seed = Math.sin((cue.index + 1) * 12.9898 + i * 78.233) * 43758.5453;
        const r = seed - Math.floor(seed);
        const t1 = t0 + (2 + 2 + Math.floor(r * 30) % 3) / fps;
        const flicker = r < 0.5 && t >= t1 && t < t1 + 1 / fps;
        const bloom = 1 - ramp(t, t0 + 2 / fps, 0.22);
        const serif = i === cue.key;
        return (
          <span key={i} style={{ display: "inline-block", position: "relative", margin: "0 0.09em",
            ...(serif ? { fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, fontSize: f * 1.23, letterSpacing: "-0.01em" } : {}) }}>
            <span style={{ opacity: block ? 0 : 1, textShadow: bloom > 0 ? `0 0 ${10 * k}px rgba(255,248,236,${0.95 * bloom}), 0 0 ${26 * k}px rgba(255,248,236,${0.6 * bloom})` : undefined }}>{w.text}</span>
            {block && <i style={{ position: "absolute", top: "12%", bottom: "4%", left: -2, right: -2, background: GLOW_BLOCK, borderRadius: 2, boxShadow: glow }} />}
            {flicker && <i style={{ position: "absolute", top: "12%", bottom: "4%", left: "55%", right: -4, background: GLOW_BLOCK, borderRadius: 2, boxShadow: glow }} />}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Spec stack: the line being said in heavy type, words sliding up in on their timestamps; the key
 * word turns the accent with an underline that draws on; numbers become accent "spec chips". The
 * previous caption stays above, small and dimmed, sliding up into place as the new line starts.
 */
export function SpecCaption({ cue, prev, t, fps, c, W }: StyledProps) {
  const f = cue.fontSize;
  const shift = ramp(t, cue.start - 1 / fps, 6 / fps);
  const accent = accentOf(cue);
  return (
    <div style={{ ...box(cue, c, W), transform: "translate(-50%, -50%)", fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.025em", textShadow: "0 0.08em 0.38em rgba(0,0,0,.8)" }}>
      {prev && (
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: "100%", marginBottom: "0.2em", fontSize: f * 0.64, fontWeight: 600, letterSpacing: "-0.01em",
          color: "rgba(255,255,255,.42)", transform: `translateY(${interpolate(shift, [0, 1], [0.8, 0])}em)`, whiteSpace: "normal",
        }}>
          {prev.words.map((w) => w.text).join(" ")}
        </div>
      )}
      {cue.words.map((w, i) => {
        const p = ramp(t, w.start - 1 / fps, 5 / fps);
        const number = /\d/.test(w.text);
        if (number) {
          return (
            <span key={i} style={{
              display: "inline-block", fontFamily: MONO, fontWeight: 700, fontSize: f * 0.8, color: "#000", background: accent, textShadow: "none",
              padding: "0.03em 0.25em", margin: "0 0.15em", borderRadius: "0.1em", verticalAlign: "middle",
              opacity: p, transform: `translateY(${interpolate(p, [0, 1], [0.28, 0])}em) scale(${interpolate(p, [0, 1], [1.3, 1])})`,
            }}>{w.text}</span>
          );
        }
        const key = i === cue.key;
        return (
          <span key={i} style={{
            display: "inline-block", position: "relative", margin: "0 0.12em", color: key ? accent : undefined,
            opacity: p, transform: `translateY(${interpolate(p, [0, 1], [0.28, 0])}em)`,
          }}>
            {w.text}
            {key && <i style={{ position: "absolute", left: 0, right: 0, bottom: "-0.02em", height: "0.08em", background: accent, borderRadius: "0.04em",
              transformOrigin: "0 50%", transform: `scaleX(${ramp(t, w.start + 0.1, 0.2, Easing.out(Easing.cubic))})` }} />}
          </span>
        );
      })}
    </div>
  );
}
