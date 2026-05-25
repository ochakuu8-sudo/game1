const DPR_MAX = 2;
const WORLD = { w: 500, h: 800 };
const BALL_RADIUS = 12;
const GRID = { cols: 12, rows: 12, cell: 30, left: 70, top: 120 };
const PLAYFIELD = { left: 30, right: 470, top: 70, bottom: 780 };

const PHYSICS = {
  gravity: 930,
  airDrag: 0.9979,
  rollingFriction: 0.9982,
  wallBounce: 0.58,
  railBounce: 0.08,
  buildingBounce: 0.24,
  flipperBounce: 0.08,
  flipperFriction: 0.985,
  railFriction: 0.996,
  maxBallSpeed: 900,
  maxUpwardBallSpeed: 1180,
  minFlipperBallSpeed: 390,
  spinDamping: 0.988,
  rollingSpinGain: 0.42,
};

const BLOCK_TYPES = {
  dirt: { hp: 1, value: 1, color: '#7b5a38' }, stone: { hp: 2, value: 2, color: '#6f727a' },
  copper: { hp: 2, value: 10, color: '#b46c3f' }, iron: { hp: 3, value: 25, color: '#8d8e96' },
  gold: { hp: 4, value: 80, color: '#d2ab2e' }, diamond: { hp: 5, value: 250, color: '#55d5ff' },
  bedrock: { hp: 9999, value: 0, color: '#2b2a30' },
};

const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const wrap = document.getElementById('wrap');
const ui = uiCanvas.getContext('2d');
const gl = glCanvas.getContext('webgl', { antialias: true, alpha: false });
if (!gl) throw new Error('WebGL unavailable');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (min, max) => min + Math.random() * (max - min);
const vlen = (x, y) => Math.hypot(x, y);

const sound = { ctx: null, enabled: false, master: null, last: Object.create(null) };
function ensureAudio() { if (sound.ctx) return sound.ctx; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; sound.ctx = new AC(); sound.master = sound.ctx.createGain(); sound.master.gain.value = 0.9; sound.master.connect(sound.ctx.destination); return sound.ctx; }
function tone(freq, to, duration, gain, type = 'triangle') { const ctx = sound.ctx; if (!ctx) return; const o = ctx.createOscillator(); const g = ctx.createGain(); const t = ctx.currentTime; o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + duration); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + duration); o.connect(g); g.connect(sound.master); o.start(); o.stop(t + duration + 0.02); }
function playSfx(kind) { if (!sound.enabled) return; const now = sound.ctx.currentTime; if (now - (sound.last[kind] || -10) < 0.05) return; sound.last[kind] = now; if (kind === 'hitDirt') tone(260, 180, 0.06, 0.03); else if (kind === 'hitStone') tone(420, 300, 0.08, 0.04, 'square'); else if (kind === 'mineOre') { tone(760, 980, 0.07, 0.05); tone(980, 1180, 0.08, 0.03); } else if (kind === 'mineGold') { tone(680, 980, 0.1, 0.05); tone(980, 1460, 0.12, 0.04); } else if (kind === 'mineDiamond') { tone(680, 1600, 0.16, 0.07); tone(1200, 2200, 0.2, 0.05, 'sine'); } else if (kind === 'money') tone(880, 1240, 0.05, 0.03, 'sine'); else if (kind === 'scrollDepth') tone(340, 760, 0.14, 0.04); else if (kind === 'upgrade') tone(620, 1220, 0.14, 0.05); else if (kind === 'launch') tone(140, 520, 0.16, 0.05); else if (kind === 'flipper') tone(360, 200, 0.04, 0.03, 'square'); }

