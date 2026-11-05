// The style bar for the selected caption (click a caption in the video or on the timeline):
// font, size, bold / italic / underline / strikethrough, colours, outline, behind the person,
// and Apply to all. It floats under the caption, or sits at the bottom of the viewer when the
// caption isn't on screen right now.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { outputSize } from "../src/frame.ts";
import { BUNDLED_FONTS } from "../src/fonts.ts";
import { CAPTION_FONTS, type CaptionLook } from "../src/schema.ts";
import { captionLook, captionsOf, cueFontSize, DEFAULT_BOX } from "../src/timeline.ts";
import { Icon } from "./icons.tsx";
import { useEditor } from "./store.ts";

const SWATCHES = ["#ffffff", "#ffe14d", "#ffd600", "#a3e635", "#5ee1ff", "#ff7ac6", "#ff5a5a", "#111111"];
const OUTLINES = { outline: "Black edge", box: "Box", none: "Plain" } as const;
const BUNDLED = new Set<string>(BUNDLED_FONTS.map((f) => f.family));

export function CaptionToolbar({ stage }: { stage: React.RefObject<HTMLDivElement | null> }) {
  const { project, plan, selectedCue, setCaptionLook, applyLookToAll, checkpoint } = useEditor();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState<"" | "font" | "color">("");
  const bar = useRef<HTMLDivElement>(null);
  const preparing = useEditor((s) => s.cutoutStatus);

  // Under the caption when it's on screen; otherwise docked at the bottom of the viewer.
  useLayoutEffect(() => {
    const host = stage.current;
    const el = host?.querySelector(".caption.selected");
    if (!host || !bar.current) return;
    const h = host.getBoundingClientRect();
    const b = bar.current.getBoundingClientRect();
    let next: { left: number; top: number } | null = null;
    if (el) {
      const c = el.getBoundingClientRect();
      const left = Math.round(Math.max(8, Math.min(h.width - b.width - 8, c.left + c.width / 2 - h.left - b.width / 2)));
      const below = Math.round(c.bottom - h.top + 10);
      next = { left, top: below + b.height > h.height - 8 ? Math.round(Math.max(8, c.top - h.top - b.height - 10)) : below };
    }
    // Only when it moved, or this would re-render forever.
    if (next?.left !== pos?.left || next?.top !== pos?.top) setPos(next);
  });
  // A different caption: close the open panel.
  useEffect(() => setOpen(""), [selectedCue]);

  if (!project || selectedCue === null || !plan.captions.enabled) return null;
  const own = captionsOf(plan, project.analysis.words)[selectedCue];
  if (!own) return null;
  const look = captionLook(plan, own.look);
  const set = (patch: CaptionLook) => setCaptionLook(selectedCue, patch);
  // Live changes while dragging a colour picker or slider: one undo step for the whole drag.
  const live = (patch: CaptionLook) => setCaptionLook(selectedCue, patch, false);
  // Size in pixels of the exported frame, like a design tool shows it.
  const out = outputSize(plan, project.analysis);
  const px = Math.round(cueFontSize(plan, look, out.width, out.height));
  const pxPerUnit = cueFontSize(plan, { ...look, size: 1 }, out.width, out.height);
  const setPx = (v: number) => Number.isFinite(v) && v > 0 && set({ size: Math.max(0.3, Math.min(4, v / pxPerUnit)) });
  const picture = project.analysis.width > 0;
  const spokenShown = plan.captions.animation === "highlight" || plan.captions.animation === "word";

  const toggle = (key: "bold" | "italic" | "underline" | "strike", label: string, title: string) => (
    <button className={`ctb-btn ${look[key] ? "on" : ""}`} title={title} onClick={() => set({ [key]: !look[key] })}>
      <span className={`ctb-glyph ${key}`}>{label}</span>
    </button>
  );

  return (
    <div
      ref={bar}
      className={`caption-toolbar ${pos ? "" : "docked"}`}
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="ctb-pop-anchor">
        <button className="ctb-font" title="Font" style={{ fontFamily: `"${look.font}"` }} onClick={() => setOpen(open === "font" ? "" : "font")}>
          <span>{look.font}</span>
          <Icon name="chevronDown" size={12} />
        </button>
        {open === "font" && <FontList value={look.font} onPick={(font) => (set({ font }), setOpen(""))} />}
      </div>
      <label className="ctb-size" title="Size (pixels in the exported video)">
        <input type="number" min={8} max={600} value={px} onChange={(e) => setPx(Number(e.target.value))} />
        <span className="ctb-steps">
          <button onClick={() => setPx(px + 4)} title="Bigger"><Icon name="chevronDown" size={10} /></button>
          <button onClick={() => setPx(px - 4)} title="Smaller"><Icon name="chevronDown" size={10} /></button>
        </span>
      </label>
      <span className="ctb-sep" />
      {toggle("bold", "B", "Bold")}
      {toggle("italic", "I", "Italic")}
      {toggle("underline", "U", "Underline")}
      {toggle("strike", "S", "Strikethrough")}
      <span className="ctb-sep" />
      <div className="ctb-pop-anchor">
        <button className={`ctb-btn ctb-colors ${open === "color" ? "on" : ""}`} title="Colours" onClick={() => setOpen(open === "color" ? "" : "color")}>
          <i className="ctb-dot" style={{ background: look.color }} />
          {spokenShown && <i className="ctb-dot small" style={{ background: look.highlight ?? look.color }} />}
          <i className="ctb-dot small" style={{ background: look.background ? `#${look.background.slice(1, 7)}` : "transparent", boxShadow: "0 0 0 1.5px #777 inset" }} />
        </button>
        {open === "color" && (
          <div className="ctb-panel" onPointerDown={(e) => e.stopPropagation()}>
            <ColorRow label="Text" value={look.color} onPick={(color) => set({ color })} onStart={checkpoint} onLive={(color) => live({ color })} />
            {spokenShown && (
              <ColorRow
                label="Spoken word"
                note={look.highlight === null ? "same as text" : undefined}
                value={look.highlight ?? look.color}
                onPick={(highlight) => set({ highlight })}
                onStart={checkpoint}
                onLive={(highlight) => live({ highlight })}
                reset={look.highlight !== null ? { label: "Same as text", run: () => set({ highlight: null }) } : undefined}
              />
            )}
            <BackgroundRow look={look} onSet={set} onStart={checkpoint} onLive={live} />
          </div>
        )}
      </div>
      <button
        className="ctb-btn"
        title={`Outline: ${OUTLINES[look.outline]} (click to change)`}
        onClick={() => set({ outline: look.outline === "outline" ? "box" : look.outline === "box" ? "none" : "outline" })}
      >
        <Icon name="contrast" size={15} />
      </button>
      <button
        className={`ctb-btn ctb-behind ${look.behind ? "on" : ""}`}
        disabled={!picture}
        title={!picture ? "Needs a video with a person in it" : look.behind ? "Bring text in front of me" : "Put text behind me"}
        onClick={() => {
          set({ behind: !look.behind });
          if (!look.behind) useEditor.getState().prepareCutout();
        }}
      >
        <Icon name="person" size={15} />
        {look.behind && <span>Behind</span>}
      </button>
      <button className="ctb-apply" title="Give every caption this look" onClick={() => applyLookToAll(selectedCue)}>Apply to all</button>
      {preparing && <span className="ctb-status"><span className="mini-spin" /> {preparing}</span>}
    </div>
  );
}

