// Six games made from the Creatro mark: ten white frames and one red light, for people who have
// signed in (signing in is joining the early-access list, see ../auth.ts).
import { currentUser, hasSession, signOut } from "../auth.ts";

// One square canvas, 600 x 600 logical units. Mouse, keyboard and touch all work; nothing leaves the page.
const stage = document.getElementById("stage");
const cv = document.getElementById("board");
const ctx = cv.getContext("2d");
const S = 600;
const RED = "#E5231B", WHITE = "#FFFFFF", GREY = "#9A9A9A", DIM = "#5C5C5C", LINE = "#2A2A2A", INK2 = "#161616";
const MONO = '"Geist Mono", ui-monospace, Menlo, monospace';
const TAU = Math.PI * 2;
const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const rnd = (a, b) => a + Math.random() * (b - a);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const TOUCH = matchMedia("(pointer: coarse)").matches;

function fit() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = S * dpr; cv.height = S * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fit();
addEventListener("resize", fit);

const store = {
  get: (k) => { try { return Number(localStorage.getItem("creatro_play_" + k)) || 0; } catch { return 0; } },
  set: (k, v) => { try { localStorage.setItem("creatro_play_" + k, String(v)); } catch { /* private mode */ } },
};

// ---------- drawing ----------
function dot(x, y, r, col = WHITE, a = 1) {
  if (r <= 0 || a <= 0) return;
  ctx.globalAlpha = cl(a); ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
}
function light(x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
  g.addColorStop(0, "rgba(229,35,27,.28)"); g.addColorStop(1, "rgba(229,35,27,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4, 0, TAU); ctx.fill();
  dot(x, y, r, RED);
}
function text(s, x, y, o = {}) {
  ctx.globalAlpha = o.a ?? 1; ctx.fillStyle = o.col || WHITE;
  ctx.font = `${o.w || 400} ${o.size || 14}px ${MONO}`;
  ctx.textAlign = o.align || "center"; ctx.textBaseline = "middle";
  ctx.letterSpacing = (o.track ?? 1) + "px";
  ctx.fillText(s, x, y); ctx.globalAlpha = 1;
}
function sheet() {
  ctx.fillStyle = INK2; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = "#222";
  for (let x = 16; x < S; x += 32) for (let y = 16; y < S; y += 32) ctx.fillRect(x - 1, y - 1, 2, 2);
}
function veil(title, sub) {
  ctx.fillStyle = "rgba(10,10,10,.74)"; ctx.fillRect(0, 0, S, S);
  text(title, S / 2, S / 2 - 24, { size: 36, track: 2 });
  text(sub, S / 2, S / 2 + 26, { size: 22, col: GREY });
}
// The mark: twelve frames on a ring, two left out on the right (the cut).
const RING = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ringAt = (k, R, rot = 0) => [S / 2 + R * Math.cos(rot + Math.PI / 12 + (k * Math.PI) / 6), S / 2 + R * Math.sin(rot + Math.PI / 12 + (k * Math.PI) / 6)];

// ---------- sound ----------
// Sounds from earshot's bank (public/play/sfx), loaded after the first tap (phones only allow audio
// after one). Each has a level in dB so ticks stay quiet and big moments land; a limiter on the
// way out keeps stacked sounds from clipping. Sound on/off is remembered on this device.
const SFX = {
  start: 3, over: -5, best: -4, bounce: -1, flap: 0, pass: 9, crash: 1, eat: 0, bigeat: -8, bigshow: 2, undo: -1,
  graze: 1, spark: -5, ringwarn: -9, escape: -5, hit: 1, note: -4, wrong: -4, catch: -1.5, miss: -2.5, turn: 2,
};
const sound = {
  on: (() => { try { return localStorage.getItem("creatro_play_sound") !== "off"; } catch { return true; } })(),
  ctx: null, out: null, bufs: {},
  wake() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const limit = this.ctx.createDynamicsCompressor();
    limit.threshold.value = -10; limit.ratio.value = 12; limit.attack.value = 0.003; limit.release.value = 0.15;
    this.out = this.ctx.createGain(); this.out.gain.value = 0.8;
    this.out.connect(limit).connect(this.ctx.destination);
    for (const n of Object.keys(SFX))
      fetch(new URL(`./sfx/${n}.mp3`, location.href)).then((r) => r.arrayBuffer()).then((a) => this.ctx.decodeAudioData(a)).then((b) => { this.bufs[n] = b; }).catch(() => {});
  },
  play(n, { rate = 1, gain = 0 } = {}) {
    if (!this.on || !this.ctx || !this.bufs[n]) return;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = this.bufs[n]; src.playbackRate.value = rate;
    g.gain.value = Math.pow(10, (SFX[n] + gain) / 20);
    src.connect(g).connect(this.out); src.start();
  },
  set(on) { this.on = on; try { localStorage.setItem("creatro_play_sound", on ? "on" : "off"); } catch { /* private mode */ } },
};
const semis = (n) => Math.pow(2, n / 12);

// ---------- input ----------
const ptr = { x: S / 2, y: S / 2, down: false, sx: 0, sy: 0, type: "mouse" };
const keys = {};
let G = null, score = 0, best = 0;

function toBoard(e) {
  const b = cv.getBoundingClientRect();
  return { x: ((e.clientX - b.left) / b.width) * S, y: ((e.clientY - b.top) / b.height) * S };
}
cv.addEventListener("pointerdown", (e) => {
  e.preventDefault(); stage.focus({ preventScroll: true });
  sound.wake();
  cv.setPointerCapture(e.pointerId);
  Object.assign(ptr, toBoard(e), { down: true, type: e.pointerType });
  ptr.sx = ptr.x; ptr.sy = ptr.y;
  if (G.waiting) { G.waiting = false; sound.play("start"); G.go?.(); return; }
  if (G.over) { if (G.ready && !G.ready()) return; begin(G); G.waiting = false; sound.play("start"); G.go?.(); return; }
  G.press?.();
});
cv.addEventListener("pointermove", (e) => { Object.assign(ptr, toBoard(e), { type: e.pointerType }); G.move?.(); });
cv.addEventListener("pointerup", () => { if (!ptr.down) return; ptr.down = false; G.release?.(); });
cv.addEventListener("pointercancel", () => { ptr.down = false; });
cv.addEventListener("contextmenu", (e) => e.preventDefault());

