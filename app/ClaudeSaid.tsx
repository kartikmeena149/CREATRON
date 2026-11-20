// What Claude said after a redraw: what it changed, what it couldn't make (and why), and one way
// that would work, as a button. Shown in the drawing view and under the storyboard.
import type { Verdict } from "../src/storyboard.ts";
import { Icon } from "./icons.tsx";
import { StoryboardMark } from "./StoryboardMark.tsx";

export function ClaudeSaid({ said, onTry, onClose, disabled }: { said: Verdict; onTry?: (text: string) => void; onClose?: () => void; disabled?: boolean }) {
  return (
    <div className={`sb-said ${said.declined ? "declined" : ""}`} role="status">
      <span className="sb-said-who"><StoryboardMark size={18} /> Claude</span>
      <div className="sb-said-body">
        {said.changed && <p className="yes"><Icon name="check" size={13} /> {said.changed}</p>}
        {said.declined && <p className="no"><Icon name="alert" size={13} /> {said.declined}</p>}
        {said.tryThis && onTry && (
          <button className="sb-said-try" disabled={disabled} onClick={() => onTry(said.tryThis!)} title="Ask Claude for this instead">
            <Icon name="sparkle" size={12} /> {said.tryThis}
          </button>
        )}
      </div>
      {onClose && <button className="sb-said-x" onClick={onClose} title="Hide"><Icon name="close" size={12} /></button>}
    </div>
  );
}
