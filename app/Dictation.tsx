// Dictation for the app's text boxes: click the mic, talk, click ✓ (or press Return) and the words
// land in the box, ready to fix or send. Nothing is sent on its own. The recording is a 16 kHz mono
// WAV made here (what Whisper reads, so no conversion step), transcribed on this Mac by the main
// process (src/dictation.ts, through the toolchain wall). Esc throws a recording away.
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons.tsx";

const RATE = 16000;
const MAX_SECONDS = 180;
const BAR_SECONDS = 1024 / RATE; // one waveform bar per audio block (64 ms)

type Phase = "idle" | "starting" | "recording" | "transcribing";

let active = 0;
/** True while any box is recording or transcribing: other key handlers leave Esc and Return alone. */
export const dictating = () => active > 0;

type Rec = { stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode; chunks: Float32Array[] };

export function useDictation(onText: (said: string) => void) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<{ text: string; settings?: boolean } | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const rec = useRef<Rec | null>(null);
  const levels = useRef<number[]>([]);
  const said = useRef(onText);
  said.current = onText;
  const attempt = useRef(0); // Esc while the mic is still starting: the late start is dropped

  function release() {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    r.node.onaudioprocess = null;
    r.node.disconnect();
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close();
  }

  async function start() {
    if (phase !== "idle") return;
    setError(null);
    setPhase("starting");
    const mine = ++attempt.current;
    try {
      const access = await window.creatron.micAccess();
      if (mine !== attempt.current) return;
      if (access === "denied" || access === "restricted") {
        setPhase("idle");
        return setError({ text: "The microphone is off for Creatro.", settings: true });
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (mine !== attempt.current) return stream.getTracks().forEach((t) => t.stop());
      const ctx = new AudioContext({ sampleRate: RATE });
      const node = ctx.createScriptProcessor(1024, 1, 1);
      const chunks: Float32Array[] = [];
      levels.current = [];
      node.onaudioprocess = (e) => {
        const block = new Float32Array(e.inputBuffer.getChannelData(0));
        chunks.push(block);
        let sum = 0;
        for (const v of block) sum += v * v;
        levels.current.push(Math.min(1, Math.sqrt(Math.sqrt(sum / block.length)) * 1.6));
        if (chunks.length * BAR_SECONDS >= MAX_SECONDS) void stop();
      };
      ctx.createMediaStreamSource(stream).connect(node);
      node.connect(ctx.destination); // a processor only runs while connected; it writes silence
      rec.current = { stream, ctx, node, chunks };
      setStartedAt(performance.now());
      setPhase("recording");
    } catch (e) {
      release();
      setPhase("idle");
      const text = e instanceof Error && e.name === "NotAllowedError" ? "The microphone is off for Creatro." : `Couldn't start the microphone (${e instanceof Error ? e.message : e}).`;
      setError({ text, settings: text.startsWith("The microphone is off") });
    }
  }

  async function stop() {
    const r = rec.current;
    if (!r) return;
    release();
    const seconds = r.chunks.length * BAR_SECONDS;
    if (seconds < 0.4) return setPhase("idle");
    setPhase("transcribing");
    const res = await window.creatron.dictate(wav(r.chunks));
    setPhase("idle");
    if (!res.ok) return setError({ text: res.error });
    if (!res.value) return setError({ text: "Didn't catch any words. Try again a little closer to the mic." });
    said.current(res.value);
  }

  function cancel() {
    attempt.current++;
    release();
    setPhase("idle");
  }

  // While a box is listening: Return finishes, Esc throws it away (before the editor's own keys).
  const busy = phase !== "idle";
  useEffect(() => {
    if (!busy) return;
    active++;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Enter") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") cancel();
      else void stop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      active--;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [busy]);

  useEffect(() => () => release(), []);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), error.settings ? 12000 : 8000);
    return () => clearTimeout(t);
  }, [error]);

  return { phase, error, startedAt, levels, start, stop, cancel, listening: phase === "recording" || phase === "transcribing" };
}

export type Dictation = ReturnType<typeof useDictation>;

