// Creatron's mark, alive: the reel. Ten frames in a ring with a cut on the right (a C), and the red
// recording light in the middle. It's the welcome screen, the empty chat, Claude at work and the
// export's progress: while working the frames light in turn; exporting, they fill up as it goes;
// done, they all light and the red light turns into a check. Same shape as the logo
// (website/brand/make-logo.ts): twelve places, two left out, radius 3.4, dot 0.98.
import { Icon } from "./icons.tsx";

const PLACES = 12;
const R = 3.4;
const DOT = 0.98;
const FRAMES = Array.from({ length: PLACES }, (_, i) => (Math.PI * 2 * (i + 0.5)) / PLACES)
  .filter((a) => Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI) > Math.PI / PLACES + 1e-6)
  // Clockwise from the top of the cut, so the frames fill the way a clock runs.
  .sort((a, b) => a - b);

export function Orb({ size = 132, progress, done = false, calm = false, still = false }: { size?: number; progress?: number; done?: boolean; calm?: boolean; still?: boolean }) {
  const lit = progress === undefined ? FRAMES.length : Math.round(progress * FRAMES.length);
  const state = done ? "done" : progress !== undefined ? "filling" : calm || still ? "calm" : "working";
  const extent = R + DOT / 2;
  return (
    <div className={`orb ${state} ${still ? "still" : ""}`} style={{ ["--orb" as string]: `${size}px` }}>
      <svg viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`} width={size} height={size} aria-hidden="true">
        {FRAMES.map((a, i) => (
          <circle key={i} className={`frame ${i < lit ? "on" : ""}`} cx={R * Math.cos(a)} cy={R * Math.sin(a)} r={DOT / 2} style={{ ["--i" as string]: i }} />
        ))}
        {!done && <circle className="light" cx={0} cy={0} r={DOT / 2} />}
      </svg>
      {done && <span className="orb-check"><Icon name="check" size={Math.max(10, Math.round(size * 0.24))} /></span>}
    </div>
  );
}