stage.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  keys[e.key] = true;
  sound.wake();
  if (e.key === "r" || e.key === "R") { begin(G); return; }
  if (G.waiting && (e.key === " " || e.key.startsWith("Arrow"))) { G.waiting = false; sound.play("start"); G.go?.(); if (e.key === " ") return; }
  if (G.over && e.key === " ") { if (G.ready && !G.ready()) return; begin(G); G.waiting = false; sound.play("start"); G.go?.(); return; }
  G.key?.(e.key);
});
stage.addEventListener("keyup", (e) => { keys[e.key] = false; });

function setScore(v) {
  score = v;
  document.getElementById("score").textContent = "Score " + v;
  if (v > best) { best = v; store.set(G.id, v); }
  document.getElementById("best").textContent = "Best " + best;
}

// ---------- 1. Keep the light ----------
// The red light bounces inside the ring. The cut sits opposite your finger: point where the light
// is heading and a frame is there to send it back. Out through the cut, and it's over.
const keep = {
  id: "keep", name: "Keep the light",
  hint: TOUCH ? "The red light bounces inside the ring. Drag around the board toward where it's heading, so a frame catches it. Out through the cut, and it's over." : "The red light bounces inside the ring. Point toward where it's heading (or use the arrows) so a frame catches it. Out through the cut, and it's over.",
  start: TOUCH ? "Tap, then drag to turn the ring" : "Click, then point to turn the ring",
  R: 200, rd: 22,
  init() { this.rot = Math.PI; this.target = Math.PI; this.b = { x: S / 2, y: S / 2, vx: 0, vy: 0 }; this.speed = 240; this.over = false; this.flash = []; this.trail = []; this.out = 0; },
  ready() { return this.out > 0.5; },
  go() { this.move(); const a = rnd(0, TAU); this.b.vx = Math.cos(a) * this.speed; this.b.vy = Math.sin(a) * this.speed; },
  move() { if (ptr.type === "mouse" || ptr.down) this.target = Math.atan2(ptr.y - S / 2, ptr.x - S / 2) + Math.PI; },
  update(dt) {
    if (keys.ArrowLeft) this.target -= 3.2 * dt;
    if (keys.ArrowRight) this.target += 3.2 * dt;
    this.rot += wrapAngle(this.target - this.rot) * Math.min(1, dt * 16);
    for (const f of this.flash) f.t -= dt;
    this.flash = this.flash.filter((f) => f.t > 0);
    const b = this.b;
    if (this.over) { this.out += dt; b.x += b.vx * dt; b.y += b.vy * dt; return; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    this.trail.push([b.x, b.y]); if (this.trail.length > 14) this.trail.shift();
    const dx = b.x - S / 2, dy = b.y - S / 2, d = Math.hypot(dx, dy), wall = this.R - this.rd - 12;
    if (d < wall) return;
    const a = Math.atan2(dy, dx);
    if (Math.abs(wrapAngle(a - this.rot)) < 0.42) { this.over = true; sound.play("over"); return; } // through the cut
    const nx = dx / d, ny = dy / d, along = b.vx * nx + b.vy * ny;
    if (along <= 0) return;
    b.vx -= 2 * along * nx; b.vy -= 2 * along * ny;
    // A little spin on every bounce, so no two rounds play the same.
    const tw = rnd(-0.25, 0.25), c = Math.cos(tw), s = Math.sin(tw), vx = b.vx * c - b.vy * s, vy = b.vx * s + b.vy * c;
    this.speed = Math.min(620, this.speed * 1.045);
    const m = Math.hypot(vx, vy); b.vx = (vx / m) * this.speed; b.vy = (vy / m) * this.speed;
    b.x = S / 2 + nx * (wall - 1); b.y = S / 2 + ny * (wall - 1);
    setScore(score + 1);
    sound.play("bounce", { rate: 0.85 + ((this.speed - 240) / 380) * 0.75 }); // higher as it speeds up
    let k = 0, bd = 9;
    for (const i of RING) { const o = Math.abs(wrapAngle(a - (this.rot + Math.PI / 12 + (i * Math.PI) / 6))); if (o < bd) { bd = o; k = i; } }
    this.flash.push({ k, t: 0.25 });
  },
  draw() {
    const C = S / 2;
    ctx.fillStyle = "rgba(229,35,27,.06)"; ctx.beginPath(); ctx.moveTo(C, C); ctx.arc(C, C, this.R + 40, this.rot - 0.42, this.rot + 0.42); ctx.closePath(); ctx.fill();
    for (const i of RING) {
      const a = this.rot + Math.PI / 12 + (i * Math.PI) / 6, hit = this.flash.some((f) => f.k === i);
      dot(C + this.R * Math.cos(a), C + this.R * Math.sin(a), this.rd * (hit ? 1.18 : 1), WHITE);
    }
    this.trail.forEach(([x, y], i) => dot(x, y, 10 * (i / this.trail.length), RED, 0.25 * (i / this.trail.length)));
    light(this.b.x, this.b.y, 12);
    text(String(score), C, C, { size: 56, col: "#3a3a3a" });
    if (this.over && this.out > 0.5) veil("Out through the cut", `${score} bounces · tap to play again`);
  },
};

// ---------- 2. Through the cut ----------
// Walls of frames scroll past, each with a cut. Tap to lift the red light through. Thread the middle
// for a PERFECT; three in a row is FEVER (double points). Cuts start to slide, sparks float between
// walls, and every 15 walls gravity flips for five.
const fly = {
  id: "fly", name: "Through the cut",
  hint: TOUCH ? "Tap to lift the red light through each cut. Hit the middle for PERFECT, three in a row for FEVER. Grab sparks. Watch for the gravity flip." : "Click, tap or space to lift the red light through each cut. Hit the middle for PERFECT, three in a row for FEVER. Grab sparks. Watch for the gravity flip.",
  start: TOUCH ? "Tap to fly" : "Click or press space to fly",
  X: 150, PITCH: 54.6, HALF: 84, G: 1100, LIFT: 330,
  init() {
    this.y = S / 2; this.vy = 0; this.walls = []; this.sparks = []; this.bits = []; this.trail = []; this.pops = [];
    this.next = 0.9; this.over = false; this.dead = 0; this.passed = 0; this.points = 0; this.speed = 190;
    this.streak = 0; this.fever = false; this.flip = 0; this.banner = null; this.shake = 0; this.scroll = 0; this.squash = 0; this.clock = 0;
  },
  ready() { return this.dead > 1.3; },
  flap() {
    if (this.over) return;
    this.vy = this.flip ? this.LIFT : -this.LIFT; this.squash = 1;
    sound.play("flap", { rate: rnd(0.94, 1.08) });
    for (let k = 0; k < 4; k++) this.bits.push({ x: this.X - 8, y: this.y, vx: rnd(-160, -60), vy: rnd(-40, 40) + (this.flip ? -60 : 60), t: 0, life: 0.35, r: 2.5, col: RED });
  },
  go() { this.flap(); },
  press() { this.flap(); },
  key(k) { if (k === " " || k === "ArrowUp") this.flap(); },
  // Where a wall's cut is now: some slide up and down once you're past the first few.
  cutY(w) { return cl(w.c + w.amp * Math.sin(this.clock * w.w + w.ph), this.HALF + 26, S - this.HALF - 26); },
  wallDots(w) {
    const c = this.cutY(w), out = [];
    for (let y = c - this.HALF; y > -30; y -= this.PITCH) out.push(y);
    for (let y = c + this.HALF; y < S + 30; y += this.PITCH) out.push(y);
    return out;
  },
  say(text, t = 1.1) { this.banner = { text, t, life: t }; },
  burst(x, y, n, col, speed = 220) { for (let k = 0; k < n; k++) { const a = rnd(0, TAU), v = rnd(0.3, 1) * speed; this.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rnd(0.35, 0.7), r: rnd(1.5, 3.5), col }); } },
  crash() {
    if (this.over) return;
    this.over = true; this.dead = 0; this.shake = 16; sound.play("crash");
    // The frames you hit fly apart, and the light shatters.
    for (const w of this.walls) if (Math.abs(w.x - this.X) < 70) for (const y of this.wallDots(w)) if (Math.abs(y - this.y) < 130) { const a = Math.atan2(y - this.y, w.x - this.X); this.bits.push({ x: w.x, y, vx: Math.cos(a) * rnd(150, 320), vy: Math.sin(a) * rnd(150, 320), t: 0, life: 1.2, r: 14, col: WHITE }); w.broke = true; }
    this.burst(this.X, this.y, 26, RED, 320);
  },
  update(dt) {
    for (const b of this.bits) { b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.97; b.vy *= 0.97; }
    this.bits = this.bits.filter((b) => b.t < b.life);
    for (const q of this.pops) q.t += dt;
    this.pops = this.pops.filter((q) => q.t < 0.8);
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    this.shake = Math.max(0, this.shake - dt * 40); this.squash = Math.max(0, this.squash - dt * 5);
    if (this.over) { this.dead += dt; dt *= 0.25; if (this.dead > 1.3) return; } // slow motion as it breaks
    this.clock += dt; this.scroll += this.speed * dt;
    this.vy += (this.flip ? -this.G : this.G) * dt; this.y += this.vy * dt;
    if (!this.over) this.trail.push({ x: this.X, y: this.y });
    for (const p of this.trail) p.x -= this.speed * dt;
    this.trail = this.trail.filter((p) => p.x > this.X - 110);
    if (this.over) { for (const w of this.walls) w.x -= this.speed * dt * 0.3; return; }
    this.next -= dt;
    if (this.next <= 0) {
      const moving = this.passed >= 6 && Math.random() < Math.min(0.75, 0.3 + this.passed * 0.015);
      this.walls.push({ x: S + 40, c: rnd(this.HALF + 40, S - this.HALF - 40), amp: moving ? rnd(40, 90) : 0, w: rnd(1.4, 2.4), ph: rnd(0, TAU), passed: false });
      // A spark halfway to the next wall, now and then.
      if (this.passed >= 2 && Math.random() < 0.45) this.sparks.push({ x: S + 40 + this.speed * 0.6, y: rnd(90, S - 90), t: 0 });
      this.next = Math.max(1.05, 1.55 - this.passed * 0.02);
    }
    this.speed = Math.min(320, 190 + this.passed * 4);
    for (const sp of this.sparks) { sp.x -= this.speed * dt; sp.t += dt; }
    this.sparks = this.sparks.filter((sp) => {
      if (sp.x < -20) return false;
      if (Math.hypot(sp.x - this.X, sp.y - this.y) < 28) { this.score(3, sp.x, sp.y, "+3"); this.burst(sp.x, sp.y, 12, RED); sound.play("catch", { rate: 1.3 }); return false; }
      return true;
    });
    for (const w of this.walls) {
      w.x -= this.speed * dt;
      if (!w.passed && w.x < this.X) {
        w.passed = true; this.passed++;
        const c = this.cutY(w), perfect = Math.abs(this.y - c) < 24;
        if (perfect) {
          this.streak++;
          this.score(2, this.X + 20, c - 30, "PERFECT");
          this.burst(w.x, c, 16, WHITE, 260);
          sound.play("spark", { rate: semis(Math.min(12, this.streak * 2) - 4) });
          if (this.streak === 3 && !this.fever) { this.fever = true; this.say("FEVER  ×2"); sound.play("bigshow"); }
        } else {
          if (this.fever) this.say("FEVER OVER", 0.8);
          this.streak = 0; this.fever = false;
          this.score(1, this.X + 20, c - 30, "");
          sound.play("pass", { rate: Math.min(1.5, 1 + this.passed * 0.015) });
        }
        // Every 15 walls, gravity flips for five.
        if (this.passed % 15 === 0) { this.flip = 5; this.say("GRAVITY FLIP"); sound.play("ringwarn"); this.vy *= -0.3; }
        else if (this.flip) { this.flip--; if (!this.flip) { this.say("GRAVITY BACK", 0.9); sound.play("escape"); this.vy *= -0.3; } }
      }
    }
    this.walls = this.walls.filter((w) => w.x > -40);
    if (this.y < 12 || this.y > S - 12) { this.crash(); return; }
    for (const w of this.walls) {
      if (Math.abs(w.x - this.X) > 40) continue;
      for (const y of this.wallDots(w)) if (Math.hypot(w.x - this.X, y - this.y) < 30) { this.crash(); return; }
    }
  },
  score(n, x, y, label) {
    const v = n * (this.fever ? 2 : 1); this.points += v; setScore(this.points);
    this.pops.push({ x, y, t: 0, s: label ? `${label} +${v}` : `+${v}` });
  },
  draw() {
    ctx.save();
    if (this.shake > 0) ctx.translate(rnd(-1, 1) * this.shake, rnd(-1, 1) * this.shake);
    // Speed: a second, looser field of dots streams past, and the ground tints while gravity is flipped.
    if (this.flip) { ctx.fillStyle = "rgba(229,35,27,.06)"; ctx.fillRect(0, 0, S, S); }
    if (this.fever) { ctx.fillStyle = `rgba(229,35,27,${0.05 + 0.04 * Math.sin(this.clock * 12)})`; ctx.fillRect(0, 0, S, S); }
    ctx.fillStyle = "#2a2a2a";
    const off = (this.scroll * 0.45) % 96;
    for (let x = -off; x < S + 96; x += 96) for (let y = 40; y < S; y += 96) ctx.fillRect(x, y, 3, 3);
    for (const w of this.walls) if (!w.broke) for (const y of this.wallDots(w)) dot(w.x, y, 18, WHITE);
    for (const sp of this.sparks) light(sp.x, sp.y, 7 * (1 + 0.2 * Math.sin(sp.t * 9)));
    this.trail.forEach((p, i) => dot(p.x, p.y, 9 * (i / this.trail.length), RED, (this.fever ? 0.55 : 0.28) * (i / this.trail.length)));
    for (const b of this.bits) dot(b.x, b.y, b.r * (1 - b.t / b.life * 0.5), b.col, 1 - b.t / b.life);
    if (!this.over) {
      // Squash and stretch: long while moving fast, squashed on a flap.
      const st = cl(Math.abs(this.vy) / 700, 0, 0.35), sq = this.squash * 0.25, r = this.fever ? 14 : 12;
      ctx.save(); ctx.translate(this.X, this.y); ctx.scale(1 + sq - st * 0.4, 1 - sq + st);
      if (this.fever) { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 6); g.addColorStop(0, "rgba(229,35,27,.45)"); g.addColorStop(1, "rgba(229,35,27,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 6, 0, TAU); ctx.fill(); }
      light(0, 0, r); ctx.restore();
    }
    for (const q of this.pops) text(q.s, q.x, q.y - q.t * 40, { size: 18, a: 1 - q.t / 0.8, track: 1 });
    ctx.restore();
    text(String(this.points), S / 2, 56, { size: 48 });
    text(`${this.passed} walls`, S / 2, 92, { size: 16, col: GREY });
    if (this.fever) text("FEVER ×2", S - 16, 26, { size: 18, col: RED, align: "right", track: 2 });
    if (this.flip) text(`FLIPPED · ${this.flip}`, 16, 26, { size: 18, col: RED, align: "left", track: 2 });
    if (this.banner) { const b = this.banner, a = Math.min(1, b.t * 3, (b.life - b.t) * 6); text(b.text, S / 2, S / 2 - 120, { size: 34, a, track: 3, col: b.text.startsWith("GRAVITY F") || b.text.startsWith("FEVER  ") ? RED : WHITE }); }
    if (this.over && this.dead > 1.3) veil(`${this.points} points`, `${this.passed} walls · tap to fly again`);
  },
};

