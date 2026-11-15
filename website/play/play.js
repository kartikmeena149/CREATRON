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
  cv.setPointerCapture(e.pointerId);
  Object.assign(ptr, toBoard(e), { down: true, type: e.pointerType });
  ptr.sx = ptr.x; ptr.sy = ptr.y;
  if (G.waiting) { G.waiting = false; G.go?.(); return; }
  if (G.over) { begin(G); G.waiting = false; G.go?.(); return; }
  G.press?.();
});
cv.addEventListener("pointermove", (e) => { Object.assign(ptr, toBoard(e), { type: e.pointerType }); G.move?.(); });
cv.addEventListener("pointerup", () => { if (!ptr.down) return; ptr.down = false; G.release?.(); });
cv.addEventListener("pointercancel", () => { ptr.down = false; });
cv.addEventListener("contextmenu", (e) => e.preventDefault());

stage.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
  keys[e.key] = true;
  if (e.key === "r" || e.key === "R") { begin(G); return; }
  if (G.waiting && (e.key === " " || e.key.startsWith("Arrow"))) { G.waiting = false; G.go?.(); if (e.key === " ") return; }
  if (G.over && e.key === " ") { begin(G); G.waiting = false; G.go?.(); return; }
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
    if (Math.abs(wrapAngle(a - this.rot)) < 0.42) { this.over = true; return; } // through the cut
    const nx = dx / d, ny = dy / d, along = b.vx * nx + b.vy * ny;
    if (along <= 0) return;
    b.vx -= 2 * along * nx; b.vy -= 2 * along * ny;
    // A little spin on every bounce, so no two rounds play the same.
    const tw = rnd(-0.25, 0.25), c = Math.cos(tw), s = Math.sin(tw), vx = b.vx * c - b.vy * s, vy = b.vx * s + b.vy * c;
    this.speed = Math.min(620, this.speed * 1.045);
    const m = Math.hypot(vx, vy); b.vx = (vx / m) * this.speed; b.vy = (vy / m) * this.speed;
    b.x = S / 2 + nx * (wall - 1); b.y = S / 2 + ny * (wall - 1);
    setScore(score + 1);
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
// Walls of white frames scroll past, each with a cut in it. Tap to lift the red light through.
const fly = {
  id: "fly", name: "Through the cut",
  hint: TOUCH ? "Tap to lift the red light. Every wall of frames has a cut in it: fly through." : "Click, tap or press space to lift the red light. Every wall of frames has a cut in it: fly through.",
  start: TOUCH ? "Tap to fly" : "Click or press space to fly",
  SLOTS: 11, PITCH: 54.6, X: 150,
  init() { this.y = S / 2; this.vy = 0; this.walls = []; this.next = 0.9; this.over = false; this.passed = 0; this.speed = 190; this.out = 0; },
  flap() { if (!this.over) this.vy = -330; },
  go() { this.flap(); },
  press() { this.flap(); },
  key(k) { if (k === " " || k === "ArrowUp") this.flap(); },
  slotY(i) { return 27 + i * this.PITCH; },
  update(dt) {
    this.vy += 1100 * dt;
    if (this.over) { this.out += dt; this.y = Math.min(S + 40, this.y + this.vy * dt); return; }
    this.y += this.vy * dt;
    this.next -= dt;
    if (this.next <= 0) { this.walls.push({ x: S + 40, gap: Math.floor(rnd(1, this.SLOTS - 3)), passed: false }); this.next = Math.max(1.05, 1.55 - this.passed * 0.02); }
    this.speed = Math.min(300, 190 + this.passed * 4);
    for (const w of this.walls) { w.x -= this.speed * dt; if (!w.passed && w.x < this.X) { w.passed = true; this.passed++; setScore(this.passed); } }
    this.walls = this.walls.filter((w) => w.x > -40);
    if (this.y < 12 || this.y > S - 12) { this.over = true; return; }
    for (const w of this.walls) {
      if (Math.abs(w.x - this.X) > 40) continue;
      for (let i = 0; i < this.SLOTS; i++) {
        if (i === w.gap || i === w.gap + 1) continue;
        if (Math.hypot(w.x - this.X, this.slotY(i) - this.y) < 30) { this.over = true; return; }
      }
    }
  },
  draw() {
    for (const w of this.walls) for (let i = 0; i < this.SLOTS; i++) if (i !== w.gap && i !== w.gap + 1) dot(w.x, this.slotY(i), 18, WHITE);
    light(this.X, this.y, 12);
    text(String(score), S / 2, 60, { size: 48 });
    if (this.over && this.out > 0.5) veil("Hit a frame", `${score} walls · tap to fly again`);
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
  turn(d) { const last = this.heading(); if (d[0] === -last[0] && d[1] === -last[1]) return; if (d[0] === last[0] && d[1] === last[1]) return; if (this.q.length < 3) this.q.push(d); },
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
      return;
    }
    this.over = true;
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
        if (this.eaten % 5 === 0 && !this.big) { const f = this.place(); this.big = { x: f[0], y: f[1], t: 6 }; }
        this.grow++;
      } else if (this.big && h[0] === this.big.x && h[1] === this.big.y) { this.eat(3, h); this.big = null; this.grow++; }
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
  die() { this.over = true; this.dead = 0; this.shake = 14; },
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
      if (d < 46 && !w.near) { w.near = true; this.gain(5, w.x, w.y - 26, ""); this.combo(); }
      if (d > 80) w.near = false;
    }
    for (const sp of this.sparks) sp.t += dt;
    if (!this.over) {
      this.sparks = this.sparks.filter((sp) => { if (Math.hypot(sp.x - p.x, sp.y - p.y) < 26) { this.gain(10, sp.x, sp.y - 24, ""); this.combo(); return false; } return true; });
    }
    const r = this.ring;
    if (r) {
      if (r.warn > 0) r.warn -= dt;
      else {
        r.R -= 64 * dt; r.rot += r.spin * dt;
        const dx = p.x - r.x, dy = p.y - r.y, d = Math.hypot(dx, dy);
        if (!this.over && !r.out && d > r.R + 16) { r.out = true; this.gain(25, p.x, p.y - 30, "THROUGH THE CUT"); this.combo(); }
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
  init() { this.list = []; this.state = "idle"; this.over = false; this.lit = -1; this.litT = 0; this.i = 0; this.wait = 0; this.wrong = -1; },
  go() { this.add(); },
  add() { this.list.push(Math.floor(Math.random() * 10)); this.state = "show"; this.i = 0; this.wait = 0.6; },
  press() {
    if (this.state !== "input") return;
    let hit = -1, bd = 46;
    RING.forEach((k, n) => { const [x, y] = ringAt(k, this.R), d = Math.hypot(ptr.x - x, ptr.y - y); if (d < bd) { bd = d; hit = n; } });
    if (hit < 0) return;
    this.lit = hit; this.litT = 0.22;
    if (hit !== this.list[this.i]) { this.over = true; this.wrong = hit; return; }
    this.i++;
    if (this.i === this.list.length) { setScore(this.list.length); this.state = "pause"; this.wait = 0.7; }
  },
  update(dt) {
    this.litT -= dt;
    if (this.over || this.state === "idle") return;
    this.wait -= dt;
    if (this.state === "show" && this.wait <= 0) {
      if (this.i < this.list.length) { this.lit = this.list[this.i]; this.litT = 0.38; this.i++; this.wait = Math.max(0.32, 0.62 - this.list.length * 0.02); }
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
    if (Math.hypot(ptr.x - x, ptr.y - y) < 46) { setScore(score + 1); this.rings.push({ x, y, t: 0 }); this.win = Math.max(0.42, this.win * 0.95); this.jump(); }
    else this.miss();
  },
  miss() { this.lives--; if (this.lives <= 0) this.over = true; else this.jump(); },
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


function begin(g) {
  G = g;
  for (const x of GAMES) x.tab.setAttribute("aria-selected", String(x === g));
  best = store.get(g.id); setScore(0);
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
  fit();
  begin(keep);
  requestAnimationFrame(frame);
}
unlock();
// For automated tests only: /play/?test exposes the games.
if (new URLSearchParams(location.search).has("test")) window.__play = { GAMES, begin, ptr, get G() { return G; }, get score() { return score; } };