class RuntimeAtlas {
  constructor(glRef) { this.gl = glRef; this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = 512; this.ctx = this.canvas.getContext('2d'); this.tex = glRef.createTexture(); glRef.bindTexture(glRef.TEXTURE_2D, this.tex); glRef.texParameteri(glRef.TEXTURE_2D, glRef.TEXTURE_MIN_FILTER, glRef.LINEAR); glRef.texParameteri(glRef.TEXTURE_2D, glRef.TEXTURE_MAG_FILTER, glRef.LINEAR); glRef.texImage2D(glRef.TEXTURE_2D, 0, glRef.RGBA, 512, 512, 0, glRef.RGBA, glRef.UNSIGNED_BYTE, null); this.map = new Map(); this.cx = 2; this.cy = 2; this.rowH = 0; }
  pack(name, w, h, draw) {
    if (this.map.has(name)) return this.map.get(name);
    if (this.cx + w + 2 > 510) { this.cx = 2; this.cy += this.rowH + 2; this.rowH = 0; }
    draw(this.ctx, this.cx, this.cy, w, h);
    const e = { u0: this.cx / 512, v0: this.cy / 512, u1: (this.cx + w) / 512, v1: (this.cy + h) / 512, w, h };
    this.map.set(name, e); this.cx += w + 2; this.rowH = Math.max(this.rowH, h); return e;
  }
  upload() { this.gl.bindTexture(this.gl.TEXTURE_2D, this.tex); this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.canvas); }
}

const vs = 'attribute vec2 p;attribute vec2 uv;varying vec2 v;uniform vec2 r;void main(){vec2 q=(p/r)*2.0-1.0;gl_Position=vec4(q.x,-q.y,0.0,1.0);v=uv;}';
const fs = 'precision mediump float;varying vec2 v;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,v);}';
function program(glRef, vsSrc, fsSrc) { const sh = (t, s) => { const x = glRef.createShader(t); glRef.shaderSource(x, s); glRef.compileShader(x); return x; }; const p = glRef.createProgram(); glRef.attachShader(p, sh(glRef.VERTEX_SHADER, vsSrc)); glRef.attachShader(p, sh(glRef.FRAGMENT_SHADER, fsSrc)); glRef.linkProgram(p); return p; }