// ---------- 3. Snake ----------
// Phone first: tap the left or right half to turn that way (one thumb), or swipe. The edges are
// open: leave one side and come back on the other. One undo per game rewinds a crash, like an edit.
const snake = {
  id: "snake", name: "Snake",
  hint: TOUCH ? "Tap the left or right half of the board to turn that way, or swipe. Eat the red light; the edges let you through. One undo per game." : "Arrow keys or WASD. Eat the red light; the edges let you through. One undo per game, when you crash.",
  start: TOUCH ? "Tap to start · tap left or right to turn" : "Press an arrow key to start",
  N: 18, C: 30, O: 30,
  init() {
    this.body = [[9, 9], [8, 9], [7, 9]]; this.prev = this.body.map((p) => [...p]); this.dir = [1, 0]; this.q = [];
    this.acc = 0; this.step = 0.17; this.over = false; this.points = 0; this.eaten = 0; this.grow = 0;
    this.food = this.place(); this.big = null; this.undo = 1; this.hist = []; this.pause = 0; this.flash = 0; this.pops = [];
  },
  place() { let f; do f = [Math.floor(Math.random() * this.N), Math.floor(Math.random() * this.N)]; while (this.body.some((p) => p[0] === f[0] && p[1] === f[1]) || (this.food && f[0] === this.food[0] && f[1] === this.food[1])); return f; },
  heading() { return this.q.length ? this.q[this.q.length - 1] : this.dir; },
  turn(d) { const last = this.heading(); if (d[0] === -last[0] && d[1] === -last[1]) return; if (d[0] === last[0] && d[1] === last[1]) return; if (this.q.length < 3) { this.q.push(d); sound.play("turn"); } },
  turnSide(side) { const [x, y] = this.heading(); this.turn(side < 0 ? [y, -x] : [-y, x]); },
  key(k) { const d = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] }[k]; if (d) this.turn(d); },
  go() { this.skipUp = true; },
  press() { this.swiped = false; },
  // A swipe turns as soon as the finger has moved far enough, and one drag can turn more than once.
  move() {
    if (!ptr.down) return;
    const dx = ptr.x - ptr.sx, dy = ptr.y - ptr.sy;
    if (Math.hypot(dx, dy) < 34) return;
    this.swiped = true;
    this.turn(Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)]);
    ptr.sx = ptr.x; ptr.sy = ptr.y;
  },
  // A tap (no swipe): left half turns left, right half turns right, relative to where the snake goes.
  release() {
    if (this.skipUp) { this.skipUp = false; return; }
    if (this.over || this.swiped) return;
    this.turnSide(ptr.x < S / 2 ? -1 : 1);
  },
  save() { this.hist.push({ body: this.body.map((p) => [...p]), dir: [...this.dir], food: [...this.food], big: this.big && { ...this.big }, points: this.points, grow: this.grow, step: this.step }); if (this.hist.length > 8) this.hist.shift(); },
  crash() {
    if (this.undo > 0 && this.hist.length) {
      // Undo: back about a second, a short freeze to get your bearings, and on you go.
      const h = this.hist[0]; this.undo--;
      this.body = h.body; this.prev = this.body.map((p) => [...p]); this.dir = h.dir; this.food = h.food; this.big = h.big; this.points = h.points; this.grow = h.grow; this.step = h.step;
      this.q = []; this.hist = []; this.acc = 0; this.pause = 1.1; this.flash = 1.1; setScore(this.points);
      sound.play("undo");
      return;
    }
    this.over = true; sound.play("crash");
  },
  eat(n, at) { this.points += n; this.grow += n - 1; setScore(this.points); this.step = Math.max(0.075, this.step * 0.975); this.pops.push({ x: at[0], y: at[1], t: 0, s: "+" + n }); },
  update(dt) {
    for (const q of this.pops) q.t += dt;
    this.pops = this.pops.filter((q) => q.t < 0.8);
    if (this.flash > 0) this.flash -= dt;
    if (this.over) return;
    if (this.pause > 0) { this.pause -= dt; return; }
    if (this.big) { this.big.t -= dt; if (this.big.t <= 0) this.big = null; }
    this.acc += dt;
    while (this.acc >= this.step) {
      this.acc -= this.step;
      this.save();
      if (this.q.length) this.dir = this.q.shift();
      const N = this.N, h = [(this.body[0][0] + this.dir[0] + N) % N, (this.body[0][1] + this.dir[1] + N) % N];
      if (this.body.slice(0, this.grow > 0 ? this.body.length : -1).some((p) => p[0] === h[0] && p[1] === h[1])) { this.crash(); return; }
      this.prev = this.body.map((p) => [...p]);
      this.body.unshift(h);
      if (h[0] === this.food[0] && h[1] === this.food[1]) {
        this.eaten++; this.eat(1, h); this.food = this.place();
        sound.play("eat", { rate: Math.min(1.6, 1 + this.eaten * 0.02) });
        if (this.eaten % 5 === 0 && !this.big) { const f = this.place(); this.big = { x: f[0], y: f[1], t: 6 }; sound.play("bigshow"); }
        this.grow++;
      } else if (this.big && h[0] === this.big.x && h[1] === this.big.y) { this.eat(3, h); this.big = null; this.grow++; sound.play("bigeat"); }
      if (this.grow > 0) { this.grow--; this.prev.push(this.prev[this.prev.length - 1]); } else this.body.pop();
    }
  },
  draw() {
    const P = (c) => this.O + c * this.C + this.C / 2, k = this.over || this.pause > 0 ? 1 : this.acc / this.step;
    // Open edges: a dashed border.
    ctx.strokeStyle = LINE; ctx.setLineDash([6, 8]); ctx.strokeRect(this.O - 0.5, this.O - 0.5, this.N * this.C + 1, this.N * this.C + 1); ctx.setLineDash([]);
    if (TOUCH && !this.over) { ctx.fillStyle = "rgba(255,255,255,.025)"; ctx.fillRect(S / 2, this.O, 1, this.N * this.C); }
    light(P(this.food[0]), P(this.food[1]), 10);
    if (this.big) { const pulse = 1 + 0.15 * Math.sin(this.big.t * 10); light(P(this.big.x), P(this.big.y), 15 * pulse); text(String(Math.ceil(this.big.t)), P(this.big.x), P(this.big.y) - 30, { size: 16, col: GREY }); }
    this.body.forEach((p, i) => {
      const q = this.prev[i] || p, jump = Math.abs(p[0] - q[0]) > 1 || Math.abs(p[1] - q[1]) > 1;
      const x = jump ? p[0] : q[0] + (p[0] - q[0]) * k, y = jump ? p[1] : q[1] + (p[1] - q[1]) * k;
      dot(P(x), P(y), 12, WHITE, 1 - Math.min(0.7, i * 0.03));
    });
    for (const q of this.pops) text(q.s, P(q.x), P(q.y) - 24 - q.t * 30, { size: 18, a: 1 - q.t / 0.8 });
    text(String(this.points), 16, 14, { size: 20, align: "left" });
    text("UNDO", S - 36, 14, { size: 16, col: this.undo ? WHITE : "#3a3a3a", align: "right" });
    dot(S - 22, 14, 6, this.undo ? RED : "#3a3a3a");
    if (this.flash > 0) text("UNDO · REWOUND", S / 2, S / 2, { size: 30, a: Math.min(1, this.flash), track: 2 });
    if (this.over) veil("Game over", `${this.points} lights · length ${this.body.length} · tap to restart`);
  },
};