/** Fonts, each drawn in itself, with a search box. Creatron's own fonts first, then the Mac's. */
function FontList({ value, onPick }: { value: string; onPick: (font: string) => void }) {
  const [q, setQ] = useState("");
  const shown = CAPTION_FONTS.filter((f) => f.toLowerCase().includes(q.trim().toLowerCase()));
  const groups: [string, string[]][] = [
    ["Creatron fonts", shown.filter((f) => BUNDLED.has(f))],
    ["On this Mac", shown.filter((f) => !BUNDLED.has(f))],
  ];
  return (
    <div className="ctb-panel ctb-fonts" onPointerDown={(e) => e.stopPropagation()}>
      <label className="ctb-search">
        <Icon name="search" size={13} />
        <input autoFocus placeholder="Search fonts…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="ctb-font-list">
        {groups.map(([title, fonts]) =>
          fonts.length ? (
            <div key={title}>
              <div className="ctb-group">{title}</div>
              {fonts.map((f) => (
                <button key={f} className={`ctb-font-item ${f === value ? "on" : ""}`} style={{ fontFamily: `"${f}"` }} onClick={() => onPick(f)}>
                  <span>{f}</span>
                  {f === value && <Icon name="check" size={13} />}
                </button>
              ))}
            </div>
          ) : null,
        )}
        {!shown.length && <p className="hint pad">No font called “{q}”.</p>}
      </div>
    </div>
  );
}

