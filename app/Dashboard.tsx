// The Dashboard: where Creatro opens. Say what you want to make and pick a video (it opens in the
// editor and the request goes to the AI), get back to an open project, and connect the AI accounts
// that do the editing: your Claude plan, your ChatGPT plan, or an OpenRouter key.
import { useEffect, useState } from "react";
import { create } from "zustand";
import { Logo, type Maker } from "./logos.tsx";
import { ModelPicker, useModelChoice } from "./modelChoice.tsx";
import type { AgentId, AgentState, Connections } from "../src/chatTypes.ts";
import { Icon } from "./icons.tsx";
import { Orb } from "./Orb.tsx";
import { useEditor } from "./store.ts";
import { useTabs } from "./tabs.ts";

type View = "home" | "connections";
/** Whether the Dashboard is showing (and which page), and a request waiting for its video to open. */
export const useHome = create<{ view: View | null; pending: string | null }>(() => ({ view: "home", pending: null }));
export const openHome = (view: View = "home") => useHome.setState({ view });
export const closeHome = () => useHome.setState({ view: null });

const IDEAS: [string, string][] = [
  ["Full edit", "Edit the whole video like a pro: a strong hook, B-roll, music, sound effects and motion graphics"],
  ["Reel", "Make it a tight 9:16 reel with bold captions, cut the pauses and retakes"],
  ["Talking head", "Clean up this talking-head video: cut dead air and retakes, add captions"],
  ["Podcast clip", "Find the best 45 seconds and make a vertical clip with captions"],
  ["Explainer", "Turn this into a clear explainer with titles for each point"],
  ["Vlog", "Cut this into a fast, fun vlog with music and sound effects"],
  ["Ad", "Make a punchy 30-second ad with a strong hook in the first 2 seconds"],
];

/** The connections, kept fresh: loaded once, then updated live while a sign-in or install runs. */
function useConnections(): [Connections | undefined, (c: Connections) => void, () => void] {
  const [c, setC] = useState<Connections>();
  const refresh = () => void window.creatron.connections().then(setC);
  useEffect(() => {
    refresh();
    return window.creatron.onConnections((next) => {
      setC(next);
      window.dispatchEvent(new Event("creatron:models"));
    });
  }, []);
  return [c, (next) => (setC(next), window.dispatchEvent(new Event("creatron:models"))), refresh];
}

const ready = (s?: AgentState) => Boolean(s?.installed && s.signedIn);