/** 16-bit PCM WAV, mono, 16 kHz. */
function wav(chunks: Float32Array[]): Uint8Array {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples * 2, true);
  let at = 44;
  for (const c of chunks) for (const s of c) {
    v.setInt16(at, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
    at += 2;
  }
  return new Uint8Array(buf);
}

/** The mic button. While listening it turns red; clicking it then finishes, like ✓. */
export function MicButton({ d, disabled, className = "icon-btn ai-tool" }: { d: Dictation; disabled?: boolean; className?: string }) {
  const on = d.phase === "recording";
  return (
    <button
      className={`${className} mic-btn ${on ? "on" : ""}`}
      disabled={disabled || d.phase === "starting" || d.phase === "transcribing"}
      title={on ? "Done: turn what you said into text (Return)" : "Dictate: click and talk, your words are typed here"}
      aria-pressed={on}
      onClick={() => (on ? void d.stop() : void d.start())}
    >
      <Icon name="mic" size={16} />
    </button>
  );
}

/**
 * Takes the place of the box's bottom row while listening (the typed text stays where it is):
 * ✕ throws it away, the waveform scrolls in from the right, ✓ sits where Send was.
 */
export function DictationBar({ d }: { d: Dictation }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [seconds, setSeconds] = useState(0);
  const transcribing = d.phase === "transcribing";

  useEffect(() => {
    if (transcribing) return;
    const tick = setInterval(() => setSeconds(Math.floor((performance.now() - d.startedAt) / 1000)), 250);
    let raf = 0;
    const draw = () => {
      const c = canvas.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * dpr)) (c.width = Math.round(w * dpr)), (c.height = Math.round(h * dpr));
        const g = c.getContext("2d")!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        const step = 5, bar = 2.5, count = Math.floor(w / step);
        const lv = d.levels.current.slice(-count);
        const empty = count - lv.length;
        for (let i = 0; i < count; i++) {
          const level = i < empty ? 0 : lv[i - empty]!;
          const bh = Math.max(2.5, level * h);
          // Older sound fades toward the left; before any sound there's a faint baseline.
          g.fillStyle = i < empty ? "rgba(242,242,242,0.14)" : `rgba(242,242,242,${0.35 + 0.65 * (i / count)})`;
          g.beginPath();
          g.roundRect(w - (count - i) * step, (h - bh) / 2, bar, bh, bar / 2);
          g.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => (clearInterval(tick), cancelAnimationFrame(raf));
  }, [transcribing, d.startedAt]);

  return (
    <div className={`dict-bar ${transcribing ? "transcribing" : ""}`} role="status">
      {transcribing ? (
        <span className="dict-wait shimmer">Transcribing…</span>
      ) : (
        <>
          <button className="dict-x" onClick={d.cancel} title="Throw this away (Esc)"><Icon name="close" size={15} /></button>
          <canvas ref={canvas} className="dict-wave" />
          <span className="dict-clock"><i className="dict-dot" />{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
        </>
      )}
      <button className="dict-ok" onClick={() => void d.stop()} title="Done: type what I said (Return)" disabled={transcribing}>
        {transcribing ? <span className="mini-spin dark" /> : <Icon name="check" size={16} />}
      </button>
    </div>
  );
}

/** What went wrong, in one line, with the way to fix it when there is one. */
export function DictationNote({ d }: { d: Dictation }) {
  if (!d.error) return null;
  return (
    <p className="dict-note">
      {d.error.text}
      {d.error.settings && <> <button className="link" onClick={() => void window.creatron.openMicSettings()}>Turn it on in System Settings</button></>}
    </p>
  );
}

/** Adds what was said to what's already typed; mid-sentence it carries on in lower case ("…first line, make the hook…"). */
export function appendSpeech(typed: string, said: string): string {
  const before = typed.trimEnd();
  if (!before) return said;
  const midSentence = !/[.!?:]$/.test(before);
  const first = said.split(" ")[0] ?? "";
  const keepCase = first === "I" || /^I'/.test(first) || (first.length > 1 && first === first.toUpperCase()); // I, I'm, AI, LUFS
  return `${before} ${midSentence && !keepCase ? said.charAt(0).toLowerCase() + said.slice(1) : said}`;
}
