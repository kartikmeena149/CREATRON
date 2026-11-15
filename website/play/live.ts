// The live side of the Play page: who's online, who's playing what, and new scores the moment they land.
// One Supabase Realtime channel over a plain WebSocket (no client library). Presence is keyed by user id,
// so two tabs are one person. If the socket can't connect, the page still works: the board keeps its
// 30-second refresh and the online count stays hidden.
import { SUPABASE_KEY, SUPABASE_URL, accessToken } from "../auth.ts";

export type Meta = { game: string; playing: boolean; name: string };
export type Live = {
  /** Say what you're doing now (sent only when it changes). */
  track(m: Meta): void;
  /** Leave the online list (tab hidden) until the next track. */
  away(): void;
  /** Tell everyone on the page about a new best (they check it against the board before showing it). */
  announce(s: { game: string; name: string; best: number }): void;
};

const TOPIC = "realtime:play";

export function connectLive(uid: string, on: {
  people(p: Map<string, Meta>): void;
  score(s: { game: string; name: string; best: number }): void;
  status(up: boolean): void;
}): Live {
  let ws: WebSocket | null = null, ref = 0, joined = false, tries = 0;
  let want: Meta | null = null, sent = "", gone = false;
  let beat = 0, renew = 0;
  const people = new Map<string, Meta[]>();

  const push = (event: string, payload: unknown, topic = TOPIC) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ topic, event, payload, ref: String(++ref), join_ref: "1" }));
  };
  const emit = () => {
    const now = new Map<string, Meta>();
    for (const [k, metas] of people) if (metas.length) now.set(k, metas.find((m) => m.playing) ?? metas[metas.length - 1]);
    on.people(now);
  };
  const strip = (metas: Array<Meta & { phx_ref?: string }>) => metas.map(({ game, playing, name, phx_ref }) => ({ game, playing, name, phx_ref }));
  const sendTrack = () => {
    if (!joined) return;
    if (gone) { if (sent !== "away") { push("presence", { type: "presence", event: "untrack" }); sent = "away"; } return; }
    if (!want) return;
    const k = JSON.stringify(want);
    if (k !== sent) { push("presence", { type: "presence", event: "track", payload: want }); sent = k; }
  };

  async function open() {
    const token = await accessToken().catch(() => null);
    if (!token) return;
    ws = new WebSocket(`${SUPABASE_URL.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`);
    ws.onopen = () => push("phx_join", { config: { broadcast: { self: false }, presence: { key: uid }, private: false }, access_token: token });
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.topic !== TOPIC) return;
      if (d.event === "phx_reply" && d.ref === "1") {
        if (d.payload.status !== "ok") { ws?.close(); return; }
        joined = true; tries = 0; sent = ""; on.status(true); sendTrack();
      } else if (d.event === "presence_state") {
        people.clear();
        for (const [k, v] of Object.entries(d.payload as Record<string, { metas: Meta[] }>)) people.set(k, strip(v.metas));
        emit();
      } else if (d.event === "presence_diff") {
        for (const [k, v] of Object.entries(d.payload.leaves as Record<string, { metas: Array<{ phx_ref: string }> }>)) {
          const out = new Set(v.metas.map((x) => x.phx_ref));
          people.set(k, (people.get(k) ?? []).filter((x) => !out.has((x as { phx_ref?: string }).phx_ref ?? "")));
          if (!people.get(k)!.length) people.delete(k);
        }
        for (const [k, v] of Object.entries(d.payload.joins as Record<string, { metas: Meta[] }>)) people.set(k, [...(people.get(k) ?? []), ...strip(v.metas)]);
        emit();
      } else if (d.event === "broadcast" && d.payload?.event === "score") {
        const s = d.payload.payload;
        if (s && typeof s.game === "string" && typeof s.name === "string" && Number.isFinite(s.best)) on.score(s);
      } else if (d.event === "phx_error" || d.event === "phx_close" || d.event === "system" && d.payload?.status === "error") {
        ws?.close();
      }
    };
    ws.onclose = () => {
      joined = false; ws = null; people.clear(); emit(); on.status(false);
      // Back off: 1 s, 2 s, 4 s … up to a minute.
      setTimeout(open, Math.min(60000, 1000 * 2 ** tries++));
    };
  }

  clearInterval(beat); clearInterval(renew);
  beat = window.setInterval(() => push("heartbeat", {}, "phoenix"), 25000);
  // Tokens last an hour; hand the channel a fresh one well before that.
  renew = window.setInterval(async () => { const t = await accessToken().catch(() => null); if (t) push("access_token", { access_token: t }); }, 20 * 60000);
  open();

  return {
    track(m) { want = m; gone = false; sendTrack(); },
    away() { gone = true; sendTrack(); },
    announce(s) { push("broadcast", { type: "broadcast", event: "score", payload: s }); },
  };
}
