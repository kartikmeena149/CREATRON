// "Sound effects" page: search Openverse's free sounds, preview them, and add one to the library
// (and onto a Sound FX track at the playhead). Only sounds that allow commercial use and editing
// are listed; CC BY ones need a credit, which is noted in work/sfx/CREDITS.md on download.
import { useEffect, useRef, useState } from "react";
import type { Sfx } from "../src/sfx.ts";
import { shortTime } from "./format.ts";
import { Icon } from "./icons.tsx";
import { MEDIA_DRAG } from "./Inspector.tsx";
import { useEditor } from "./store.ts";

const IDEAS = ["whoosh", "riser", "impact", "glitch", "click", "pop", "swipe", "ding", "camera shutter", "typing"];

// The last search, kept while you switch pages.
let last: { query: string; short: boolean; page: number; results: Sfx[]; more: boolean } | undefined;

export function SfxPanel() {
  const [query, setQuery] = useState(last?.query ?? "");
  const [short, setShort] = useState(last?.short ?? true);
  const [results, setResults] = useState<Sfx[]>(last?.results ?? []);
  const [page, setPage] = useState(last?.page ?? 0);
  const [more, setMore] = useState(last?.more ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState<string>();
  // Downloaded sounds by id: their file and real length.
  const [saved, setSaved] = useState<Record<string, { file: string; length: number } | "loading">>({});
  const audio = useRef<HTMLAudioElement>(null);
  const hasProject = useEditor((s) => Boolean(s.project));

  useEffect(() => () => audio.current?.pause(), []);

  const search = async (q = query, p = 1, s = short) => {
    if (!q.trim() || busy) return;
    setQuery(q);
    setBusy(true);
    setError("");
    const r = await window.creatron.sfxSearch(q, p, s);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    const next = p === 1 ? r.value.results : [...results, ...r.value.results];
    setResults(next);
    setPage(p);
    setMore(r.value.more);
    last = { query: q, short: s, page: p, results: next, more: r.value.more };
  };

  const toggle = (s: Sfx) => {
    const el = audio.current!;
    if (playing === s.id) return el.pause();
    el.src = s.url;
    // Stopping (or picking another sound) before it loads interrupts play(): not an error.
    el.play().catch((e) => e?.name !== "AbortError" && setError(`Couldn't play “${s.title}”.`));
    setPlaying(s.id);
  };

  /** Downloads the sound into the library, and puts it at the playhead when a video is open. */
  const add = async (s: Sfx) => {
    const have = saved[s.id];
    if (have === "loading") return;
    let got = have;
    if (!got) {
      setSaved((m) => ({ ...m, [s.id]: "loading" }));
      const r = await window.creatron.sfxDownload(s);
      if (!r.ok) {
        setSaved(({ [s.id]: _, ...m }) => m);
        return setError(r.error);
      }
      got = r.value;
      setSaved((m) => ({ ...m, [s.id]: r.value }));
    }
    const st = useEditor.getState();
    st.addToLibrary(got.file);
    if (st.project) st.addVoiceover({ file: got.file, duration: got.length, text: s.title, voice: "", kind: "sfx", volumeDb: -4 });
  };

  return (
    <>
      <div className="lib-actions">
        <label className="lib-search">
          <Icon name="search" size={14} />
          <input value={query} placeholder="Search free sound effects…" onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") search(); }} />
        </label>
        <div className="lib-keep sfx-short" title="Only sounds under 30 seconds">
          <Icon name="bolt" size={13} />
          <span>Short sounds only</span>
          <button className={`toggle ${short ? "on" : ""}`} role="switch" aria-checked={short}
            onClick={() => { setShort(!short); if (query.trim()) search(query, 1, !short); }}><i /></button>
        </div>
      </div>

      {!results.length && !busy && (
        <div className="sfx-ideas">
          {IDEAS.map((i) => <button key={i} className="sfx-idea" onClick={() => search(i)}>{i}</button>)}
        </div>
      )}
      {error && <p className="error small pad">{error}</p>}
      {busy && page === 0 && <p className="hint pad">Searching Openverse…</p>}
      {!busy && page > 0 && !results.length && <p className="hint pad">No free sounds match “{query}”. Try a simpler word.</p>}

      <div className="sfx-list">
        {results.map((s) => {
          const have = saved[s.id];
          const file = have && have !== "loading" ? have : undefined;
          return (
            <div key={s.id} className={`sfx-row ${playing === s.id ? "on" : ""}`}
              title={`${s.title}\n${s.creator ? `by ${s.creator} · ` : ""}${s.source}${s.tags.length ? `\n${s.tags.join(", ")}` : ""}${file ? "\nDrag onto a track" : ""}`}
              draggable={Boolean(file)}
              onDragStart={(e) => {
                if (!file) return;
                e.dataTransfer.setData(MEDIA_DRAG, JSON.stringify({ path: file.file, length: file.length, audio: true }));
                e.dataTransfer.effectAllowed = "copy";
              }}>
              <button className="sfx-play" title={playing === s.id ? "Stop" : "Preview"} onClick={() => toggle(s)}>
                <Icon name={playing === s.id ? "pause" : "play"} size={12} fill />
              </button>
              <div className="sfx-text">
                <div className="sfx-title">{s.title}</div>
                <div className="sfx-meta">
                  {s.duration > 0 && <span>{s.duration < 10 ? `${s.duration.toFixed(1)}s` : shortTime(s.duration)}</span>}
                  <span className={`sfx-lic ${s.license === "CC0" || s.license === "Public domain" ? "free" : ""}`}
                    title={s.license === "CC0" || s.license === "Public domain" ? "No credit needed" : "Credit the creator (saved in work/sfx/CREDITS.md)"}>{s.license}</span>
                  <span className="dim">{s.source}</span>
                </div>
              </div>
              <button className="icon-btn" disabled={have === "loading"}
                title={file ? (hasProject ? "Add at the playhead again" : "In your library") : hasProject ? "Add at the playhead (Sound FX track)" : "Add to the library"}
                onClick={() => add(s)}>
                <Icon name={have === "loading" ? "download" : file && !hasProject ? "check" : "plus"} size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {more && results.length > 0 && (
        <div className="pad"><button className="wide-btn" disabled={busy} onClick={() => search(query, page + 1)}>{busy ? "Loading…" : "More sounds"}</button></div>
      )}
      <p className="hint pad">
        Free sounds from Openverse that allow commercial use. ＋ adds one {hasProject ? "at the playhead" : "to your library"}; once added, drag it onto any track. CC BY sounds need a credit, kept in work/sfx/CREDITS.md.
      </p>
      <audio ref={audio} onEnded={() => setPlaying(undefined)} onPause={() => setPlaying(undefined)} />
    </>
  );
}
