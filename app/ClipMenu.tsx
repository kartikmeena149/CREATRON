// The clip menu: right-click (or double-click) any clip on the timeline, or anything in the Library.
import { useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import * as act from "./clipActions.ts";
import { Icon, type IconName } from "./icons.tsx";
import { freeTrack } from "../src/tracks.ts";
import { isGeneratedVoice, isImage } from "./format.ts";
import { locate, useEditor } from "./store.ts";

/** What was right-clicked: a clip, one caption on the Captions track, or a file in the Library. */
type Media = { kind: "media"; path: string; length?: number; audio: boolean; made: boolean; onOpenMain: (path: string) => void };
type Target = act.ClipRef | { kind: "caption"; index: number } | Media;

const useMenu = create<{ open: { x: number; y: number; ref: Target; group?: boolean } | null }>(() => ({ open: null }));

/** Opens the menu for a file in the Library (it knows whether Creatro made the file, so it may be trashed). */
export async function openMediaMenu(e: React.MouseEvent, media: Omit<Media, "kind" | "made">) {
  e.preventDefault();
  e.stopPropagation();
  const at = { x: e.clientX, y: e.clientY };
  const made = await window.creatron.madeByCreatron(media.path);
  useMenu.setState({ open: { ...at, ref: { kind: "media", ...media, made } } });
}

/** Opens the menu for a clip at the pointer, and selects the clip. */
export function openClipMenu(e: React.MouseEvent, ref: Exclude<Target, Media>) {
  e.preventDefault();
  e.stopPropagation();
  const s = useEditor.getState();
  // Right-clicking a clip inside a multi-selection acts on the whole selection.
  const inGroup = ref.kind !== "caption" && act.groupRefs().some((r) => (r.kind === "segment" ? ref.kind === "segment" && r.index === ref.index : "id" in ref && r.id === ref.id));
  if (inGroup) return useMenu.setState({ open: { x: e.clientX, y: e.clientY, ref, group: true } });
  if (ref.kind === "caption") s.selectCue(ref.index);
  else act.select(ref);
  // The playhead jumps to where you clicked, so "Split at playhead" cuts right there.
  const lane = (e.currentTarget as HTMLElement).parentElement;
  if (lane) s.seek((e.clientX - lane.getBoundingClientRect().left) / s.pxPerSec);
  useMenu.setState({ open: { x: e.clientX, y: e.clientY, ref } });
}

export function ClipMenu() {
  const open = useMenu((s) => s.open);
  useEditor((s) => s.plan); // re-check what applies after each change
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // Keep the menu on screen.
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPos({ x: Math.min(open.x, innerWidth - r.width - 8), y: Math.min(open.y, innerHeight - r.height - 8) });
  }, [open]);
  if (!open) return null;
  const { ref } = open;
  const close = () => useMenu.setState({ open: null });
  const run = (f: () => void) => () => (f(), close());

  const item = (icon: IconName, label: string, onClick: () => void, keys?: string, opts: { disabled?: boolean; danger?: boolean; title?: string; on?: boolean } = {}) => (
    <button key={label} className={opts.danger ? "danger" : ""} disabled={opts.disabled} title={opts.title} onClick={run(onClick)}>
      <Icon name={icon} size={14} />
      <span>{label}</span>
      {opts.on && <Icon name="check" size={13} />}
      {keys && <kbd>{keys}</kbd>}
    </button>
  );
  const sep = (key: string) => <div key={key} className="menu-sep" />;

  return (
    <>
      <div className="menu-catcher" onPointerDown={close} onContextMenu={(e) => (e.preventDefault(), close())} />
      <div className="clip-menu" ref={box} style={{ left: pos.x || open.x, top: pos.y || open.y }}>
        {open.group ? groupItems(item, sep) : ref.kind === "caption" ? captionItems(ref.index, item, sep) : ref.kind === "media" ? mediaItems(ref, item, sep) : clipItems(ref, item, sep)}
      </div>
    </>
  );
}

type Item = (icon: IconName, label: string, onClick: () => void, keys?: string, opts?: { disabled?: boolean; danger?: boolean; title?: string; on?: boolean }) => React.ReactNode;

