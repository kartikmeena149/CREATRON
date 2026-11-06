// Captions in the inspector, in two tabs: Presets (one click gives every caption a whole look)
// and Transcript (the words themselves). Fine-tuning a look happens in the caption style bar.
import { useEffect, useState } from "react";
import type { EditPlan } from "../src/schema.ts";
import { buildCues, captionsOf } from "../src/timeline.ts";
import { CaptionList } from "./CaptionList.tsx";
import { timecode } from "./format.ts";
import { Icon } from "./icons.tsx";
import { useEditor } from "./store.ts";

type Preset = {
  name: string;
  sample: string;
  look: Pick<EditPlan["captions"], "style" | "font" | "size" | "color" | "uppercase" | "animation" | "highlight" | "bold" | "italic" | "outline" | "behind">
    & { accents?: string[] }; // a palette the spoken word takes in turn, caption by caption
};

const base = { style: "bold", size: 1, uppercase: true, animation: "none", highlight: "#facc15", bold: true, italic: false, outline: "outline", behind: false } as const;

const GROUPS: { title: string; ai?: boolean; presets: Preset[] }[] = [
  {
    // Kartik's own styles, from his caption skills (kinetic, doc, block-glow, spec-stack), each with
    // its own animation (motion/StyledCaptions.tsx).
    title: "My Styles",
    presets: [
      { name: "Kinetic", sample: "millions of connections", look: { ...base, font: "Inter", size: 1.2, color: "#f5ecc2", uppercase: false, animation: "kinetic", highlight: "#cb2f43", accents: ["#006eb8", "#819238", "#cb2f43"], outline: "none" } },
      { name: "Doc", sample: "Since 2010", look: { ...base, font: "Anton", size: 1.3, color: "#ffffff", animation: "doc", highlight: "#ffd21f", bold: false, outline: "none" } },
      { name: "Block glow", sample: "finished mapping the brain", look: { ...base, font: "Inter", size: 0.75, color: "#ffffff", uppercase: false, animation: "glow", bold: false, outline: "none" } },
      { name: "Spec stack", sample: "the first robot hand", look: { ...base, font: "Inter", color: "#ffffff", uppercase: false, animation: "spec", highlight: "#c8ff3d", outline: "none" } },
    ],
  },
  {
    title: "Behind Subject",
    ai: true,
    presets: [
      { name: "Billboard", sample: "You know the best", look: { ...base, font: "Anton", size: 2.2, color: "#ffe14d", outline: "none", behind: true } },
      { name: "Sideline", sample: "And the best part", look: { ...base, font: "Bebas Neue", size: 2.2, color: "#a3e635", outline: "none", behind: true } },
      { name: "Marquee", sample: "Most exciting part", look: { ...base, font: "Poppins", size: 1.4, color: "#ffffff", uppercase: false, animation: "highlight", highlight: "#ff5a5a", outline: "none", behind: true } },
      { name: "Longhand", sample: "you know what?", look: { ...base, font: "Permanent Marker", size: 1.5, color: "#6ef59a", uppercase: false, bold: false, outline: "none", behind: true } },
      { name: "Headline", sample: "Make it real", look: { ...base, font: "Archivo Black", size: 1.9, color: "#ffffff", outline: "none", behind: true } },
      { name: "Comic", sample: "Build something", look: { ...base, font: "Bangers", size: 2, color: "#ffd600", italic: true, outline: "none", behind: true } },
    ],
  },
  {
    title: "Classic",
    presets: [
      { name: "Bold", sample: "This is the part", look: { ...base, font: "Arial Black", color: "#ffffff" } },
      { name: "Hype", sample: "This changes everything", look: { ...base, font: "Archivo Black", size: 1.1, color: "#ffffff", animation: "highlight", accents: ["#ffe14d", "#6ef59a", "#ff7ac6"] } },
      { name: "Karaoke", sample: "Say it out loud", look: { ...base, font: "Poppins", color: "#ffffff", animation: "highlight", highlight: "#ffe14d" } },
      { name: "One word", sample: "Boom", look: { ...base, font: "Luckiest Guy", size: 1.6, color: "#ffffff", animation: "word", highlight: "#5ee1ff" } },
      { name: "Pop", sample: "Pop it in", look: { ...base, font: "Lilita One", size: 1.2, color: "#ffffff", animation: "pop" } },
      { name: "Boxed", sample: "Clean and clear", look: { ...base, style: "minimal", font: "Poppins", color: "#ffffff", uppercase: false, outline: "box" } },
      { name: "Subtle", sample: "Just the words", look: { ...base, style: "minimal", font: "Helvetica Neue", size: 0.9, color: "#ffffff", uppercase: false, bold: false, outline: "none" } },
    ],
  },
];

export function CaptionStyle() {
  const { project, plan, setCaptionStyle } = useEditor();
  const [tab, setTab] = useState<"presets" | "transcript">("presets");
  if (!project) return null;
  const caps = plan.captions;

  return (
    <section className="caption-style">
      <h3>
        Captions
        <Switch value={caps.enabled} onChange={(enabled) => setCaptionStyle({ enabled })} />
      </h3>
      <div className="segmented cap-tabs">
        <button className={tab === "presets" ? "on" : ""} onClick={() => setTab("presets")}><Icon name="grid" size={14} /> Presets</button>
        <button className={tab === "transcript" ? "on" : ""} onClick={() => setTab("transcript")}><Icon name="type" size={14} /> Transcript</button>
      </div>
      {tab === "presets" ? <Presets /> : caps.enabled ? <Transcript /> : <p className="hint">Turn captions on, or pick a preset, to see the transcript.</p>}
    </section>
  );
}

