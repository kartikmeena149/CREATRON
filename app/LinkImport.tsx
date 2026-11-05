// "＋ Import from link": paste a YouTube / Instagram / X / Vimeo… link, see what it is, then
// download it (or just a from-to part) into the library, onto the timeline at the playhead
// (full length, with its sound), or as the main video.
// The first time, the user agrees once that they have the right to use what they download.
import { useEffect, useState } from "react";
import type { LinkInfo } from "../src/webvideo.ts";
import { shortTime } from "./format.ts";
import { freeTrack } from "../src/tracks.ts";
import { useEditor } from "./store.ts";

const RIGHTS_KEY = "creatron.linkRightsAgreed";

export function rightsAgreed(): boolean {
  try {
    return localStorage.getItem(RIGHTS_KEY) === "yes";
  } catch {
    return false;
  }
}

/** The one-time agreement, shown before the first download from a link. */
export function RightsAgreement({ onAgree, onCancel }: { onAgree: () => void; onCancel?: () => void }) {
  return (
    <div className="rights">
      <b>Before you download from links</b>
      <p>
        These are my videos, or I have permission, or they're licensed for reuse. I'm responsible for how I use
        what I download.
      </p>
      <p className="dim small">You'll only be asked once on this Mac.</p>
      <div className="rights-actions">
        {onCancel && <button className="ghost" onClick={onCancel}>Cancel</button>}
        <button
          className="primary"
          onClick={() => {
            try {
              localStorage.setItem(RIGHTS_KEY, "yes");
            } catch {}
            onAgree();
          }}
        >
          I agree
        </button>
      </div>
    </div>
  );
}

type Info = Omit<LinkInfo, "captions" | "chapters">;

/** "1:23", "83" or "1:02:03" → seconds; undefined when empty or not a time. */
function parseTime(s: string): number | undefined {
  if (!s.trim()) return undefined;
  const parts = s.trim().split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  return parts.reduce((sum, n) => sum * 60 + n, 0);
}

export function LinkImport({ onClose, onOpenMain }: { onClose: () => void; onOpenMain: (path: string) => void }) {
  const { project } = useEditor();
  const [agreed, setAgreed] = useState(rightsAgreed);
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<Info>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<"" | "looking" | "downloading">("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => window.creatron.onLinkProgress(setProgress), []);

  const lookUp = async () => {
    if (!url.trim() || busy) return;
    setBusy("looking");
    setError("");
    setInfo(undefined);
    const r = await window.creatron.linkInfo(url.trim());
    setBusy("");
    if (r.ok) setInfo(r.value);
    else setError(r.error);
  };

  const start = parseTime(from);
  const end = parseTime(to);
  const rangeError =
    (from.trim() && start === undefined) || (to.trim() && end === undefined)
      ? "Write times like 1:05 or 65."
      : start !== undefined && end !== undefined && end <= start
        ? "The end has to be after the start."
        : info && end !== undefined && end > info.duration + 0.5
          ? `The video is only ${shortTime(info.duration)} long.`
          : "";
  const range = info && (start !== undefined || end !== undefined) ? { start: start ?? 0, end: Math.min(end ?? info.duration, info.duration) } : {};

  const download = async (to: "library" | "timeline" | "main") => {
    if (!info || busy || rangeError) return;
    setBusy("downloading");
    setProgress(0);
    setError("");
    const r = await window.creatron.linkDownload({ url: info.url, id: info.id, site: info.site, ...range, purpose: to === "main" ? "main" : "broll" });
    setBusy("");
    if (!r.ok) return setError(r.error);
    const s = useEditor.getState();
    onClose();
    if (to === "main") return onOpenMain(r.value.file);
    // Whatever you download lands in the library, so you can drag it anywhere later.
    s.addToLibrary(r.value.file);
    if (to === "library") return s.set({ leftView: "media" });
    const credit = `${info.title}${info.channel ? ` by ${info.channel}` : ""} (${info.site}) ${info.url}`;
    const length = r.value.length;
    const track = freeTrack(s.plan, "video", s.time, length);
    s.addBroll({ file: r.value.file, length, duration: length, track, source: `link:${info.site.toLowerCase()}:${info.id}`, query: info.title, credit });
  };

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="link-card" onKeyDown={(e) => e.stopPropagation()}>
        {!agreed ? (
          <RightsAgreement onAgree={() => setAgreed(true)} onCancel={onClose} />
        ) : (
          <>
            <div className="link-head">
              <b>Import from link</b>
              <button className="ghost" disabled={Boolean(busy)} onClick={onClose}>✕</button>
            </div>
            <div className="link-row">
              <input
                className="vl-input"
                autoFocus
                placeholder="Paste a YouTube, Instagram, X, Vimeo… link"
                value={url}
                disabled={busy === "downloading"}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookUp()}
              />
              <button disabled={!url.trim() || Boolean(busy)} onClick={lookUp}>{busy === "looking" ? "Looking…" : "Look up"}</button>
            </div>
            {info && (
              <div className="link-info">
                {info.thumbnail && <img src={info.thumbnail} alt="" />}
                <div>
                  <div className="link-title">{info.title}</div>
                  <div className="dim small">
                    {[info.channel, info.site, shortTime(info.duration)].filter(Boolean).join(" · ")}
                    {info.cc && " · Creative Commons"}
                  </div>
                  <div className="link-range">
                    <span className="dim small">Only part of it (optional):</span>
                    <input className="vl-input" placeholder="from 0:00" value={from} onChange={(e) => setFrom(e.target.value)} />
                    <input className="vl-input" placeholder={`to ${shortTime(info.duration)}`} value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                  {rangeError && <div className="error small">{rangeError}</div>}
                </div>
              </div>
            )}
            {busy === "downloading" && (
              <div className="link-progress">
                <i style={{ width: `${Math.round(progress * 100)}%` }} />
                <span className="small">Downloading {Math.round(progress * 100)}%</span>
              </div>
            )}
            {error && <p className="error small">{error}</p>}
            {info && (
              <div className="link-actions">
                <button disabled={Boolean(busy) || Boolean(rangeError)} onClick={() => download("main")}>Open as main video</button>
                <button
                  disabled={!project?.analysis || !useEditor.getState().plan.segments.length || Boolean(busy) || Boolean(rangeError)}
                  title={project ? "Full length, with its sound, on a free video track at the playhead (also added to the library)" : "Open a main video first"}
                  onClick={() => download("timeline")}
                >
                  Add to timeline
                </button>
                <button className="primary" disabled={Boolean(busy) || Boolean(rangeError)} title="Download it into this project's library" onClick={() => download("library")}>
                  Add to library
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
