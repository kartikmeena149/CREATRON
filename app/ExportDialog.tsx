// The export window: pick what the video is for (one click sets everything), fine-tune if you
// like, name it and go. The preview shows the real frame and the export's size; while it renders the
// progress sits on the preview, and when it's done the file is one click away.
import { useEffect, useState } from "react";
import { outputSize } from "../src/frame.ts";
import { DEFAULT_EXPORT, EXPORT_PRESETS, type ExportOptions, estimateBytes, exportSize } from "../src/exportOptions.ts";
import { editDuration } from "../src/timeline.ts";
import { shortTime } from "./format.ts";
import { Icon, type IconName } from "./icons.tsx";
import { useEditor } from "./store.ts";
import { Orb } from "./Orb.tsx";

const OPTIONS_KEY = "creatron.exportOptions";
const DIR_KEY = "creatron.exportDir";
const PRESET_ICONS: Record<string, IconName> = { reels: "phone", master: "sparkle", draft: "bolt" };
const RES_LABEL = { 720: "720p", 1080: "1080p", 1440: "2K", 2160: "4K" } as const;

const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, typeof v === "string" ? v : JSON.stringify(v));
  } catch {}
};

const megabytes = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

/** Starts the export and keeps the editor's progress up to date (the window can close meanwhile). */
async function startExport(options: ExportOptions & { dir: string; name: string }) {
  const s = useEditor.getState();
  if (!s.project || !s.plan.segments.length || s.exporting !== null) return;
  s.set({ exporting: 0, exported: undefined, exportError: undefined });
  const r = await window.creatron.exportVideo(s.project.path, s.plan, options);
  useEditor.getState().set({ exporting: null, exported: r.ok ? r.value : undefined, exportError: r.ok ? undefined : r.error });
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { project, plan, exporting, exported, exportError, status } = useEditor();
  const [opts, setOpts] = useState<ExportOptions>(() => load(OPTIONS_KEY, DEFAULT_EXPORT));
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState(() => (project ? project.path.split("/").pop()!.replace(/\.[^.]+$/, "") : "Creatro export"));
  const [dir, setDir] = useState(() => {
    try {
      return localStorage.getItem(DIR_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [bytes, setBytes] = useState(0);
  // Only a finish from this window's own export shows the "done" page.
  const [started, setStarted] = useState(exporting !== null);

  useEffect(() => void (!dir && window.creatron.exportDir().then(setDir)), []);
  useEffect(() => void (exported && window.creatron.fileSize(exported).then(setBytes)), [exported]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.metaKey || !(e.target instanceof HTMLInputElement))) go();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!project) return null;
  const base = outputSize(plan, project.analysis);
  const size = exportSize(base, opts.resolution);
  const seconds = editDuration(plan);
  const sourceShort = Math.min(project.analysis.width, project.analysis.height) || 1080;
  const preset = EXPORT_PRESETS.find((p) => (Object.keys(p.options) as (keyof typeof p.options)[]).every((k) => p.options[k] === opts[k]));
  const phase = exporting !== null ? "rendering" : started && exported ? "done" : started && exportError ? "error" : "setup";
  const portrait = size.height > size.width;

  const change = (patch: Partial<ExportOptions>) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    save(OPTIONS_KEY, next);
  };
  const pickDir = async () => {
    const d = await window.creatron.pickFolder(dir);
    if (d) (setDir(d), save(DIR_KEY, d));
  };
  function go() {
    if (phase === "done") return onClose();
    if (phase !== "setup" && phase !== "error") return;
    setStarted(true);
    startExport({ ...opts, dir, name });
  }

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="xp" onKeyDown={(e) => e.stopPropagation()}>
        <div className={`xp-stage ${portrait ? "tall" : "wide"}`}>
          <div className={`xp-frame ${phase}`} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
            {project.analysis.width > 0
              ? <video src={`${project.videoUrl}#t=${(plan.segments[0]?.start ?? 0) + 0.5}`} muted preload="auto" />
              : <div className="xp-audio"><Icon name="wave" size={40} /></div>}
            {phase === "rendering" && (
              <div className="xp-veil">
                <Orb progress={exporting!} />
                <span className="xp-pct">{Math.round(exporting! * 100)}%</span>
                {/* The renderer's own steps read fine, except its technical summary line. */}
                <span className="xp-status">{!status || /segments ->/.test(status) ? "Rendering your video…" : status}</span>
              </div>
            )}
            {phase === "done" && (
              <div className="xp-veil done">
                <Orb done />
              </div>
            )}
          </div>
          <div className="xp-specs">
            <span>{size.width} × {size.height}</span><i />
            <span>{opts.fps} fps</span><i />
            <span>{shortTime(seconds)}</span>
          </div>
        </div>

        <div className="xp-side">
          <header className="xp-head">
            <h2>{phase === "done" ? "Your video is ready" : phase === "rendering" ? "Exporting…" : "Export"}</h2>
            <button className="icon-btn" title="Close (Esc)" onClick={onClose}><Icon name="close" /></button>
          </header>

          {phase === "done" ? (
            <div className="xp-done">
              <div className="xp-file">
                <Icon name="video" size={18} />
                <div>
                  <div className="xp-file-name">{exported!.split("/").pop()}</div>
                  <div className="dim small">{megabytes(bytes)} · {exported!.split("/").slice(-2, -1)[0]}{opts.mp3 ? " · mp3 saved too" : ""}</div>
                </div>
              </div>
              <div className="xp-done-actions">
                <button className="xp-btn" onClick={() => window.creatron.openFile(exported!)}><Icon name="play" size={13} fill /> Play</button>
                <button className="xp-btn" onClick={() => window.creatron.reveal(exported!)}><Icon name="folder" size={14} /> Show in Finder</button>
              </div>
              <button className="link small" onClick={() => setStarted(false)}>Export another version</button>
            </div>
          ) : (
            <fieldset className="xp-body" disabled={phase === "rendering"}>
              <label className="xp-name">
                <input value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} />
                <span className="dim">.mp4</span>
              </label>
              <button className="xp-dir" title={dir} onClick={pickDir}>
                <Icon name="folder" size={13} />
                <span>{dir.split("/").pop() || "Choose a folder"}</span>
                <Icon name="chevronDown" size={12} />
              </button>

              <div className="xp-label">Made for</div>
              <div className="xp-presets">
                {EXPORT_PRESETS.map((p) => (
                  <button key={p.id} className={`xp-preset ${preset?.id === p.id ? "on" : ""}`} onClick={() => change(p.options)}>
                    <span className="xp-preset-icon"><Icon name={PRESET_ICONS[p.id]} size={16} /></span>
                    <b>{p.name}</b>
                    <span className="xp-preset-spec">{RES_LABEL[p.options.resolution]} · {p.options.codec === "hevc" ? "HEVC" : "H.264"}</span>
                    <span className="xp-preset-blurb">{p.blurb}</span>
                  </button>
                ))}
              </div>

              <button className={`xp-custom-toggle ${custom ? "open" : ""}`} onClick={() => setCustom(!custom)}>
                <Icon name="sliders" size={14} />
                <span>{preset ? "Customize" : "Custom settings"}</span>
                <span className="dim small">{RES_LABEL[opts.resolution]} · {opts.fps} fps · {opts.quality} · {opts.codec === "hevc" ? "HEVC" : "H.264"}</span>
                <Icon name="chevronDown" size={13} />
              </button>
              {custom && (
                <div className="xp-custom">
                  <Choice label="Resolution" value={opts.resolution} onChange={(resolution) => change({ resolution })}
                    options={([720, 1080, 1440, 2160] as const).map((r) => [r, RES_LABEL[r]])}
                    hint={opts.resolution > sourceShort ? `Your footage is ${sourceShort}p, so this is upscaled` : undefined} />
                  <Choice label="Frame rate" value={opts.fps} onChange={(fps) => change({ fps })} options={[[24, "24"], [30, "30"], [60, "60"]]}
                    hint={opts.fps > project.analysis.fps + 1 ? `Your footage is ${Math.round(project.analysis.fps)} fps: frames are repeated, not smoother` : undefined} />
                  <Choice label="Quality" value={opts.quality} onChange={(quality) => change({ quality })} options={[["small", "Smaller"], ["balanced", "Balanced"], ["best", "Best"]]} />
                  <Choice label="Format" value={opts.codec} onChange={(codec) => change({ codec })} options={[["h264", "H.264"], ["hevc", "HEVC"]]}
                    hint={opts.codec === "hevc" ? "About half the size; slower to export" : "Plays everywhere"} />
                  {project.analysis.hasAudio && (
                    <div className="xp-row">
                      <span>Also save the sound as mp3</span>
                      <button className={`toggle ${opts.mp3 ? "on" : ""}`} role="switch" aria-checked={opts.mp3} onClick={() => change({ mp3: !opts.mp3 })}><i /></button>
                    </div>
                  )}
                </div>
              )}
              {phase === "error" && <p className="error small">Export failed: {exportError}</p>}
            </fieldset>
          )}

          {phase !== "done" && (
            <footer className="xp-foot">
              <div className="xp-estimate">
                <b>≈ {megabytes(estimateBytes(opts, size, seconds, project.analysis.hasAudio))}</b>
                <span className="dim small">estimated size</span>
              </div>
              {phase === "rendering" ? (
                <button className="xp-go" onClick={onClose} title="Keeps exporting; the progress shows on the Export button">
                  {Math.round(exporting! * 100)}% · Hide
                </button>
              ) : (
                <button className="xp-go" disabled={!plan.segments.length || !dir} onClick={go}>
                  Export <kbd>↵</kbd>
                </button>
              )}
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}

function Choice<T extends string | number>(p: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; hint?: string }) {
  return (
    <div className="xp-choice">
      <span className="xp-choice-label">{p.label}</span>
      <div className="xp-seg">
        {p.options.map(([v, label]) => (
          <button key={String(v)} className={v === p.value ? "on" : ""} onClick={() => p.onChange(v)}>{label}</button>
        ))}
      </div>
      {p.hint && <span className="xp-hint">{p.hint}</span>}
    </div>
  );
}