function ColorRow(p: {
  label: string; value: string; note?: string; onPick: (c: string) => void; onStart: () => void; onLive: (c: string) => void;
  reset?: { label: string; run: () => void };
}) {
  const [hex, setHex] = useState(p.value.slice(1).toUpperCase());
  useEffect(() => setHex(p.value.slice(1).toUpperCase()), [p.value]);
  return (
    <div className="ctb-row">
      <div className="ctb-row-head">
        <span>{p.label}</span>
        {p.note ? <span className="dim">{p.note}</span> : p.reset && <button className="link" onClick={p.reset.run}>{p.reset.label}</button>}
      </div>
      <div className="ctb-hex">
        <label className="ctb-chip" style={{ background: p.value }}>
          <input type="color" value={p.value} onPointerDown={p.onStart} onChange={(e) => p.onLive(e.target.value)} />
        </label>
        <input
          value={hex}
          maxLength={6}
          spellCheck={false}
          onChange={(e) => setHex(e.target.value.replace(/[^0-9a-f]/gi, "").toUpperCase())}
          onBlur={() => /^[0-9A-F]{6}$/.test(hex) ? p.onPick(`#${hex.toLowerCase()}`) : setHex(p.value.slice(1).toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        />
      </div>
      <div className="ctb-swatch-row">
        {SWATCHES.map((c) => <button key={c} className={`swatch ${p.value.toLowerCase() === c ? "on" : ""}`} style={{ background: c }} onClick={() => p.onPick(c)} />)}
      </div>
    </div>
  );
}

/** The box behind the text: a colour and how see-through it is, or off. */
function BackgroundRow({ look, onSet, onStart, onLive }: { look: ReturnType<typeof captionLook>; onSet: (p: CaptionLook) => void; onStart: () => void; onLive: (p: CaptionLook) => void }) {
  const current = look.background || (look.outline === "box" ? DEFAULT_BOX : "");
  const rgb = current ? current.slice(0, 7) : "#000000";
  const alpha = current ? parseInt(current.slice(7, 9), 16) : 0;
  const withAlpha = (c: string, a: number) => `${c}${Math.round(a).toString(16).padStart(2, "0")}`;
  return (
    <div className="ctb-row">
      <div className="ctb-row-head">
        <span>Background</span>
        {alpha === 0 ? <span className="dim">off</span> : <button className="link" onClick={() => onSet({ background: "", outline: look.outline === "box" ? "none" : look.outline })}>Turn off</button>}
      </div>
      <div className="ctb-hex">
        <label className="ctb-chip checker">
          <i style={{ background: alpha ? `${rgb}${current.slice(7, 9)}` : "transparent" }} />
          <input type="color" value={rgb} onPointerDown={onStart} onChange={(e) => onLive({ background: withAlpha(e.target.value, alpha || 140) })} />
        </label>
        <input
          type="range" min={0} max={255} value={alpha} title="How solid the box is"
          onPointerDown={onStart} onChange={(e) => onLive({ background: withAlpha(rgb, Number(e.target.value)) })}
        />
        <span className="ctb-pct">{Math.round((alpha / 255) * 100)}%</span>
      </div>
    </div>
  );
}
