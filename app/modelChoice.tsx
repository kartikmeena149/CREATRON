// Which AI model edits: one choice for the whole app (the Home box and the chat show the same one),
// remembered on this Mac. Until you pick, it is your own connected plan: Claude first, then
// ChatGPT, and an OpenRouter model only when no plan is connected.
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { openHome } from "./Dashboard.tsx";
import type { ModelInfo } from "./env.d.ts";
import { Icon } from "./icons.tsx";
import { Logo, makerOf } from "./logos.tsx";

type Models = { models: ModelInfo[]; credits: number | null; recommended: string };

let modelsOnce: Promise<Models | undefined> | undefined;
export const loadModels = () =>
  (modelsOnce ??= window.creatron.models().then((r) => (r.ok ? r.value : ((modelsOnce = undefined), undefined))));

// "creatro.model": a fresh key, so a pick made before your plans could be connected doesn't stick.
const KEY = "creatro.model";
const stored = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

const useChoice = create<{ model: string; data?: Models }>(() => ({ model: stored() }));

/** Loads the list again (after connecting or switching off an account) and keeps the choice valid. */
async function refresh() {
  const data = await loadModels();
  if (!data) return;
  const { model } = useChoice.getState();
  // Nothing picked yet, or the picked model is gone (its account was disconnected): your best one.
  const keep = model && data.models.some((m) => m.id === model);
  useChoice.setState({ data, model: keep ? model : data.recommended });
}
window.addEventListener("creatron:models", () => ((modelsOnce = undefined), void refresh()));
void refresh();

/** The chosen model and how to change it (shared by every place that shows it). */
export function useModelChoice(): [string, (id: string) => void] {
  const model = useChoice((s) => s.model);
  const choose = (id: string) => {
    useChoice.setState({ model: id });
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  };
  return [model, choose];
}

const MENU_W = 340;
const isPlan = (m: ModelInfo) => m.id.startsWith("claude-code/") || m.id.startsWith("codex/");

/** One line under each name: what it is, or what it costs. */
function detail(m: ModelInfo) {
  if (m.id === "claude-code/sonnet") return "Claude Code · fast, everyday edits";
  if (m.id === "claude-code/opus") return "Claude Code · most capable";
  if (m.id.startsWith("claude-code/")) return "Claude Code";
  if (m.id.startsWith("codex/")) return "Codex";
  if (m.free) return "Free";
  const n = (v: number) => `$${+v.toFixed(2)}`;
  return `${n(m.inPerM)} in · ${n(m.outPerM)} out per 1M tokens`;
}
/** The tile beside each name: its maker's logo, or the name's first letter for anyone else. */
function Tile({ m }: { m: ModelInfo }) {
  const maker = makerOf(m.id);
  return <span className="mp-tile">{maker ? <Logo maker={maker} size={18} /> : m.name.charAt(0).toUpperCase()}</span>;
}
const short = (m?: ModelInfo, id = "") => m?.name.replace(/\s*\(free\)/i, "") ?? (id.split("/").pop() || "Choose a model");

/** The model menu: a button with the current model, opening your connected plans, then OpenRouter. */
export function ModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const data = useChoice((s) => s.data);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(0);
  const [room, setRoom] = useState(360);
  const [left, setLeft] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const models = data?.models ?? [];
  const plans = models.filter(isPlan);
  const free = models.filter((m) => !isPlan(m) && m.free);
  const paid = models.filter((m) => !m.free);
  const order = [...plans, ...free, ...paid];
  const current = models.find((m) => m.id === value);
  const broke = data?.credits !== null && data?.credits !== undefined && data.credits <= 0;

  // Opens upward when there's no room below (the chat sits at the bottom of its panel).
  const toggle = () => {
    if (open) return setOpen(false);
    const r = root.current?.getBoundingClientRect();
    const below = r ? window.innerHeight - r.bottom : 1000;
    const above = r ? r.top - 90 : 0; // the app's top bar sits over the first 90 px
    const goUp = below < 460 && above > below;
    setUp(goUp);
    // Starts at the button's left edge, moved left when it would run off the window.
    setLeft(r ? Math.min(0, window.innerWidth - 12 - (r.left + MENU_W)) : 0);
    // The list fits the room on that side (head and foot take about 110 px).
    setRoom(Math.max(150, Math.min(380, (goUp ? above : below) - 130)));
    setActive(Math.max(0, order.findIndex((m) => m.id === value)));
    setOpen(true);
  };
  const pick = (id: string) => (onChange(id), setOpen(false));

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowDown") setActive((i) => Math.min(order.length - 1, i + 1));
      else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
      else if (e.key === "Enter" && order[active]) pick(order[active].id);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", keys, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", keys, true);
    };
  }, [open, active, order.length]);

  useEffect(() => {
    if (open) root.current?.querySelector(".mp-row.active")?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const row = (m: ModelInfo) => {
    const i = order.indexOf(m);
    const locked = !m.free && broke;
    return (
      <button
        key={m.id}
        role="option"
        aria-selected={m.id === value}
        className={`mp-row ${m.id === value ? "on" : ""} ${i === active ? "active" : ""} ${locked ? "locked" : ""}`}
        onMouseEnter={() => setActive(i)}
        onClick={() => pick(m.id)}
      >
        <Tile m={m} />
        <span className="mp-text">
          <span className="mp-name">{short(m)}</span>
          <span className="mp-detail">{detail(m)}</span>
        </span>
        {locked && <span className="mp-tag">Needs credits</span>}
        {m.id === value && <i className="mp-on" />}
      </button>
    );
  };

  return (
    <div className="model-picker" ref={root}>
      <button className={`mp-trigger ${open ? "open" : ""}`} onClick={toggle} aria-haspopup="listbox" aria-expanded={open} title="Choose the AI model">
        {current && makerOf(current.id) ? <Logo maker={makerOf(current.id)!} size={14} className="mp-mark" /> : <i className="mp-dot" />}
        <span className="mp-current">{short(current, value)}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className={`mp-menu ${up ? "up" : ""}`} role="listbox" style={{ left, width: MENU_W }}>
          <div className="mp-head">
            <span>Model</span>
            {data?.credits !== null && data?.credits !== undefined && (
              <span className={broke ? "low" : ""}>OpenRouter ${data.credits.toFixed(2)}</span>
            )}
          </div>
          <div className="mp-list" style={{ maxHeight: room }}>
            {plans.length > 0 && <p className="mp-group">Connected</p>}
            {plans.map(row)}
            {free.length + paid.length > 0 && <p className="mp-group"><Logo maker="openrouter" size={11} />OpenRouter</p>}
            {free.map(row)}
            {paid.map(row)}
            {!data && <p className="mp-empty">Loading models…</p>}
            {data && !order.length && <p className="mp-empty">No AI connected yet.</p>}
          </div>
          <button className="mp-foot" onClick={() => (setOpen(false), openHome("connections"))}>
            <Icon name="link" size={13} />
            <span>Manage connections</span>
            <Icon name="chevron" size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