const atlas = new RuntimeAtlas(gl);
const sprites = {
  ball: atlas.pack('ball', 32, 32, (c, x, y) => { c.fillStyle = '#d9f2ff'; c.beginPath(); c.arc(x + 16, y + 16, 11, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#6da7c2'; c.stroke(); }),
  flipper: atlas.pack('flipper', 96, 24, (c, x, y, w, h) => { c.fillStyle = '#5faecf'; c.fillRect(x, y + 4, w, h - 8); c.fillStyle = '#bfe6ff'; c.fillRect(x, y + 4, w - 12, 6); c.fillStyle = '#244154'; c.beginPath(); c.arc(x + 12, y + h / 2, 9, 0, Math.PI * 2); c.fill(); }),
  rail: atlas.pack('rail', 30, 30, (c, x, y) => { c.fillStyle = '#3a4652'; c.fillRect(x, y, 30, 30); c.strokeStyle = '#6f8194'; c.strokeRect(x + 1, y + 1, 28, 28); }),
};
for (const [k, v] of Object.entries(BLOCK_TYPES)) sprites[`block_${k}`] = atlas.pack(`block_${k}`, 30, 30, (c, x, y) => { c.fillStyle = v.color; c.fillRect(x, y, 30, 30); c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x + 2, y + 2, 26, 8); });
atlas.upload();

const prog = program(gl, vs, fs); const buf = gl.createBuffer();
const state = { money: 0, miningPower: 1, oreMultiplier: 1, blocksMined: 0, depthLevel: 0, upgradeCost: 100, blocks: [], particles: [], floats: [], shaker: 0,
  ball: { x: 442, y: 710, vx: 0, vy: 0, spin: 0 }, charge: 0, keys: new Set(), scrollAnim: null,
  flippers: [
    { side: -1, px: 188, py: 728, len: 92, r: 9, rest: 0.5, active: -0.72, angle: 0.5, angVel: 0, key: ['arrowleft', 'a'] },
    { side: 1, px: 312, py: 728, len: 92, r: 9, rest: Math.PI - 0.5, active: Math.PI + 0.72, angle: Math.PI - 0.5, angVel: 0, key: ['arrowright', 'd'] },
  ] };

function pickBlockType(depth) { const r = Math.random() * 100; const w = depth < 5 ? [['dirt', 70], ['stone', 25], ['copper', 5]] : depth < 15 ? [['dirt', 35], ['stone', 40], ['copper', 18], ['iron', 7]] : depth < 30 ? [['stone', 45], ['copper', 20], ['iron', 25], ['gold', 10]] : [['stone', 35], ['iron', 30], ['gold', 25], ['diamond', 8], ['bedrock', 2]]; let sum = 0; for (const [t, n] of w) { sum += n; if (r <= sum) return t; } return w[w.length - 1][0]; }
function createBlock(col, row, depth) { const type = pickBlockType(depth); const base = BLOCK_TYPES[type]; const hpScale = 1 + Math.floor(depth / 10) * 0.2; const valScale = 1 + depth * 0.03; const hp = type === 'bedrock' ? base.hp : Math.max(1, Math.floor(base.hp * hpScale)); const value = Math.floor(base.value * valScale); return { type, hp, maxHp: hp, value, broken: false, depth, x: GRID.left + col * GRID.cell, y: GRID.top + row * GRID.cell, col, row }; }
const initBlocks = () => { state.blocks = []; for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) state.blocks.push(createBlock(c, r, state.depthLevel + r)); };
const spawnFloat = (text, x, y, color = '#fff2a2') => state.floats.push({ text, x, y, vy: -45, life: 0.8, color });
const spawnDust = (x, y, color, n = 8) => { for (let i = 0; i < n; i++) state.particles.push({ x, y, vx: rand(-80, 80), vy: rand(-120, -15), life: rand(0.3, 0.8), color }); };
function mineBlock(b) { if (b.broken || b.type === 'bedrock') return; b.hp -= state.miningPower; state.shaker = Math.max(state.shaker, 3); spawnDust(b.x + GRID.cell / 2, b.y + GRID.cell / 2, '#7e644a', 4); playSfx(b.type === 'dirt' ? 'hitDirt' : 'hitStone'); if (b.hp <= 0) { b.broken = true; const gain = Math.floor(b.value * state.oreMultiplier); state.money += gain; state.blocksMined += 1; spawnDust(b.x + GRID.cell / 2, b.y + GRID.cell / 2, BLOCK_TYPES[b.type].color, b.type === 'diamond' ? 24 : 12); if (b.type !== 'dirt' && b.type !== 'stone') spawnFloat(`+$${gain}`, b.x + 6, b.y, '#ffe27b'); playSfx(b.type === 'diamond' ? 'mineDiamond' : b.type === 'gold' ? 'mineGold' : 'mineOre'); playSfx('money'); } }

const shouldScrollMine = () => { const rows = [GRID.rows - 1, GRID.rows - 2, GRID.rows - 3]; const bottom = state.blocks.filter((b) => rows.includes(b.row)); return bottom.filter((b) => b.broken).length / bottom.length > 0.58; };
function scrollMineForward(rows = 2) { if (state.scrollAnim) return; state.depthLevel += rows; const amount = rows * GRID.cell; state.scrollAnim = { t: 0, dur: 0.45, amount }; for (const b of state.blocks) b.targetY = b.y - amount; spawnFloat(`DEPTH +${rows}m`, 190, 220, '#9be7ff'); playSfx('scrollDepth'); }
function finalizeScroll(rows = 2) { for (const b of state.blocks) { b.y -= rows * GRID.cell; b.row -= rows; delete b.targetY; } state.blocks = state.blocks.filter((b) => b.row >= 0); for (let r = GRID.rows - rows; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) state.blocks.push(createBlock(c, r, state.depthLevel + r)); }

function pointSeg(px, py, ax, ay, bx, by) { const abx = bx - ax; const aby = by - ay; const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1), 0, 1); return { x: ax + abx * t, y: ay + aby * t, t }; }
function collideFlipper(f, b) {
  const tx = f.px + Math.cos(f.angle) * f.len; const ty = f.py + Math.sin(f.angle) * f.len;
  const q = pointSeg(b.x, b.y, f.px, f.py, tx, ty); const dx = b.x - q.x; const dy = b.y - q.y; const dist = vlen(dx, dy);
  const reach = BALL_RADIUS + f.r;
  if (dist >= reach) return;
  const nx = dist > 0.0001 ? dx / dist : 0; const ny = dist > 0.0001 ? dy / dist : -1;
  const depth = reach - dist + 0.2; b.x += nx * depth; b.y += ny * depth;
  const rx = q.x - f.px; const ry = q.y - f.py;
  const vx = -f.angVel * ry; const vy = f.angVel * rx;
  const rvx = b.vx - vx; const rvy = b.vy - vy;
  const velN = rvx * nx + rvy * ny;
  if (velN < 0) { b.vx -= (1 + PHYSICS.wallBounce + PHYSICS.flipperBounce) * velN * nx; b.vy -= (1 + PHYSICS.wallBounce + PHYSICS.flipperBounce) * velN * ny; }
  const tipBoost = 0.35 + q.t * 0.95;
  b.vx += vx * tipBoost; b.vy += vy * tipBoost;
  const sp = vlen(b.vx, b.vy);
  if (sp < PHYSICS.minFlipperBallSpeed) { const s = PHYSICS.minFlipperBallSpeed / Math.max(1, sp); b.vx *= s; b.vy *= s; }
}
function updateFlippers(dt) {
  for (const f of state.flippers) {
    const active = f.key.some((k) => state.keys.has(k));
    const target = active ? f.active : f.rest;
    const accel = active ? 55 : 42;
    const d = target - f.angle;
    f.angVel += d * accel * dt;
    f.angVel *= active ? 0.84 : 0.78;
    f.angle += f.angVel * dt;
    if (Math.abs(d) < 0.03) f.angle = target;
    if (active && Math.abs(d) > 0.16 && Math.abs(f.angVel) > 4.0) playSfx('flipper');
  }
}

