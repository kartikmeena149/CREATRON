// Sign in with Google on the website, through Supabase Auth, with no library: the page sends you to
// Supabase's Google sign-in, Google sends you back with a session in the address, and the session is
// kept in this browser. Signing in also puts you on the waitlist (the `waitlist` table: each person
// can add and read only their own row, see website/supabase/waitlist.sql).
//
// The URL and the publishable key are public by design (Supabase: "safe to use in a browser"); what
// a visitor may do is decided by the table's row-level security, not by hiding these.
export const SUPABASE_URL = "https://rkojphqxdrixbvzbyeed.supabase.co";
export const SUPABASE_KEY = "sb_publishable_GuTUkiBAUQaHxysOhpMVmQ_IUFuLDbT";

const STORE = "creatro.session";

export type Session = { access_token: string; refresh_token: string; expires_at: number };
export type User = { id: string; email: string; name: string; avatar?: string };

const read = (): Session | null => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "null");
  } catch {
    return null;
  }
};
const write = (s: Session | null) => {
  try {
    s ? localStorage.setItem(STORE, JSON.stringify(s)) : localStorage.removeItem(STORE);
  } catch {}
};

/** Whether this browser has a session (no network: for the nav). */
export const hasSession = () => Boolean(read());

/** Off to Google (through Supabase); you come back to `back`. */
export function signInWithGoogle(back = location.origin + location.pathname) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", back);
  location.assign(url.toString());
}

/**
 * Back from Google: the session (or the error) is in the address. Keeps the session and cleans the
 * address. Returns an error message when the sign-in didn't work.
 */
export function takeReturn(): string | undefined {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const error = hash.get("error_description") ?? query.get("error_description") ?? hash.get("error") ?? query.get("error");
  const token = hash.get("access_token");
  if (token || error) history.replaceState(null, "", location.pathname);
  if (token)
    write({
      access_token: token,
      refresh_token: hash.get("refresh_token") ?? "",
      expires_at: Number(hash.get("expires_at")) || Math.floor(Date.now() / 1000) + Number(hash.get("expires_in") ?? 3600),
    });
  return error ? error.replace(/\+/g, " ") : undefined;
}

/** A session that's still good: renewed when it has run out, or null (then signed out). */
async function fresh(): Promise<Session | null> {
  const s = read();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!r.ok) return write(null), null;
  const d = await r.json();
  const next = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at ?? Math.floor(Date.now() / 1000) + d.expires_in };
  write(next);
  return next;
}

/** Who's signed in, or null. */
export async function currentUser(): Promise<User | null> {
  const s = await fresh();
  if (!s) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}` } });
  if (!r.ok) return write(null), null;
  const u = await r.json();
  const meta = u.user_metadata ?? {};
  return { id: u.id, email: u.email, name: meta.full_name ?? meta.name ?? u.email, avatar: meta.avatar_url ?? meta.picture };
}

/**
 * Puts the signed-in person on the waitlist (once: joining again changes nothing). Returns when
 * they joined, or throws with a plain reason.
 */
export async function joinWaitlist(u: User): Promise<string> {
  const s = await fresh();
  if (!s) throw new Error("You're signed out. Sign in again.");
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" };
  const add = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ id: u.id, email: u.email, name: u.name, avatar_url: u.avatar ?? null }),
  });
  if (!add.ok) throw new Error(add.status === 404 ? "The waitlist isn't set up yet." : `Couldn't join the list (${add.status}).`);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/waitlist?select=joined_at&id=eq.${u.id}`, { headers });
  const rows = r.ok ? await r.json() : [];
  return rows[0]?.joined_at ?? new Date().toISOString();
}

export async function signOut() {
  const s = read();
  write(null);
  if (s) await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
}

// ---------- leaderboards (website/supabase/scores.sql) ----------
export type BoardRow = { rank: number; name: string; best: number; me: boolean; players: number };

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const s = await fresh();
  if (!s) throw new Error("You're signed out.");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    if (r.status === 404) throw new Error("The leaderboard isn't set up yet.");
    const why = await r.json().catch(() => null);
    throw new Error(why?.message ?? `Leaderboard error (${r.status}).`);
  }
  return r.json();
}

/** Saves a score for a game; returns your best there. */
export const submitScore = (game: string, score: number) => rpc<number>("submit_score", { p_game: game, p_score: Math.floor(score) });

/** The top 10 for a game, plus your own row when you're further down. */
export const leaderboard = (game: string) => rpc<BoardRow[]>("leaderboard", { p_game: game });

/** Your name on the boards: the one you chose, or your first name and an initial. */
export const myName = () => rpc<string>("my_name", {});

/** Choose your name on the boards (2 to 16 letters, numbers, spaces, . _ -); returns it as saved. */
export const setName = (name: string) => rpc<string>("set_name", { p_name: name });

/** A current access token for the live channel (play/live.ts), renewed when it has run out; null when signed out. */
export const accessToken = async () => (await fresh())?.access_token ?? null;