function clipItems(ref: act.ClipRef, item: Item, sep: (key: string) => React.ReactNode) {
  const s = useEditor.getState();
  const playheadInside = (() => {
    if (ref.kind === "segment") return s.plan.segments.length > 0 && locate(s.plan, s.time).index === ref.index;
    const c = [...s.plan.broll, ...s.plan.motion, ...s.plan.voiceovers].find((x) => x.id === ref.id);
    return Boolean(c && s.time > c.at + 0.2 && s.time < c.at + c.duration - 0.2);
  })();
  const list: React.ReactNode[] = [];
  // Editing the text itself comes first for text clips.
  if (ref.kind === "motion" && act.textStyle(ref) === "scene") {
    list.push(item("layers", "Open layers", () => s.set({ openScene: ref.id, selectedLayer: null, sceneKey: null, leftView: "text" })));
    list.push(sep("text"));
  } else if (ref.kind === "motion") {
    list.push(item("type", "Edit text", () => s.set({ leftView: "text" })));
    if (act.textStyle(ref) !== "custom") {
      list.push(item("type", "Big title", () => act.setTextStyle(ref, "title"), undefined, { on: act.textStyle(ref) === "title" }));
      list.push(item("layers", "Lower third", () => act.setTextStyle(ref, "lower-third"), undefined, { on: act.textStyle(ref) === "lower-third" }));
    }
    list.push(sep("text"));
  }
  list.push(item("copy", "Copy", () => act.copy(ref), "⌘C"));
  if (act.hasClipboard()) list.push(item("paste", "Paste at playhead", act.paste, "⌘V"));
  list.push(item("duplicate", "Duplicate", () => act.duplicate(ref), "⌘D"));
  list.push(item("scissors", "Split at playhead", () => act.split(ref), "S", { disabled: !playheadInside, title: playheadInside ? undefined : "Move the playhead into this clip first" }));
  if (act.canHide(ref)) list.push(item(act.isHidden(ref) ? "eye" : "eyeOff", act.isHidden(ref) ? "Show" : "Hide", () => act.toggleHide(ref)));
  list.push(item("trash", deleteLabel(ref), () => act.remove(ref), "⌫", { danger: true }));
  if (ref.kind === "segment" && s.plan.segments[ref.index]?.picture === false)
    list.push(item("video", "Restore picture", () => s.updateSegment(ref.index, { picture: undefined })));
  if (ref.kind === "segment" && s.plan.segments[ref.index]?.sound === false)
    list.push(item("volume", "Restore sound", () => s.updateSegment(ref.index, { sound: undefined })));
  if (act.canMute(ref)) {
    list.push(sep("sound"));
    list.push(item(act.isMuted(ref) ? "volume" : "mute", act.isMuted(ref) ? "Unmute" : "Mute", () => act.toggleMute(ref), "M"));
  }
  if (ref.kind === "audio") {
    list.push(item("wave", "Fade in", () => act.toggleFade(ref, "fadeIn"), undefined, { on: act.hasFade(ref, "fadeIn") }));
    list.push(item("wave", "Fade out", () => act.toggleFade(ref, "fadeOut"), undefined, { on: act.hasFade(ref, "fadeOut") }));
    list.push(item("sliders", "Volume and fades…", () => s.set({ leftView: "audio" })));
  }
  if (ref.kind === "segment") list.push(item("wave", "Remove silences", () => act.removeSilences(ref), "⇧S"));
  return list;
}

/** A multi-selection: what applies to all of it at once. */
function groupItems(item: Item, sep: (key: string) => React.ReactNode) {
  const refs = act.groupRefs();
  const sound = refs.filter(act.canMute);
  const allMuted = sound.length > 0 && sound.every(act.isMuted);
  const s = useEditor.getState();
  return [
    ...(sound.length ? [item(allMuted ? "volume" : "mute", `${allMuted ? "Unmute" : "Mute"} ${refs.length} clips`, () => act.toggleMuteGroup(refs), "M")] : []),
    item("close", "Clear selection", () => s.setSelection([], [])),
    sep("group"),
    item("trash", `Delete ${refs.length} clips`, () => s.deleteSelection(), "⌫", { danger: true }),
  ];
}