function reset() { state.money = 0; state.miningPower = 1; state.oreMultiplier = 1; state.blocksMined = 0; state.depthLevel = 0; state.upgradeCost = 100; state.ball = { x: 442, y: 710, vx: 0, vy: 0, spin: 0 }; state.particles = []; state.floats = []; state.scrollAnim = null; state.flippers[0].angle = state.flippers[0].rest; state.flippers[1].angle = state.flippers[1].rest; initBlocks(); }
reset();

window.addEventListener('keydown', (e) => { ensureAudio(); sound.enabled = true; if (sound.ctx?.state === 'suspended') sound.ctx.resume(); state.keys.add(e.key.toLowerCase()); if (e.key === ' ') e.preventDefault(); if (e.key.toLowerCase() === 'r') reset(); if (e.key.toLowerCase() === 'u' && state.money >= state.upgradeCost) { state.money -= state.upgradeCost; state.miningPower += 1; state.upgradeCost = Math.floor(state.upgradeCost * 1.6); playSfx('upgrade'); } });
window.addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()));

function update(dt) {
  updateFlippers(dt);
  if (state.keys.has(' ')) state.charge = clamp(state.charge + dt * 1.4, 0, 1);
  else if (state.charge > 0) { state.ball.vy = -420 - state.charge * 520; state.ball.vx = -120 * state.charge; state.charge = 0; playSfx('launch'); }

  const b = state.ball;
  b.vy += PHYSICS.gravity * dt; b.vx *= PHYSICS.airDrag; b.vy *= PHYSICS.airDrag; b.spin *= PHYSICS.spinDamping;
  b.x += b.vx * dt; b.y += b.vy * dt;

  if (b.x < PLAYFIELD.left + BALL_RADIUS) { b.x = PLAYFIELD.left + BALL_RADIUS; b.vx = Math.abs(b.vx) * PHYSICS.wallBounce; b.vy *= PHYSICS.railFriction; }
  if (b.x > PLAYFIELD.right - BALL_RADIUS) { b.x = PLAYFIELD.right - BALL_RADIUS; b.vx = -Math.abs(b.vx) * PHYSICS.wallBounce; b.vy *= PHYSICS.railFriction; }
  if (b.y < PLAYFIELD.top + BALL_RADIUS) { b.y = PLAYFIELD.top + BALL_RADIUS; b.vy = Math.abs(b.vy) * PHYSICS.wallBounce; }
  if (b.y > PLAYFIELD.bottom - BALL_RADIUS) { b.y = PLAYFIELD.bottom - BALL_RADIUS; b.vy = -Math.abs(b.vy) * PHYSICS.wallBounce; b.vx *= PHYSICS.rollingFriction; b.spin += b.vx * 0.004 * PHYSICS.rollingSpinGain; }

  // angled guide rails
  const rails = [[58, 660, 170, 748], [442, 660, 330, 748]];
  for (const r of rails) {
    const q = pointSeg(b.x, b.y, r[0], r[1], r[2], r[3]); const dx = b.x - q.x; const dy = b.y - q.y; const dist = vlen(dx, dy);
    if (dist < BALL_RADIUS + 2) { const nx = dx / (dist || 1); const ny = dy / (dist || 1); const pen = BALL_RADIUS + 2 - dist; b.x += nx * pen; b.y += ny * pen; const vn = b.vx * nx + b.vy * ny; if (vn < 0) { b.vx -= (1 + PHYSICS.railBounce) * vn * nx; b.vy -= (1 + PHYSICS.railBounce) * vn * ny; b.vx *= PHYSICS.railFriction; b.vy *= PHYSICS.railFriction; } }
  }

  for (const f of state.flippers) collideFlipper(f, b);

  for (const block of state.blocks) {
    if (block.broken) continue;
    const nx = clamp(b.x, block.x, block.x + GRID.cell); const ny = clamp(b.y, block.y, block.y + GRID.cell);
    const dx = b.x - nx; const dy = b.y - ny;
    if (dx * dx + dy * dy < BALL_RADIUS * BALL_RADIUS) {
      mineBlock(block);
      const l = Math.hypot(dx, dy) || 1;
      const nxx = dx / l; const nyy = dy / l;
      b.x = nx + nxx * (BALL_RADIUS + 0.5); b.y = ny + nyy * (BALL_RADIUS + 0.5);
      const dot = b.vx * nxx + b.vy * nyy;
      if (dot < 0) { b.vx -= (1 + PHYSICS.buildingBounce) * dot * nxx; b.vy -= (1 + PHYSICS.buildingBounce) * dot * nyy; }
    }
  }

  let sp = vlen(b.vx, b.vy); if (sp > PHYSICS.maxBallSpeed) { const s = PHYSICS.maxBallSpeed / sp; b.vx *= s; b.vy *= s; }
  if (b.vy < -PHYSICS.maxUpwardBallSpeed) b.vy = -PHYSICS.maxUpwardBallSpeed;

  if (shouldScrollMine()) scrollMineForward(2);
  if (state.scrollAnim) { state.scrollAnim.t += dt; const p = clamp(state.scrollAnim.t / state.scrollAnim.dur, 0, 1); for (const block of state.blocks) block.y = (block.targetY + state.scrollAnim.amount) - state.scrollAnim.amount * p; if (p >= 1) { finalizeScroll(2); state.scrollAnim = null; } }

  for (const p of state.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt; p.life -= dt; }
  state.particles = state.particles.filter((p) => p.life > 0);
  for (const f of state.floats) { f.y += f.vy * dt; f.life -= dt; }
  state.floats = state.floats.filter((f) => f.life > 0);
}

