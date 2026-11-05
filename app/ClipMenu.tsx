// The clip menu: right-click (or double-click) any clip on the timeline.
import { useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import * as act from "./clipActions.ts";
import { Icon, type IconName } from "./icons.tsx";
import { locate, useEditor } from "./store.ts";

/** What was right-clicked: a clip, or one caption on the Captions track. */
type Target = act.ClipRef | { kind: "caption"; index: number };

const useMenu = create<{ open: { x: number; y: number; ref: Target; group?: boolean } | null }>(() => ({ open: null }));

/** Opens the menu for a clip at the pointer, and selects the clip. */
export function openClipMenu(e: React.MouseEvent, ref: Target) {
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
        {open.group ? groupItems(item, sep) : ref.kind === "caption" ? captionItems(ref.index, item, sep) : clipItems(ref, item, sep)}
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
  if (ref.kind === "motion") {
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
  list.push(item("trash", "Delete", () => act.remove(ref), "⌫", { danger: true }));
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