/** Captions follow the words, so they're edited and removed, not copied around. */
function captionItems(index: number, item: Item, sep: (key: string) => React.ReactNode) {
  const s = useEditor.getState();
  return [
    item("type", "Edit caption", () => s.set({ leftView: "captions" })),
    item("plus", "Add caption at playhead", () => s.addCaption()),
    item("cc", "Caption style…", () => s.set({ leftView: "captions" })),
    sep("caption"),
    item("eyeOff", "Hide all captions", () => s.setCaptionStyle({ enabled: false })),
    item("trash", "Delete caption", () => s.deleteCaption(index), "⌫", { danger: true }),
  ];
}

/** A main-track clip deletes only its selected half (picture or sound) while it still has both. */
function deleteLabel(ref: act.ClipRef): string {
  if (ref.kind !== "segment") return "Delete";
  const s = useEditor.getState();
  const seg = s.plan.segments[ref.index];
  const picture = Boolean(s.project?.analysis.width) && seg?.picture !== false;
  const sound = Boolean(s.project?.analysis.hasAudio) && seg?.sound !== false;
  if (!picture || !sound) return "Delete";
  return s.selectedPart === "sound" ? "Delete sound" : "Delete picture";
}

/**
 * A file in the Library: put it on the timeline at the playhead, make it the main track, find it,
 * or take it out of the library. Files Creatro made (downloads, voiceovers) can go to the Trash
 * (and come back from there) while nothing uses them; your own files are never deleted from here.
 */
function mediaItems(m: Media, item: Item, sep: (key: string) => React.ReactNode) {
  const s = useEditor.getState();
  const name = m.path.split("/").pop() ?? m.path;
  const isMain = s.project?.path === m.path;
  const used = isMain || s.plan.broll.some((b) => b.file === m.path) || s.plan.voiceovers.some((v) => v.file === m.path);
  const photo = isImage(m.path);
  const len = !photo && m.length && Number.isFinite(m.length) ? m.length : 5;
  const voice = isGeneratedVoice(m.path);
  const addToTimeline = () => {
    if (m.audio) {
      const kind = voice ? "voice" : "music";
      return s.addVoiceover({ file: m.path, duration: len, text: name, voice: "", kind, track: freeTrack(s.plan, kind, s.time, len), volumeDb: kind === "music" ? -12 : 0 });
    }
    s.addBroll({ file: m.path, length: photo ? 3600 : len, duration: len, source: `library:${m.path}`, query: name, track: freeTrack(s.plan, "video", s.time, len) });
  };
  const forget = () => {
    const st = useEditor.getState();
    st.set({ library: st.library.filter((p) => p !== m.path), voiceTakes: st.voiceTakes.filter((t) => t.file !== m.path) });
  };
  return [
    item("plus", m.audio ? (voice ? "Add to a voiceover track" : "Add to a music track") : "Add to timeline", addToTimeline, undefined, {
      disabled: !s.project || isMain, title: isMain ? "This is the main track" : s.project ? "At the playhead, on a free track" : "Open a main video first",
    }),
    ...(photo ? [] : [item("video", m.audio ? "Use as main audio" : "Use as main video", () => m.onOpenMain(m.path), undefined, {
      disabled: isMain, title: isMain ? "It's already the main track" : m.audio ? "Makes a faceless video over this recording" : undefined,
    })]),
    sep("find"),
    item("folder", "Show in Finder", () => void window.creatron.reveal(m.path)),
    item("copy", "Copy file path", () => void navigator.clipboard.writeText(m.path)),
    sep("remove"),
    item("close", "Remove from library", forget, undefined, {
      disabled: isMain, title: isMain ? "The main track stays in the library" : "The file stays on your Mac",
    }),
    ...(m.made ? [item("trash", "Move to Trash", async () => {
      if (!confirm(`Move “${name}” to the Trash?\n\nYou can put it back from the Trash.`)) return;
      const r = await window.creatron.trashMedia(m.path);
      if (r.ok) forget();
      else alert(r.error);
    }, undefined, { danger: true, disabled: used, title: used ? "It's used in this edit: take it off the timeline first" : "Moves the file to the Trash" })] : []),
  ];
}