function pushSprite(arr, e, x, y, w, h, rot = 0, ox = 0, oy = 0) {
  const c = Math.cos(rot); const s = Math.sin(rot);
  const pts = [[-ox, -oy], [w - ox, -oy], [w - ox, h - oy], [-ox, h - oy]];
  const tr = pts.map(([px, py]) => [x + px * c - py * s, y + px * s + py * c]);
  arr.push(tr[0][0], tr[0][1], e.u0, e.v0, tr[1][0], tr[1][1], e.u1, e.v0, tr[2][0], tr[2][1], e.u1, e.v1, tr[0][0], tr[0][1], e.u0, e.v0, tr[2][0], tr[2][1], e.u1, e.v1, tr[3][0], tr[3][1], e.u0, e.v1);
}
function drawGl() {
  gl.viewport(0, 0, glCanvas.width, glCanvas.height); const depthShade = clamp(0.17 + state.depthLevel * 0.01, 0.17, 0.42);
  gl.clearColor(0.08, 0.10, depthShade, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const verts = [];
  for (let y = PLAYFIELD.top; y < PLAYFIELD.bottom; y += 30) { pushSprite(verts, sprites.rail, PLAYFIELD.left, y, 30, 30); pushSprite(verts, sprites.rail, PLAYFIELD.right - 30, y, 30, 30); }
  for (const block of state.blocks) if (!block.broken) pushSprite(verts, sprites[`block_${block.type}`], block.x, block.y, GRID.cell - 1, GRID.cell - 1);
  for (const f of state.flippers) pushSprite(verts, sprites.flipper, f.px, f.py - 12, f.len, 24, f.angle, 0, 12);
  pushSprite(verts, sprites.ball, state.ball.x - BALL_RADIUS, state.ball.y - BALL_RADIUS, BALL_RADIUS * 2, BALL_RADIUS * 2);

  gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
  const ap = gl.getAttribLocation(prog, 'p'); const au = gl.getAttribLocation(prog, 'uv');
  gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(au); gl.vertexAttribPointer(au, 2, gl.FLOAT, false, 16, 8);
  gl.uniform2f(gl.getUniformLocation(prog, 'r'), glCanvas.width, glCanvas.height);
  gl.bindTexture(gl.TEXTURE_2D, atlas.tex); gl.drawArrays(gl.TRIANGLES, 0, verts.length / 4);
}

function drawUi() {
  const w = uiCanvas.width; const h = uiCanvas.height; ui.clearRect(0, 0, w, h); ui.save(); const shake = state.shaker > 0 ? rand(-state.shaker, state.shaker) : 0; state.shaker *= 0.85; ui.translate(shake, shake);
  for (const p of state.particles) { ui.globalAlpha = clamp(p.life, 0, 1); ui.fillStyle = p.color; ui.fillRect(p.x, p.y, 3, 3); }
  ui.globalAlpha = 1; for (const f of state.floats) { ui.globalAlpha = clamp(f.life, 0, 1); ui.fillStyle = f.color; ui.font = 'bold 18px monospace'; ui.fillText(f.text, f.x, f.y); }
  ui.globalAlpha = 1; ui.strokeStyle = '#88a7bd'; ui.lineWidth = 5; ui.strokeRect(PLAYFIELD.left, PLAYFIELD.top, PLAYFIELD.right - PLAYFIELD.left, PLAYFIELD.bottom - PLAYFIELD.top);
  ui.fillStyle = 'rgba(180,220,255,0.5)'; ui.fillRect(430, 730 - 80 * state.charge, 22, 80 * state.charge);
  ui.fillStyle = 'rgba(13,18,22,0.8)'; ui.fillRect(18, 12, 465, 92); ui.fillStyle = '#d9f2ff'; ui.font = 'bold 20px monospace'; ui.fillText(`MONEY $${state.money.toLocaleString()}`, 28, 38);
  ui.font = 'bold 16px monospace'; ui.fillText(`POWER ${state.miningPower}`, 28, 62); ui.fillText(`DEPTH ${state.depthLevel}m`, 170, 62); ui.fillText(`MINED ${state.blocksMined}`, 300, 62); ui.fillText(`UPGRADE U: $${state.upgradeCost.toLocaleString()}`, 28, 86);
  ui.font = '14px monospace'; ui.fillText('←/A  →/D  SPACE  U  R', 292, 86); ui.restore();
}

function resize() { const rect = wrap.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX); glCanvas.width = Math.floor(rect.width * dpr); glCanvas.height = Math.floor(rect.height * dpr); uiCanvas.width = glCanvas.width; uiCanvas.height = glCanvas.height; const sx = glCanvas.width / WORLD.w; const sy = glCanvas.height / WORLD.h; ui.setTransform(sx, 0, 0, sy, 0, 0); }
window.addEventListener('resize', resize); resize();

let last = performance.now();
function tick(now) { const dt = Math.min(0.033, (now - last) / 1000); last = now; update(dt); drawGl(); drawUi(); requestAnimationFrame(tick); }
requestAnimationFrame(tick);