// ---------- 4. Dodge ----------
// You are the red light. Frames bounce around; skim past them for points (a combo builds), grab the
// red sparks, and every so often the ring closes in around you: get out through its cut.
const dodge = {
  id: "dodge", name: "Dodge",
  hint: TOUCH ? "Drag anywhere to move the red light. Skim past frames for points, grab the sparks, and when the ring closes in, get out through its cut." : "Move with the mouse or arrows. Skim past frames for points, grab the sparks, and when the ring closes in, get out through its cut.",
  start: TOUCH ? "Tap, then drag anywhere to move" : "Click to start, then move the mouse",
  init() {
    this.p = { x: S / 2, y: S / 2 }; this.ws = []; this.sparks = []; this.pops = []; this.ring = null;
    this.t = 0; this.next = 0.6; this.nextSpark = 2.5; this.nextRing = 11; this.nextChaser = 24;
    this.points = 0; this.carry = 0; this.mult = 1; this.comboT = 0; this.over = false; this.dead = 0; this.keysMode = false; this.shake = 0;
  },
  press() { this.grab = { x: this.p.x, y: this.p.y, fx: ptr.x, fy: ptr.y }; },
  go() { this.press(); },
  move() {
    this.keysMode = false;
    if (ptr.type !== "mouse" && ptr.down && this.grab) {
      // Relative drag on touch, so the dot is never under the finger.
      this.p.x = this.grab.x + (ptr.x - this.grab.fx) * 1.15; this.p.y = this.grab.y + (ptr.y - this.grab.fy) * 1.15;
    }
  },
  key(k) { if (k.startsWith("Arrow")) this.keysMode = true; },
  edge() {
    const e = Math.floor(Math.random() * 4);
    let x = e === 0 ? 20 : e === 1 ? S - 20 : rnd(20, S - 20), y = e === 2 ? 20 : e === 3 ? S - 20 : rnd(20, S - 20);
    if (Math.hypot(x - this.p.x, y - this.p.y) < 190) { x = S - x; y = S - y; }
    return [x, y];
  },
  spawn(chaser = false) {
    const [x, y] = this.edge(), s = rnd(140, 230), a = rnd(0, TAU);
    this.ws.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, born: this.t, chaser, near: false });
  },
  gain(n, x, y, label) {
    const v = n * this.mult; this.points += v; setScore(this.points);
    this.pops.push({ x, y, t: 0, s: `${label ? label + " " : ""}+${v}` });
  },
  combo() { this.mult = Math.min(5, this.mult + 1); this.comboT = 2.5; },
  ready() { return this.dead > 1.2; },
  die() { this.over = true; this.dead = 0; this.shake = 14; sound.play("hit"); },
  update(dt) {
    for (const q of this.pops) q.t += dt;
    this.pops = this.pops.filter((q) => q.t < 0.9);
    this.shake = Math.max(0, this.shake - dt * 40);
    if (this.over) { this.dead += dt; dt *= 0.2; if (this.dead > 1.2) return; } // a beat of slow motion
    else {
      this.t += dt;
      this.carry += dt; while (this.carry >= 1) { this.carry -= 1; this.points += 1; setScore(this.points); }
      if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.mult = 1; }
      const bouncers = this.ws.filter((w) => !w.chaser).length;
      if (bouncers < 7 && this.t >= this.next) { this.spawn(); this.next += 3; }
      if (this.t >= this.nextChaser && this.ws.filter((w) => w.chaser).length < 2) { this.spawn(true); this.nextChaser += 16; }
      if (this.t >= this.nextSpark && this.sparks.length < 2) {
        let x, y, k = 0; do { x = rnd(50, S - 50); y = rnd(60, S - 50); } while (Math.hypot(x - this.p.x, y - this.p.y) < 140 && k++ < 20);
        this.sparks.push({ x, y, t: 0 }); this.nextSpark = this.t + rnd(3, 5);
      }
      if (!this.ring && this.t >= this.nextRing) {
        // The ring closes in around wherever you are; its cut points somewhere random.
        this.ring = { x: this.p.x, y: this.p.y, R: 270, rot: rnd(0, TAU), spin: rnd(-0.45, 0.45), warn: 1.4, out: false };
        this.nextRing = this.t + 14;
        sound.play("ringwarn");
      }
      if (this.keysMode) {
        const v = 330 * dt;
        if (keys.ArrowLeft) this.p.x -= v; if (keys.ArrowRight) this.p.x += v; if (keys.ArrowUp) this.p.y -= v; if (keys.ArrowDown) this.p.y += v;
      } else if (ptr.type === "mouse") {
        this.p.x += (ptr.x - this.p.x) * Math.min(1, dt * 14); this.p.y += (ptr.y - this.p.y) * Math.min(1, dt * 14);
      }
      this.p.x = cl(this.p.x, 14, S - 14); this.p.y = cl(this.p.y, 14, S - 14);
    }
    const p = this.p;
    for (const w of this.ws) {
      if (w.chaser) {
        const dx = p.x - w.x, dy = p.y - w.y, d = Math.hypot(dx, dy) || 1;
        w.vx += (dx / d) * 260 * dt; w.vy += (dy / d) * 260 * dt;
        const v = Math.hypot(w.vx, w.vy), top = 150; if (v > top) { w.vx *= top / v; w.vy *= top / v; }
      }
      w.x += w.vx * dt; w.y += w.vy * dt;
      if (w.x < 14 || w.x > S - 14) { w.vx *= -1; w.x = cl(w.x, 14, S - 14); }
      if (w.y < 14 || w.y > S - 14) { w.vy *= -1; w.y = cl(w.y, 14, S - 14); }
      if (this.over || this.t - w.born < 0.6) continue;
      const d = Math.hypot(w.x - p.x, w.y - p.y);
      if (d < 26) { this.die(); break; }
      // A near miss: close, but not touching. Scores once per pass.
      if (d < 46 && !w.near) { w.near = true; this.gain(5, w.x, w.y - 26, ""); this.combo(); sound.play("graze", { rate: 1 + (this.mult - 2) * 0.08 }); }
      if (d > 80) w.near = false;
    }
    for (const sp of this.sparks) sp.t += dt;
    if (!this.over) {
      this.sparks = this.sparks.filter((sp) => { if (Math.hypot(sp.x - p.x, sp.y - p.y) < 26) { this.gain(10, sp.x, sp.y - 24, ""); this.combo(); sound.play("spark", { rate: semis((this.mult - 2) * 2) }); return false; } return true; });
    }
    const r = this.ring;
    if (r) {
      if (r.warn > 0) r.warn -= dt;
      else {
        r.R -= 64 * dt; r.rot += r.spin * dt;
        const dx = p.x - r.x, dy = p.y - r.y, d = Math.hypot(dx, dy);
        if (!this.over && !r.out && d > r.R + 16) { r.out = true; this.gain(25, p.x, p.y - 30, "THROUGH THE CUT"); this.combo(); sound.play("escape"); }
        if (!this.over && !r.out && Math.abs(d - r.R) < 16 && Math.abs(wrapAngle(Math.atan2(dy, dx) - r.rot)) > 0.42) this.die();
        if (r.R < 8) this.ring = null;
      }
    }
  },
  draw() {
    ctx.save();
    if (this.shake > 0) ctx.translate(rnd(-1, 1) * this.shake, rnd(-1, 1) * this.shake);
    const r = this.ring;
    if (r) {
      const live = r.warn <= 0, a = live ? 1 : 0.25 + 0.25 * Math.sin(r.warn * 20);
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * a})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(1, r.R), r.rot + 0.42, r.rot + TAU - 0.42); ctx.stroke(); ctx.lineWidth = 1;
      for (const i of RING) { const an = r.rot + Math.PI / 12 + (i * Math.PI) / 6; dot(r.x + r.R * Math.cos(an), r.y + r.R * Math.sin(an), 12, WHITE, a); }
      if (!live) text("THE RING IS CLOSING", S / 2, S - 40, { size: 20, col: GREY, track: 2 });
    }
    for (const sp of this.sparks) { const pulse = 1 + 0.18 * Math.sin(sp.t * 8); light(sp.x, sp.y, 7 * pulse); }
    for (const w of this.ws) {
      const age = this.t - w.born, al = age < 0.6 ? 0.25 + age : 1;
      dot(w.x, w.y, 13, WHITE, al);
      if (w.chaser) { ctx.strokeStyle = `rgba(255,255,255,${0.5 * al})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(w.x, w.y, 21, 0, TAU); ctx.stroke(); ctx.lineWidth = 1; }
    }
    light(this.p.x, this.p.y, 13);
    for (const q of this.pops) text(q.s, q.x, q.y - q.t * 40, { size: 18, a: 1 - q.t / 0.9, track: 1 });
    ctx.restore();
    text(String(this.points), 16, 28, { size: 26, align: "left" });
    if (this.mult > 1) text(`x${this.mult}`, 16 + String(this.points).length * 17 + 16, 28, { size: 22, col: RED, align: "left" });
    text(`${Math.floor(this.t)} s`, S - 16, 28, { size: 20, col: GREY, align: "right" });
    if (this.over && this.dead > 1.2) veil(`${this.points} points`, `${Math.floor(this.t)} s survived · tap to try again`);
  },
};

// ---------- 5. Sequence ----------
const seq = {
  id: "seq", name: "Sequence",
  hint: "Watch the ring light up, then tap the frames in the same order. Each round adds one.",
  start: "Tap to watch the first frame",
  R: 180,
  NOTES: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21],
  ping(n) { sound.play("note", { rate: semis(this.NOTES[n] - 5) }); },
  init() { this.list = []; this.state = "idle"; this.over = false; this.lit = -1; this.litT = 0; this.i = 0; this.wait = 0; this.wrong = -1; },
  go() { this.add(); },
  add() { this.list.push(Math.floor(Math.random() * 10)); this.state = "show"; this.i = 0; this.wait = 0.6; },
  press() {
    if (this.state !== "input") return;
    let hit = -1, bd = 46;
    RING.forEach((k, n) => { const [x, y] = ringAt(k, this.R), d = Math.hypot(ptr.x - x, ptr.y - y); if (d < bd) { bd = d; hit = n; } });
    if (hit < 0) return;
    this.lit = hit; this.litT = 0.22;
    if (hit !== this.list[this.i]) { this.over = true; this.wrong = hit; sound.play("wrong"); return; }
    this.ping(hit);
    this.i++;
    if (this.i === this.list.length) { setScore(this.list.length); this.state = "pause"; this.wait = 0.7; }
  },
  update(dt) {
    this.litT -= dt;
    if (this.over || this.state === "idle") return;
    this.wait -= dt;
    if (this.state === "show" && this.wait <= 0) {
      if (this.i < this.list.length) { this.lit = this.list[this.i]; this.litT = 0.38; this.ping(this.lit); this.i++; this.wait = Math.max(0.32, 0.62 - this.list.length * 0.02); }
      else { this.state = "input"; this.i = 0; }
    }
    if (this.state === "pause" && this.wait <= 0) this.add();
  },
  draw() {
    RING.forEach((k, n) => { const [x, y] = ringAt(k, this.R), on = n === this.lit && this.litT > 0; dot(x, y, on ? 31 : 25, this.over && n === this.wrong ? DIM : WHITE, on ? 1 : 0.3); });
    light(S / 2, S / 2, this.state === "show" ? 26 : 20);
    text(this.state === "input" ? "YOUR TURN" : this.state === "show" ? "WATCH" : "", S / 2, S / 2 + 66, { size: 20, col: GREY, track: 2 });
    text(`ROUND ${this.list.length}`, 16, 26, { size: 20, col: GREY, align: "left" });
    if (this.over) veil("Wrong frame", `you reached round ${this.list.length} · tap to retry`);
  },
};

// ---------- 6. Catch the light ----------
const catchLight = {
  id: "catch", name: "Catch the light",
  hint: "The red light jumps between the ten frames. Tap it before it moves. Miss three times and it's over.",
  start: "Tap to start, then tap the red",
  init() {
    this.P = []; for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) this.P.push([S / 2 + (c - 2) * 104, S / 2 + (r - 0.5) * 128]);
    this.cur = -1; this.win = 1.15; this.t = 0; this.lives = 3; this.over = false; this.rings = [];
  },
  go() { this.jump(); },
  jump() { let n; do n = Math.floor(Math.random() * 10); while (n === this.cur); this.cur = n; this.t = 0; },
  press() {
    if (this.cur < 0) return;
    const [x, y] = this.P[this.cur];
    if (Math.hypot(ptr.x - x, ptr.y - y) < 46) { setScore(score + 1); sound.play("catch", { rate: Math.min(1.7, 1 + score * 0.025) }); this.rings.push({ x, y, t: 0 }); this.win = Math.max(0.42, this.win * 0.95); this.jump(); }
    else this.miss();
  },
  miss() { this.lives--; if (this.lives <= 0) { this.over = true; sound.play("over"); } else { sound.play("miss"); this.jump(); } },
  update(dt) {
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < 0.4);
    if (this.over || this.cur < 0) return;
    this.t += dt; if (this.t > this.win) this.miss();
  },
  draw() {
    this.P.forEach(([x, y], i) => (i === this.cur && !this.over ? light(x, y, 27 * (1 - 0.25 * cl(this.t / this.win))) : dot(x, y, 27, WHITE, 0.9)));
    for (const r of this.rings) { ctx.strokeStyle = `rgba(229,35,27,${1 - r.t / 0.4})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(r.x, r.y, 27 + r.t * 120, 0, TAU); ctx.stroke(); ctx.lineWidth = 1; }
    for (let i = 0; i < 3; i++) dot(S - 26 - i * 26, 26, 8, i < this.lives ? RED : "#3a3a3a");
    if (this.over) veil(`${score} caught`, "tap to play again");
  },
};