function Presets() {
  const { project, plan, setCaptionStyle } = useEditor();
  const caps = plan.captions;
  const picture = project!.analysis.width > 0;
  const isOn = (p: Preset) => caps.enabled && (Object.keys(p.look) as (keyof Preset["look"])[]).every((k) => k !== "accents" && caps[k] === p.look[k])
    && (caps.accents ?? []).join() === (p.look.accents ?? []).join();

  const apply = (p: Preset) => {
    // A preset is the whole look: per-caption changes from the style bar make way for it.
    const cues = caps.cues?.map(({ look: _, ...c }) => c);
    setCaptionStyle({ ...p.look, wrapAt: p.look.size, accents: p.look.accents ?? [], underline: false, strike: false, enabled: true, ...(cues ? { cues } : {}) });
    if (p.look.behind) useEditor.getState().prepareCutout();
  };

  return (
    <div className="cap-presets">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="cap-group">{g.title}{g.ai && <span className="cap-badge">AI</span>}</div>
          <div className="cap-grid">
            {g.presets.map((p) => {
              const blocked = p.look.behind && !picture;
              return (
                <button key={p.name} className={`cap-tile ${isOn(p) ? "on" : ""}`} disabled={blocked}
                  title={blocked ? "Needs a video with a person in it" : `Use ${p.name} for every caption`} onClick={() => apply(p)}>
                  <PresetSample preset={p} />
                  {(p.look.accents?.length ?? 0) > 1 && <span className="cap-palette">{p.look.accents!.map((c) => <i key={c} style={{ background: c }} />)}</span>}
                  {p.look.behind && <svg className="cap-person" viewBox="0 0 100 100" aria-hidden><circle cx="50" cy="40" r="15" /><path d="M18 100c0-22 14-38 32-38s32 16 32 38z" /></svg>}
                  <span className="cap-name">{p.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="hint">Tweak the font, size and colours by clicking a caption in the video.</p>
    </div>
  );
}

function PresetSample({ preset: { sample, look } }: { preset: Preset }) {
  const words = sample.split(" ");
  // The coloured word: the one being said (highlight), or the key word in Kartik's styles.
  const spoken = look.animation === "highlight" ? 1 : ["kinetic", "doc", "spec"].includes(look.animation) ? words.length - 1 : -1;
  return (
    <span
      className={`cap-sample ${look.behind ? "behind" : ""} ${look.outline}`}
      style={{
        fontFamily: `"${look.font}"`,
        fontWeight: look.bold ? 800 : 400,
        fontStyle: look.italic ? "italic" : undefined,
        textTransform: look.uppercase ? "uppercase" : undefined,
        color: look.color,
        fontSize: `${Math.min(1.9, 0.75 + look.size * 0.35)}em`,
      }}
    >
      {look.animation === "word" ? words[0] : words.map((w, i) => <span key={i} style={i === spoken ? { color: look.accents?.[0] ?? look.highlight } : undefined}>{w} </span>)}
    </span>
  );
}

function Transcript() {
  const { plan, checkpoint, setCaptionStyle, selectedCue, addCaption, resetCaptions } = useEditor();
  const caps = plan.captions;
  return (
    <>
      {caps.cues ? (
        <div className="row">
          <div>
            <div>Edited captions</div>
            <div className="hint">{caps.cues.length} captions, your own wording</div>
          </div>
          <button className="small-btn" onClick={resetCaptions} title="Throw away caption edits and re-caption from your speech">
            Regenerate
          </button>
        </div>
      ) : (
        <label className="slider">
          <span className="slider-head"><span>Words per caption</span><span className="value">{caps.wordsPerCaption}</span></span>
          <input type="range" min={1} max={8} step={1} value={caps.wordsPerCaption}
            onPointerDown={checkpoint} onChange={(e) => setCaptionStyle({ wordsPerCaption: Number(e.target.value) }, false)} />
        </label>
      )}

      <button className="wide-btn" onClick={addCaption}>＋ Add caption at playhead</button>

      {selectedCue !== null && <SelectedCaption index={selectedCue} />}
      <CaptionList />
    </>
  );
}

function SelectedCaption({ index }: { index: number }) {
  const { project, plan, editCaption, deleteCaption, selectCue } = useEditor();
  const caption = captionsOf(plan, project!.analysis.words)[index];
  const placed = buildCues(plan, project!.analysis.words).find((c) => c.index === index);
  const [text, setText] = useState(caption?.text ?? "");
  useEffect(() => setText(caption?.text ?? ""), [index, caption?.text]);
  if (!caption) return null;
  const hasOwnPosition = caption.x !== undefined || caption.y !== undefined;

  return (
    <div className="selected-caption">
      <div className="selected-head">
        <span>Selected caption</span>
        <button className="link" onClick={() => selectCue(null)}>Done</button>
      </div>
      <textarea
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          const now = e.target.value; // the box itself, in case React hasn't re-rendered yet
          if (now.trim() && now !== caption.text) editCaption(index, { text: now });
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), (e.target as HTMLTextAreaElement).blur());
        }}
      />
      <div className="meta">
        {placed ? <span>Shows {timecode(placed.start)} – {timecode(placed.end)}</span> : <span>Cut out of the edit</span>}
      </div>
      <div className="selected-actions">
        {hasOwnPosition && (
          <button className="small-btn" onClick={() => editCaption(index, { x: undefined, y: undefined })}>
            Reset own position
          </button>
        )}
        <button className="small-btn danger" onClick={() => deleteCaption(index)}>Delete caption</button>
      </div>
    </div>
  );
}

function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle ${value ? "on" : ""}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}><i /></button>;
}
