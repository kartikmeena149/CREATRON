// Six games made from the Creatro mark: ten white frames and one red light.
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

// ---------- 1. Shoot the cut ----------
const cut = {
  id: "cut", name: "Shoot the cut",
  hint: "Tap or press space to fire the red light out through the gap in the ring. Hit a frame and it's over.",
  start: "Tap to fire through the cut",
  init() { this.rot = 0; this.w = 1.3; this.dir = 1; this.rd = 0; this.fly = false; this.over = false; this.flash = 0; this.hit = -1; },
  fire() { if (!this.fly && !this.over) { this.fly = true; this.checked = false; } },
  go() { this.fire(); },
  press() { this.fire(); },
  key(k) { if (k === " ") this.fire(); },
  update(dt) {
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (this.over) return;
    this.rot += this.w * this.dir * dt;
    if (!this.fly) return;
    this.rd += 760 * dt;
    const R = 170;
    if (!this.checked && this.rd >= R - 16) {
      this.checked = true;
      if (Math.abs(wrapAngle(-this.rot)) < 0.36) { setScore(score + 1); this.flash = 1; }
      else {
        this.over = true; this.rd = R - 26;
        let bd = 9;
        for (const k of RING) { const a = Math.abs(wrapAngle(this.rot + Math.PI / 12 + (k * Math.PI) / 6)); if (a < bd) { bd = a; this.hit = k; } }
      }
    }
    if (this.rd > 330) { this.fly = false; this.rd = 0; this.w = Math.min(4.2, this.w * 1.08); if (Math.random() < 0.35) this.dir *= -1; }
  },
  draw() {
    const R = 170;
    ctx.strokeStyle = LINE; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(S / 2, S / 2); ctx.lineTo(S - 24, S / 2); ctx.stroke(); ctx.setLineDash([]);
    for (const k of RING) { const [x, y] = ringAt(k, R, this.rot); dot(x, y, 24, this.over && k === this.hit ? DIM : WHITE); }
    if (this.flash > 0) { ctx.strokeStyle = `rgba(255,255,255,${this.flash * 0.5})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(S / 2, S / 2, R + (1 - this.flash) * 120, 0, TAU); ctx.stroke(); ctx.lineWidth = 1; }
    light(S / 2 + this.rd, S / 2, 24);
    text(String(score), S / 2, 60, { size: 44 });
    if (this.over) veil("Hit a frame", `${score} through · tap to play again`);
  },
};

// ---------- 2. Bowling ----------
const bowl = {
  id: "bowl", name: "Bowling",
  hint: "Drag back from the red ball and let go, like a slingshot. Five frames, two rolls each.",
  start: "Drag back from the ball, let go",
  L: 170, Rr: 430,
  init() { this.frame = 1; this.roll = 1; this.total = 0; this.msg = ""; this.msgT = 0; this.over = false; this.rack(); this.reset(); },
  rack() {
    this.pins = [];
    for (let row = 0; row < 4; row++) for (let j = 0; j <= row; j++) {
      const x = S / 2 + (j - row / 2) * 36, y = 190 - row * 31;
      this.pins.push({ x, y, x0: x, y0: y, vx: 0, vy: 0, r: 13, m: 1, down: false, gone: false });
    }
  },
  reset() { this.ball = { x: S / 2, y: 530, vx: 0, vy: 0, r: 17, m: 2.6 }; this.moving = false; this.t = 0; },
  go() { /* the first drag is the first roll */ },
  aiming() { return ptr.down && !this.moving && Math.hypot(ptr.sx - this.ball.x, ptr.sy - this.ball.y) <= 110; },
  release() {
    if (this.over || this.moving) return;
    const b = this.ball, dx = ptr.sx - ptr.x, dy = ptr.sy - ptr.y, d = Math.hypot(dx, dy);
    if (d < 14 || Math.hypot(ptr.sx - b.x, ptr.sy - b.y) > 110) return;
    const p = Math.min(1, d / 160) * 1100;
    b.vx = (dx / d) * p + rnd(-14, 14); b.vy = (dy / d) * p;
    if (b.vy > -80) { b.vx = b.vy = 0; return; }
    this.moving = true; this.t = 0;
  },
  update(dt) {
    if (this.msgT > 0) this.msgT -= dt;
    if (!this.moving) return;
    this.t += dt;
    const n = 4, h = dt / n, all = [this.ball, ...this.pins.filter((p) => !p.gone)];
    for (let s = 0; s < n; s++) {
      for (const o of all) { o.x += o.vx * h; o.y += o.vy * h; const f = Math.pow(o === this.ball ? 0.7 : 0.06, h); o.vx *= f; o.vy *= f; }
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
        if (d >= m || d === 0) continue;
        const nx = dx / d, ny = dy / d, o = m - d, ta = b.m / (a.m + b.m), tb = a.m / (a.m + b.m);
        a.x -= nx * o * ta; a.y -= ny * o * ta; b.x += nx * o * tb; b.y += ny * o * tb;
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const e = a === this.ball || b === this.ball ? 0.55 : 0.4, J = (-(1 + e) * rv) / (1 / a.m + 1 / b.m);
          a.vx -= (J * nx) / a.m; a.vy -= (J * ny) / a.m; b.vx += (J * nx) / b.m; b.vy += (J * ny) / b.m;
        }
      }
      const b = this.ball;
      if (b.x < this.L + b.r || b.x > this.Rr - b.r) { b.x = cl(b.x, this.L + b.r, this.Rr - b.r); b.vx = 0; }
      for (const p of this.pins) if (!p.gone && (p.x < this.L - 4 || p.x > this.Rr + 4 || p.y < 20)) p.gone = true;
    }
    const still = all.every((o) => Math.hypot(o.vx, o.vy) < 6);
    if ((still && this.t > 0.4) || this.t > 6 || this.ball.y < -40) this.endRoll();
  },
  endRoll() {
    this.moving = false;
    const down = this.pins.filter((p) => !p.down && (p.gone || Math.hypot(p.x - p.x0, p.y - p.y0) > 9));
    down.forEach((p) => (p.down = true));
    const standing = this.pins.filter((p) => !p.down).length;
    this.total += down.length; setScore(this.total);
    if (this.roll === 1 && standing === 0) { this.msg = "Strike"; this.next(); }
    else if (this.roll === 2) { this.msg = standing === 0 ? "Spare" : `${down.length} down`; this.next(); }
    else { this.msg = `${down.length} down`; this.roll = 2; this.pins.forEach((p) => { if (p.down) p.gone = true; }); this.reset(); }
    this.msgT = 1.4;
  },
  next() { if (this.frame === 5) { this.over = true; return; } this.frame++; this.roll = 1; this.rack(); this.reset(); },
  draw() {
    ctx.fillStyle = "#111"; ctx.fillRect(this.L, 0, this.Rr - this.L, S);
    ctx.strokeStyle = LINE; ctx.strokeRect(this.L + 0.5, -1, this.Rr - this.L - 1, S + 2);
    ctx.fillStyle = LINE; ctx.fillRect(this.L, 470, this.Rr - this.L, 1);
    for (const p of this.pins) if (!p.gone) dot(p.x, p.y, p.r, p.down ? DIM : WHITE);
    const b = this.ball;
    if (this.aiming()) {
      const dx = ptr.sx - ptr.x, dy = ptr.sy - ptr.y;
      ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + dx * 2.2, b.y + dy * 2.2); ctx.stroke(); ctx.setLineDash([]);
    }
    light(b.x, b.y, b.r);
    text(`Frame ${this.frame}/5 · Roll ${this.roll}`.toUpperCase(), 16, 26, { size: 20, col: GREY, align: "left" });
    if (this.msgT > 0) text(this.msg.toUpperCase(), S / 2, 300, { size: 38, a: cl(this.msgT), track: 2 });
    if (this.over) veil(`${this.total} pins`, "out of 50 · tap to bowl again");
  },
};

// ---------- 3. Snake ----------
const snake = {
  id: "snake", name: "Snake", pad: true,
  hint: TOUCH ? "Swipe on the board or use the arrows below. Eat the red light; don't hit the wall or yourself." : "Arrow keys or WASD. Eat the red light; don't hit the wall or yourself.",
  start: TOUCH ? "Tap, then swipe to steer" : "Press an arrow key to start",
  N: 18, C: 30, O: 30,
  init() { this.body = [[9, 9], [8, 9], [7, 9]]; this.prev = this.body.map((p) => [...p]); this.dir = [1, 0]; this.q = []; this.acc = 0; this.step = 0.14; this.over = false; this.food = this.place(); },
  place() { let f; do f = [Math.floor(Math.random() * this.N), Math.floor(Math.random() * this.N)]; while (this.body.some((p) => p[0] === f[0] && p[1] === f[1])); return f; },
  turn(d) { const last = this.q.length ? this.q[this.q.length - 1] : this.dir; if (d[0] === -last[0] && d[1] === -last[1]) return; if (d[0] === last[0] && d[1] === last[1]) return; if (this.q.length < 3) this.q.push(d); },
  key(k) { const d = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] }[k]; if (d) this.turn(d); },
  dir4(name) { this.turn({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[name]); },
  // A swipe turns as soon as the finger has moved far enough, and one drag can turn more than once.
  move() {
    if (!ptr.down) return;
    const dx = ptr.x - ptr.sx, dy = ptr.y - ptr.sy;
    if (Math.hypot(dx, dy) < 34) return;
    this.turn(Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)]);
    ptr.sx = ptr.x; ptr.sy = ptr.y;
  },
  update(dt) {
    if (this.over) return;
    this.acc += dt;
    while (this.acc >= this.step) {
      this.acc -= this.step;
      if (this.q.length) this.dir = this.q.shift();
      const h = [this.body[0][0] + this.dir[0], this.body[0][1] + this.dir[1]];
      if (h[0] < 0 || h[1] < 0 || h[0] >= this.N || h[1] >= this.N || this.body.slice(0, -1).some((p) => p[0] === h[0] && p[1] === h[1])) { this.over = true; return; }
      this.prev = this.body.map((p) => [...p]);
      const ate = h[0] === this.food[0] && h[1] === this.food[1];
      this.body.unshift(h);
      if (!ate) this.body.pop();
      else { this.prev.push(this.prev[this.prev.length - 1]); setScore(this.body.length - 3); this.food = this.place(); this.step = Math.max(0.065, this.step * 0.97); }
    }
  },
  draw() {
    const P = (c) => this.O + c * this.C + this.C / 2, k = this.over ? 1 : this.acc / this.step;
    ctx.strokeStyle = LINE; ctx.strokeRect(this.O - 0.5, this.O - 0.5, this.N * this.C + 1, this.N * this.C + 1);
    light(P(this.food[0]), P(this.food[1]), 11);
    this.body.forEach((p, i) => { const q = this.prev[i] || p; dot(P(q[0] + (p[0] - q[0]) * k), P(q[1] + (p[1] - q[1]) * k), 12, WHITE, 1 - Math.min(0.7, i * 0.035)); });
    if (this.over) veil("Game over", `length ${this.body.length} · tap to restart`);
  },
};

// ---------- 4. Dodge ----------
const dodge = {
  id: "dodge", name: "Dodge",
  hint: TOUCH ? "You are the red light. Drag anywhere on the board to move it. A white frame joins every 3 s, up to ten." : "You are the red light. Move with the mouse or arrows. A white frame joins every 3 s, up to ten.",
  start: TOUCH ? "Tap, then drag anywhere to move" : "Click to start, then move the mouse",
  init() { this.p = { x: S / 2, y: S / 2 }; this.ws = []; this.t = 0; this.next = 0.6; this.over = false; this.keysMode = false; },
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
  spawn() {
    const e = Math.floor(Math.random() * 4), s = rnd(140, 230), a = rnd(0, TAU);
    let x = e === 0 ? 20 : e === 1 ? S - 20 : rnd(20, S - 20), y = e === 2 ? 20 : e === 3 ? S - 20 : rnd(20, S - 20);
    if (Math.hypot(x - this.p.x, y - this.p.y) < 170) { x = S - x; y = S - y; }
    this.ws.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, born: this.t });
  },
  update(dt) {
    if (this.over) return;
    this.t += dt; setScore(Math.floor(this.t));
    if (this.ws.length < 10 && this.t >= this.next) { this.spawn(); this.next += 3; }
    if (this.keysMode) {
      const v = 330 * dt;
      if (keys.ArrowLeft) this.p.x -= v; if (keys.ArrowRight) this.p.x += v; if (keys.ArrowUp) this.p.y -= v; if (keys.ArrowDown) this.p.y += v;
    } else if (ptr.type === "mouse") {
      this.p.x += (ptr.x - this.p.x) * Math.min(1, dt * 14); this.p.y += (ptr.y - this.p.y) * Math.min(1, dt * 14);
    }
    this.p.x = cl(this.p.x, 14, S - 14); this.p.y = cl(this.p.y, 14, S - 14);
    for (const w of this.ws) {
      w.x += w.vx * dt; w.y += w.vy * dt;
      if (w.x < 14 || w.x > S - 14) { w.vx *= -1; w.x = cl(w.x, 14, S - 14); }
      if (w.y < 14 || w.y > S - 14) { w.vy *= -1; w.y = cl(w.y, 14, S - 14); }
      if (this.t - w.born > 0.6 && Math.hypot(w.x - this.p.x, w.y - this.p.y) < 26) this.over = true;
    }
  },
  draw() {
    for (const w of this.ws) { const age = this.t - w.born; dot(w.x, w.y, 13, WHITE, age < 0.6 ? 0.25 + age : 1); }
    light(this.p.x, this.p.y, 13);
    text(`${this.ws.length} / 10`, S - 16, 26, { size: 20, col: GREY, align: "right" });
    if (this.over) veil(`${Math.floor(this.t)} seconds`, "tap to try again");
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
const GAMES = [cut, bowl, snake, dodge, seq, catchLight];
const list = document.getElementById("games");
const pad = document.getElementById("pad");
for (const g of GAMES) {
  const b = document.createElement("button");
  b.type = "button"; b.setAttribute("role", "tab"); b.textContent = g.name;
  b.addEventListener("click", () => { begin(g); stage.focus({ preventScroll: true }); });
  g.tab = b; list.appendChild(b);
}
pad.addEventListener("pointerdown", (e) => {
  const d = e.target.closest("button")?.dataset.d;
  if (!d || G !== snake) return;
  e.preventDefault();
  if (snake.waiting) { snake.waiting = false; }
  if (snake.over) { begin(snake); snake.waiting = false; }
  snake.dir4(d);
});

function begin(g) {
  G = g;
  for (const x of GAMES) x.tab.setAttribute("aria-selected", String(x === g));
  best = store.get(g.id); setScore(0);
  g.init(); g.waiting = true;
  pad.classList.toggle("on", TOUCH && !!g.pad);
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
begin(cut);
requestAnimationFrame(frame);
// For automated tests only: /play/?test exposes the games.
if (new URLSearchParams(location.search).has("test")) window.__play = { GAMES, begin, ptr, get G() { return G; }, get score() { return score; } };