// ---------- the page ----------
const GAMES = [keep, fly, snake, dodge, seq, catchLight];
const list = document.getElementById("games");
for (const g of GAMES) {
  const b = document.createElement("button");
  b.type = "button"; b.setAttribute("role", "tab"); b.textContent = g.name;
  b.addEventListener("click", () => { begin(g); stage.focus({ preventScroll: true }); });
  g.tab = b; list.appendChild(b);
}


let startBest = 0, wasOver = false;
function begin(g) {
  G = g;
  for (const x of GAMES) x.tab.setAttribute("aria-selected", String(x === g));
  best = store.get(g.id); startBest = best; wasOver = false; setScore(0);
  g.init(); g.waiting = true;
  document.getElementById("hint").textContent = g.hint;
}

// Run only while the board is on screen and the tab is visible.
let visible = true, last = performance.now();
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(stage);
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (visible && !document.hidden) {
    if (!G.waiting) G.update(dt);
    if (G.over && !wasOver && score > startBest && startBest > 0) setTimeout(() => sound.play("best"), 650);
    wasOver = !!G.over;
    sheet(); G.draw();
    if (G.waiting) veil(G.name.toUpperCase(), G.start);
  }
  requestAnimationFrame(frame);
}
// Sign-in first: signed out, the gate sends people to sign in and back here; signed in, the games run.
async function unlock() {
  const user = hasSession() ? await currentUser().catch(() => null) : null;
  if (!user) {
    document.getElementById("gate-state").hidden = true;
    document.getElementById("gate-out").hidden = false;
    return;
  }
  document.getElementById("gate").hidden = true;
  document.getElementById("arcade").hidden = false;
  document.getElementById("who").textContent = `Playing as ${user.name.split(" ")[0]}`;
  document.getElementById("signout").addEventListener("click", async () => { await signOut(); location.reload(); });
  const sw = document.getElementById("sound");
  const showSound = () => { sw.textContent = sound.on ? "Sound on" : "Sound off"; sw.setAttribute("aria-pressed", String(sound.on)); };
  sw.addEventListener("click", () => { sound.set(!sound.on); sound.wake(); showSound(); if (sound.on) sound.play("start"); });
  showSound();
  fit();
  begin(keep);
  requestAnimationFrame(frame);
}
unlock();
// For automated tests only: /play/?test exposes the games.
if (new URLSearchParams(location.search).has("test")) window.__play = { GAMES, begin, ptr, sound, get G() { return G; }, get score() { return score; } };
