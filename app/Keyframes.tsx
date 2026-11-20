// Keyframe controls: the diamond next to an animatable value in the panels, and the diamonds drawn
// on clips in the timeline. Times are seconds into the clip, like the plan stores them.
import { EASES, type Ease, type Keys, keyAt, keyTimes, removeKey, setEase, setKey, valueAt } from "../src/keyframes.ts";
import { useEditor } from "./store.ts";

/**
 * The diamond: filled when this property has a keyframe at the playhead (click to take it out),
 * hollow otherwise (click to add one with the value showing now). A property with keyframes
 * animates; changing its value then sets a keyframe at the playhead.
 */
export function KeyButton({ keys, prop, t, still, onChange }: {
  keys: Keys | undefined; prop: string; t: number; still: number; onChange: (keys: Keys | undefined) => void;
}) {
  const here = Boolean(keyAt(keys?.[prop], t));
  const animated = Boolean(keys?.[prop]?.length);
  const list = keys?.[prop] ?? [];
  const prev = [...list].reverse().find((k) => k.t < t - 1 / 60);
  const next = list.find((k) => k.t > t + 1 / 60);
  const go = (k?: { t: number }) => k && useEditor.getState().seek(useEditor.getState().time + (k.t - t));
  return (
    <span className="key-ctl" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.preventDefault()}>
      {animated && <button className="key-nav" disabled={!prev} title="Previous keyframe" onClick={() => go(prev)}>‹</button>}
      <button
        className={`key-btn ${here ? "on" : animated ? "animated" : ""}`}
        title={here ? "Remove the keyframe here" : animated ? "Add a keyframe here" : "Animate: add a keyframe here, then move the playhead and change the value"}
        onClick={() => onChange(here ? removeKey(keys, prop, t) : setKey(keys, prop, t, valueAt(keys?.[prop], t, still)))}
      >
        <svg viewBox="0 0 12 12" width="11" height="11"><path d="M6 1l5 5-5 5-5-5z" /></svg>
      </button>
      {animated && <button className="key-nav" disabled={!next} title="Next keyframe" onClick={() => go(next)}>›</button>}
    </span>
  );
}

/** The easing out of the keyframes at the playhead (shown when there are any). */
export function EaseRow({ keys, t, onChange }: { keys: Keys | undefined; t: number; onChange: (keys: Keys | undefined) => void }) {
  const props = Object.keys(keys ?? {}).filter((p) => keyAt(keys?.[p], t));
  if (!props.length) return null;
  const current: Ease = keyAt(keys?.[props[0]], t)?.ease ?? "linear";
  const label: Record<Ease, string> = { linear: "Linear", ease: "Smooth", in: "Speed up", out: "Slow down" };
  return (
    <div className="ease-row">
      <span className="dim small">Keyframe motion</span>
      <div className="segmented">
        {EASES.map((e) => (
          <button key={e} className={e === current ? "on" : ""} title={`How it moves from this keyframe to the next: ${label[e].toLowerCase()}`}
            onClick={() => onChange(props.reduce<Keys | undefined>((k, p) => setEase(k, p, t, e), keys))}>{label[e]}</button>
        ))}
      </div>
    </div>
  );
}

/** Diamonds on a clip in the timeline, one per keyframe moment; click one to go there. */
export function KeyDiamonds({ keys, start, pxPerSec, width }: { keys: Keys | undefined; start: number; pxPerSec: number; width: number }) {
  const times = keyTimes(keys).filter((t) => t >= 0 && t * pxPerSec <= width);
  if (!times.length) return null;
  return (
    <div className="key-diamonds">
      {times.map((t) => (
        <i key={t} style={{ left: t * pxPerSec }} title={`Keyframe at ${t.toFixed(2)}s · click to go there`}
          onPointerDown={(e) => (e.stopPropagation(), useEditor.getState().setPlaying(false), useEditor.getState().seek(start + t))} />
      ))}
    </div>
  );
}