export function Dashboard({ onOpenVideo }: { onOpenVideo: (path: string) => Promise<boolean> }) {
  const view = useHome((h) => h.view) ?? "home";
  const [conn, setConn, refresh] = useConnections();
  return (
    <div className="dash">
      <aside className="dash-side">
        <nav>
          <button className={view === "home" ? "on" : ""} onClick={() => openHome("home")}><Icon name="grid" size={15} /> Home</button>
          <button className={view === "connections" ? "on" : ""} onClick={() => openHome("connections")}>
            <Icon name="link" size={15} /> Connections
            <span className={`dash-count ${conn && (ready(conn.claude) || ready(conn.codex) || conn.openrouter) ? "ok" : ""}`}>
              {conn ? [ready(conn.claude), ready(conn.codex), conn.openrouter].filter(Boolean).length : "·"}
            </span>
          </button>
        </nav>
        <p className="dash-note mono">Your footage stays on this Mac. Only the transcript goes to the AI.</p>
      </aside>
      <main className="dash-main">
        {view === "home" ? <Home conn={conn} onOpenVideo={onOpenVideo} /> : <ConnectionsPage conn={conn} setConn={setConn} refresh={refresh} />}
      </main>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Home({ conn, onOpenVideo }: { conn?: Connections; onOpenVideo: (path: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [video, setVideo] = useState<string>();
  const [dropping, setDropping] = useState(false);
  const { tabs, active, switchTo } = useTabs();
  const live = useEditor((s) => s.project);
  const open = tabs.map((t) => ({ id: t.id, project: t.id === active ? live : t.snapshot?.project })).filter((t) => t.project);
  const connected = conn && (ready(conn.claude) || ready(conn.codex) || conn.openrouter);

  const start = async () => {
    const path = video ?? (await window.creatron.pickVideo());
    if (!path) return;
    useHome.setState({ pending: text.trim() || null, view: null });
    const ok = await onOpenVideo(path);
    if (!ok) useHome.setState({ pending: null, view: "home" });
  };

  return (
    <div className="home">
      <section className="home-hero">
        <Orb size={56} calm />
        <p className="dot-label">{greeting()}</p>
        <h1>What are we making today?</h1>
        <p className="home-sub">Pick a video and say what you want. Creatro cuts, captions and styles it on your Mac.</p>

        <div
          className={`prompt ${dropping ? "dropping" : ""}`}
          onDragOver={(e) => (e.preventDefault(), e.stopPropagation(), setDropping(true))}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropping(false);
            const f = [...e.dataTransfer.files][0];
            if (f) setVideo(window.creatron.pathForFile(f));
          }}
        >
          <textarea
            value={text}
            placeholder="Describe the video. A quick fix, or the whole finished edit with B-roll, music and motion graphics"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void start())}
            rows={3}
          />
          <div className="prompt-foot">
            <button className="prompt-file" onClick={async () => { const p = await window.creatron.pickVideo(); if (p) setVideo(p); }}>
              <Icon name={video ? "video" : "paperclip"} size={14} />
              <span>{video ? video.split("/").pop() : "Choose video"}</span>
              {video && <i role="button" title="Remove" onClick={(e) => (e.stopPropagation(), setVideo(undefined))}><Icon name="close" size={11} /></i>}
            </button>
            <span className="grow" />
            {conn && !connected && (
              <button className="prompt-connect" onClick={() => openHome("connections")}>No AI connected · Connect</button>
            )}
            {conn && connected && <HomeModel />}
            <button className="prompt-go" title="Start (Enter)" onClick={() => void start()}><Icon name="arrowUp" size={15} /></button>
          </div>
        </div>
        <div className="ideas">
          {IDEAS.map(([label, prompt]) => (
            <button key={label} onClick={() => setText(prompt)}>{label}</button>
          ))}
        </div>
      </section>

      <section className="home-open">
        <div className="home-head">
          <h2>Open projects</h2>
          <span className="mono dim">{open.length || "None yet"}</span>
        </div>
        {open.length ? (
          <div className="proj-grid">
            {open.map(({ id, project }) => (
              <button key={id} className="proj" onClick={() => (switchTo(id), closeHome())}>
                <video src={`${project!.videoUrl}#t=1`} muted preload="metadata" />
                <span className="proj-name">{project!.analysis.source.split("/").pop()}</span>
                <span className="proj-meta mono">{Math.floor(project!.analysis.duration / 60)}:{String(Math.round(project!.analysis.duration % 60)).padStart(2, "0")} · {project!.analysis.width}×{project!.analysis.height}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="home-empty">Videos you open show up here, so you can jump back to them.</p>
        )}
      </section>
    </div>
  );
}

/** The model that will edit: the same choice as the chat's menu, your connected plan by default. */
function HomeModel() {
  const [model, setModel] = useModelChoice();
  return <span className="prompt-model"><ModelPicker value={model} onChange={setModel} /></span>;
}

const AGENTS: { id: AgentId; name: string; via: string; mark: Maker; what: string }[] = [
  { id: "claude", name: "Claude", via: "Claude Code", mark: "claude", what: "Your Claude plan (Pro or Max). Edits live in the chat and writes its own animations." },
  { id: "codex", name: "ChatGPT", via: "Codex", mark: "openai", what: "Your ChatGPT plan (Plus or Pro). Edits live in the chat through OpenAI's Codex." },
];

function ConnectionsPage({ conn, setConn, refresh }: { conn?: Connections; setConn: (c: Connections) => void; refresh: () => void }) {
  const [checking, setChecking] = useState(false);
  return (
    <div className="conn">
      <header className="conn-head">
        <p className="dot-label">( Connections )</p>
        <h1>Bring your own AI.</h1>
        <p className="home-sub">Edit with the plan you already pay for. Each one signs in with your own account on this Mac; Creatro never sees your password.</p>
      </header>

      <h3 className="conn-group mono">Your plans</h3>
      <div className="conn-list">
        {AGENTS.map((a) => (
          <AgentRow key={a.id} info={a} state={conn?.[a.id]} on={conn?.enabled[a.id] ?? true} install={conn?.install[a.id]} setConn={setConn} />
        ))}
        <button className="conn-check" disabled={checking} onClick={async () => { setChecking(true); await refresh(); setTimeout(() => setChecking(false), 400); }}>
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>

      <h3 className="conn-group mono">API key</h3>
      <OpenRouterRow has={conn?.openrouter} setConn={setConn} />

      <p className="conn-foot">Pick which one edits from the model menu at the bottom of the chat. Your plans cost nothing extra in Creatro; OpenRouter bills per use, and its free models cost nothing.</p>
    </div>
  );
}

function AgentRow({ info, state, on, install, setConn }: {
  info: (typeof AGENTS)[number];
  state?: AgentState;
  on: boolean;
  install?: string;
  setConn: (c: Connections) => void;
}) {
  const [copied, setCopied] = useState(false);
  const status = !state ? "Checking…"
    : state.busy === "installing" ? "Installing…"
    : state.busy === "signing-in" ? "Waiting for your browser…"
    : !state.installed ? `${info.via} isn't installed`
    : state.signedIn ? `Signed in · ${state.account ?? "your plan"}`
    : "Not signed in";
  const tone = !state ? "" : state.busy ? "busy" : ready(state) ? "ok" : "off";
  const act = (p: Promise<Connections>) => void p.then(setConn);
  return (
    <div className={`conn-row ${tone}`}>
      <span className="conn-mark" aria-hidden="true"><Logo maker={info.mark} size={22} /></span>
      <div className="conn-text">
        <div className="conn-name">{info.name} <span className="mono dim">via {info.via}{state?.version ? ` ${state.version}` : ""}</span></div>
        <div className="conn-status"><i />{status}</div>
        <p className="conn-what">{info.what}</p>
        {state?.error && <p className="conn-error">{state.error}</p>}
        {state && !state.installed && !state.busy && install && (
          <p className="conn-install">
            Or in Terminal: <code>{install}</code>
            <button className="link" onClick={() => (navigator.clipboard.writeText(install), setCopied(true), setTimeout(() => setCopied(false), 1500))}>{copied ? "Copied" : "Copy"}</button>
          </p>
        )}
      </div>
      <div className="conn-actions">
        {state?.busy ? (
          <button onClick={() => act(window.creatron.agentCancel(info.id))}>Cancel</button>
        ) : !state ? null : !state.installed ? (
          <button className="primary" onClick={() => act(window.creatron.agentInstall(info.id))}>Install</button>
        ) : state.signedIn ? (
          <button onClick={() => act(window.creatron.agentSignOut(info.id))}>Sign out</button>
        ) : (
          <button className="primary" onClick={() => act(window.creatron.agentSignIn(info.id))}>Sign in</button>
        )}
        <button
          className={`toggle ${on && state?.installed ? "on" : ""}`}
          role="switch"
          aria-checked={on && Boolean(state?.installed)}
          title={on ? "Shown in the chat's model menu" : "Hidden from the chat's model menu"}
          disabled={!state?.installed}
          onClick={() => act(window.creatron.agentEnable(info.id, !on))}
        ><i /></button>
      </div>
    </div>
  );
}

function OpenRouterRow({ has, setConn }: { has?: boolean; setConn: (c: Connections) => void }) {
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const save = async (k: string) => (setConn(await window.creatron.setOpenRouterKey(k)), setKey(""), setEditing(false));
  return (
    <div className={`conn-row ${has ? "ok" : "off"}`}>
      <span className="conn-mark" aria-hidden="true"><Logo maker="openrouter" size={20} /></span>
      <div className="conn-text">
        <div className="conn-name">OpenRouter <span className="mono dim">API key</span></div>
        <div className="conn-status"><i />{has ? "Key saved on this Mac" : "No key"}</div>
        <p className="conn-what">Hundreds of models (Claude, GPT, Gemini and free ones), billed per use by OpenRouter. Get a key at openrouter.ai/keys.</p>
        {(editing || !has) && (
          <form className="conn-key" onSubmit={(e) => (e.preventDefault(), key.trim() && void save(key))}>
            <input type="password" placeholder="sk-or-…" value={key} autoComplete="off" spellCheck={false} onChange={(e) => setKey(e.target.value)} />
            <button className="primary" disabled={!key.trim()}>Save</button>
            {has && <button type="button" onClick={() => setEditing(false)}>Cancel</button>}
          </form>
        )}
      </div>
      <div className="conn-actions">
        {has && !editing && (
          <>
            <button onClick={() => setEditing(true)}>Change</button>
            <button onClick={() => void save("")}>Remove</button>
          </>
        )}
      </div>
    </div>
  );
}
