const DPR_MAX = 2;
const WORLD = { w: 500, h: 800 };
const BALL_RADIUS = 16;
const GRID = { cols: 12, rows: 12, cell: 30, left: 70, top: 120 };
const PLAYFIELD = { left: 30, right: 470, top: 70, bottom: 780 };

const BLOCK_TYPES = {
  dirt: { hp: 1, value: 1, color: '#7b5a38' },
  stone: { hp: 2, value: 2, color: '#6f727a' },
  copper: { hp: 2, value: 10, color: '#b46c3f' },
  iron: { hp: 3, value: 25, color: '#8d8e96' },
  gold: { hp: 4, value: 80, color: '#d2ab2e' },
  diamond: { hp: 5, value: 250, color: '#55d5ff' },
  bedrock: { hp: 9999, value: 0, color: '#2b2a30' },
};

const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const wrap = document.getElementById('wrap');
const ui = uiCanvas.getContext('2d');
const gl = glCanvas.getContext('webgl', { antialias: true, alpha: false });
if (!gl) throw new Error('WebGL unavailable');

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(min, max) { return min + Math.random() * (max - min); }

const sound = { ctx: null, enabled: false, master: null, last: Object.create(null) };
function ensureAudio() {
  if (sound.ctx) return sound.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  sound.ctx = new AC();
  sound.master = sound.ctx.createGain();
  sound.master.gain.value = 0.9;
  sound.master.connect(sound.ctx.destination);
  return sound.ctx;
}
function tone(freq, to, duration, gain, type = 'triangle') {
  const ctx = sound.ctx; if (!ctx) return;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  const t = ctx.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + duration);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  o.connect(g); g.connect(sound.master); o.start(); o.stop(t + duration + 0.02);
}
function playSfx(kind) {
  if (!sound.enabled) return;
  const now = sound.ctx.currentTime;
  if (now - (sound.last[kind] || -10) < 0.05) return;
  sound.last[kind] = now;
  if (kind === 'hitDirt') tone(260, 180, 0.06, 0.03);
  else if (kind === 'hitStone') tone(420, 300, 0.08, 0.04, 'square');
  else if (kind === 'mineOre') { tone(760, 980, 0.07, 0.05); tone(980, 1180, 0.08, 0.03); }
  else if (kind === 'mineGold') { tone(680, 980, 0.1, 0.05); tone(980, 1460, 0.12, 0.04); }
  else if (kind === 'mineDiamond') { tone(680, 1600, 0.16, 0.07); tone(1200, 2200, 0.2, 0.05, 'sine'); }
  else if (kind === 'money') tone(880, 1240, 0.05, 0.03, 'sine');
  else if (kind === 'scrollDepth') tone(340, 760, 0.14, 0.04);
  else if (kind === 'upgrade') tone(620, 1220, 0.14, 0.05);
  else if (kind === 'launch') tone(140, 520, 0.16, 0.05);
  else if (kind === 'flipper') tone(360, 200, 0.04, 0.03, 'square');
}

class RuntimeAtlas { constructor(glRef) { this.gl = glRef; this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = 256; this.ctx = this.canvas.getContext('2d'); this.tex = glRef.createTexture(); glRef.bindTexture(glRef.TEXTURE_2D, this.tex); glRef.texParameteri(glRef.TEXTURE_2D, glRef.TEXTURE_MIN_FILTER, glRef.LINEAR); glRef.texParameteri(glRef.TEXTURE_2D, glRef.TEXTURE_MAG_FILTER, glRef.LINEAR); glRef.texImage2D(glRef.TEXTURE_2D, 0, glRef.RGBA, 256, 256, 0, glRef.RGBA, glRef.UNSIGNED_BYTE, null); this.map = new Map(); this.x = 2; }
  pack(name, draw) { if (this.map.has(name)) return this.map.get(name); draw(this.ctx, this.x, 2); const e = { u0: this.x / 256, v0: 2 / 256, u1: (this.x + 42) / 256, v1: 44 / 256, w: 42, h: 42 }; this.x += 44; this.map.set(name, e); return e; }
  upload() { this.gl.bindTexture(this.gl.TEXTURE_2D, this.tex); this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.canvas); }
}

const vs = 'attribute vec2 p;attribute vec2 uv;varying vec2 v;uniform vec2 r;void main(){vec2 q=(p/r)*2.0-1.0;gl_Position=vec4(q.x,-q.y,0.0,1.0);v=uv;}';
const fs = 'precision mediump float;varying vec2 v;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,v);}';
function program(glRef, vsSrc, fsSrc) { const sh = (t, s) => { const x = glRef.createShader(t); glRef.shaderSource(x, s); glRef.compileShader(x); return x; }; const p = glRef.createProgram(); glRef.attachShader(p, sh(glRef.VERTEX_SHADER, vsSrc)); glRef.attachShader(p, sh(glRef.FRAGMENT_SHADER, fsSrc)); glRef.linkProgram(p); return p; }

const atlas = new RuntimeAtlas(gl);
const sprites = {
  ball: atlas.pack('ball', (c, x, y) => { c.fillStyle = '#d9f2ff'; c.beginPath(); c.arc(x + 21, y + 21, 15, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#6da7c2'; c.stroke(); }),
};
atlas.upload();
const prog = program(gl, vs, fs); const buf = gl.createBuffer();

const state = {
  money: 0, miningPower: 1, oreMultiplier: 1, blocksMined: 0, depthLevel: 0, upgradeCost: 100,
  blocks: [], particles: [], floats: [], shaker: 0,
  ball: { x: 442, y: 710, vx: 0, vy: 0 },
  charge: 0, keys: new Set(),
  fl: 0, fr: 0,
  scrollAnim: null,
};

function pickBlockType(depth) {
  const r = Math.random() * 100;
  const w = depth < 5 ? [['dirt',70],['stone',25],['copper',5]] : depth < 15 ? [['dirt',35],['stone',40],['copper',18],['iron',7]] : depth < 30 ? [['stone',45],['copper',20],['iron',25],['gold',10]] : [['stone',35],['iron',30],['gold',25],['diamond',8],['bedrock',2]];
  let sum = 0; for (const [t, n] of w) { sum += n; if (r <= sum) return t; } return w[w.length - 1][0];
}

function createBlock(col, row, depth) {
  const type = pickBlockType(depth);
  const base = BLOCK_TYPES[type];
  const hpScale = 1 + Math.floor(depth / 10) * 0.2;
  const valScale = 1 + depth * 0.03;
  const hp = type === 'bedrock' ? base.hp : Math.max(1, Math.floor(base.hp * hpScale));
  const value = Math.floor(base.value * valScale);
  return { type, hp, maxHp: hp, value, broken: false, depth, x: GRID.left + col * GRID.cell, y: GRID.top + row * GRID.cell, col, row };
}

function initBlocks() {
  state.blocks = [];
  for (let r = 0; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) state.blocks.push(createBlock(c, r, state.depthLevel + r));
}

function spawnFloat(text, x, y, color = '#fff2a2') { state.floats.push({ text, x, y, vy: -45, life: 0.8, color }); }
function spawnDust(x, y, color, n = 8) { for (let i = 0; i < n; i++) state.particles.push({ x, y, vx: rand(-80, 80), vy: rand(-120, -15), life: rand(0.3, 0.8), color }); }

function mineBlock(b) {
  if (b.broken || b.type === 'bedrock') return;
  b.hp -= state.miningPower;
  state.shaker = Math.max(state.shaker, 3);
  spawnDust(b.x + GRID.cell / 2, b.y + GRID.cell / 2, '#7e644a', 4);
  playSfx(b.type === 'dirt' ? 'hitDirt' : 'hitStone');
  if (b.hp <= 0) {
    b.broken = true;
    const gain = Math.floor(b.value * state.oreMultiplier);
    state.money += gain; state.blocksMined += 1;
    spawnDust(b.x + GRID.cell / 2, b.y + GRID.cell / 2, BLOCK_TYPES[b.type].color, b.type === 'diamond' ? 24 : 12);
    if (b.type !== 'dirt' && b.type !== 'stone') spawnFloat(`+$${gain}`, b.x + 6, b.y, '#ffe27b');
    playSfx(b.type === 'diamond' ? 'mineDiamond' : b.type === 'gold' ? 'mineGold' : 'mineOre');
    playSfx('money');
  }
}

function shouldScrollMine() {
  const rows = [GRID.rows - 1, GRID.rows - 2, GRID.rows - 3];
  const bottom = state.blocks.filter((b) => rows.includes(b.row));
  const brokenRatio = bottom.filter((b) => b.broken).length / bottom.length;
  return brokenRatio > 0.58;
}
function scrollMineForward(rows = 2) {
  if (state.scrollAnim) return;
  state.depthLevel += rows;
  const amount = rows * GRID.cell;
  state.scrollAnim = { t: 0, dur: 0.45, amount };
  for (const b of state.blocks) b.targetY = b.y - amount;
  spawnFloat(`DEPTH +${rows}m`, 190, 220, '#9be7ff');
  playSfx('scrollDepth');
}

function finalizeScroll(rows = 2) {
  for (const b of state.blocks) { b.y -= rows * GRID.cell; b.row -= rows; delete b.targetY; }
  state.blocks = state.blocks.filter((b) => b.row >= 0);
  for (let r = GRID.rows - rows; r < GRID.rows; r++) for (let c = 0; c < GRID.cols; c++) state.blocks.push(createBlock(c, r, state.depthLevel + r));
}

function reset() {
  state.money = 0; state.miningPower = 1; state.oreMultiplier = 1; state.blocksMined = 0; state.depthLevel = 0; state.upgradeCost = 100;
  state.ball = { x: 442, y: 710, vx: 0, vy: 0 }; state.particles = []; state.floats = []; state.scrollAnim = null; initBlocks();
}
reset();

window.addEventListener('keydown', (e) => { ensureAudio(); sound.enabled = true; if (sound.ctx?.state === 'suspended') sound.ctx.resume(); state.keys.add(e.key.toLowerCase()); if (e.key === ' ') e.preventDefault(); if (e.key.toLowerCase() === 'r') reset(); if (e.key.toLowerCase() === 'u' && state.money >= state.upgradeCost) { state.money -= state.upgradeCost; state.miningPower += 1; state.upgradeCost = Math.floor(state.upgradeCost * 1.6); playSfx('upgrade'); } });
window.addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()));

function update(dt) {
  state.fl = state.keys.has('arrowleft') || state.keys.has('a') ? 1 : 0;
  state.fr = state.keys.has('arrowright') || state.keys.has('d') ? 1 : 0;

  if (state.keys.has(' ')) state.charge = clamp(state.charge + dt * 1.4, 0, 1);
  else if (state.charge > 0) { state.ball.vy = -420 - state.charge * 520; state.ball.vx = -120 * state.charge; state.charge = 0; playSfx('launch'); }

  const b = state.ball;
  b.vy += 930 * dt; b.vx *= 0.998; b.vy *= 0.998;
  b.x += b.vx * dt; b.y += b.vy * dt;
  if (b.x < PLAYFIELD.left + BALL_RADIUS) { b.x = PLAYFIELD.left + BALL_RADIUS; b.vx *= -0.7; }
  if (b.x > PLAYFIELD.right - BALL_RADIUS) { b.x = PLAYFIELD.right - BALL_RADIUS; b.vx *= -0.7; }
  if (b.y < PLAYFIELD.top + BALL_RADIUS) { b.y = PLAYFIELD.top + BALL_RADIUS; b.vy *= -0.7; }
  if (b.y > PLAYFIELD.bottom - BALL_RADIUS) { b.y = PLAYFIELD.bottom - BALL_RADIUS; b.vy *= -0.75; }

  // flippers
  if (b.y > 640 && b.y < 760) {
    if (state.fl && b.x < 240) { b.vy = Math.min(b.vy, -340); b.vx -= 140; playSfx('flipper'); }
    if (state.fr && b.x > 260) { b.vy = Math.min(b.vy, -340); b.vx += 140; playSfx('flipper'); }
  }

  for (const block of state.blocks) {
    if (block.broken) continue;
    const nx = clamp(b.x, block.x, block.x + GRID.cell);
    const ny = clamp(b.y, block.y, block.y + GRID.cell);
    const dx = b.x - nx; const dy = b.y - ny;
    if (dx * dx + dy * dy < BALL_RADIUS * BALL_RADIUS) {
      mineBlock(block);
      const l = Math.hypot(dx, dy) || 1;
      b.x = nx + (dx / l) * (BALL_RADIUS + 0.5);
      b.y = ny + (dy / l) * (BALL_RADIUS + 0.5);
      const dot = b.vx * (dx / l) + b.vy * (dy / l);
      b.vx -= 1.6 * dot * (dx / l); b.vy -= 1.6 * dot * (dy / l);
    }
  }

  if (shouldScrollMine()) scrollMineForward(2);
  if (state.scrollAnim) {
    state.scrollAnim.t += dt;
    const p = clamp(state.scrollAnim.t / state.scrollAnim.dur, 0, 1);
    for (const block of state.blocks) block.y = (block.targetY + state.scrollAnim.amount) - state.scrollAnim.amount * p;
    if (p >= 1) { finalizeScroll(2); state.scrollAnim = null; }
  }

  for (const p of state.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt; p.life -= dt; }
  state.particles = state.particles.filter((p) => p.life > 0);
  for (const f of state.floats) { f.y += f.vy * dt; f.life -= dt; }
  state.floats = state.floats.filter((f) => f.life > 0);
}

function drawGl() {
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
  const depthShade = clamp(0.17 + state.depthLevel * 0.01, 0.17, 0.42);
  gl.clearColor(0.08, 0.10, depthShade, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const e = sprites.ball;
  const w = BALL_RADIUS * 2;
  const x = state.ball.x - BALL_RADIUS; const y = state.ball.y - BALL_RADIUS;
  const verts = new Float32Array([x,y,e.u0,e.v0, x+w,y,e.u1,e.v0, x+w,y+w,e.u1,e.v1, x,y,e.u0,e.v0, x+w,y+w,e.u1,e.v1, x,y+w,e.u0,e.v1]);
  gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  const ap = gl.getAttribLocation(prog, 'p'); const au = gl.getAttribLocation(prog, 'uv');
  gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(au); gl.vertexAttribPointer(au, 2, gl.FLOAT, false, 16, 8);
  gl.uniform2f(gl.getUniformLocation(prog, 'r'), glCanvas.width, glCanvas.height);
  gl.bindTexture(gl.TEXTURE_2D, atlas.tex); gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function drawUi() {
  const w = uiCanvas.width; const h = uiCanvas.height;
  ui.clearRect(0, 0, w, h);
  ui.save();
  const shake = state.shaker > 0 ? rand(-state.shaker, state.shaker) : 0; state.shaker *= 0.85;
  ui.translate(shake, shake);
  ui.fillStyle = '#1a1f25'; ui.fillRect(0, 0, w, h);
  ui.fillStyle = '#2e343b'; ui.fillRect(PLAYFIELD.left, PLAYFIELD.top, PLAYFIELD.right - PLAYFIELD.left, PLAYFIELD.bottom - PLAYFIELD.top);

  for (const b of state.blocks) {
    ui.fillStyle = b.broken ? '#1b2126' : BLOCK_TYPES[b.type].color;
    ui.fillRect(b.x, b.y, GRID.cell - 1, GRID.cell - 1);
    if (!b.broken && b.type !== 'bedrock' && b.hp < b.maxHp) {
      ui.strokeStyle = 'rgba(255,255,255,0.6)'; ui.beginPath(); ui.moveTo(b.x + 5, b.y + 8); ui.lineTo(b.x + GRID.cell - 8, b.y + GRID.cell - 6); ui.stroke();
    }
  }

  for (const p of state.particles) { ui.globalAlpha = clamp(p.life, 0, 1); ui.fillStyle = p.color; ui.fillRect(p.x, p.y, 3, 3); }
  ui.globalAlpha = 1;
  for (const f of state.floats) { ui.globalAlpha = clamp(f.life, 0, 1); ui.fillStyle = f.color; ui.font = 'bold 18px monospace'; ui.fillText(f.text, f.x, f.y); }
  ui.globalAlpha = 1;

  ui.fillStyle = '#5faecf'; ui.fillRect(150, 710, 90, 16); ui.fillRect(260, 710, 90, 16);
  ui.fillStyle = '#bfe6ff'; ui.fillRect(150, 710 - state.fl * 8, 90, 8); ui.fillRect(260, 710 - state.fr * 8, 90, 8);

  ui.strokeStyle = '#88a7bd'; ui.lineWidth = 5; ui.strokeRect(PLAYFIELD.left, PLAYFIELD.top, PLAYFIELD.right - PLAYFIELD.left, PLAYFIELD.bottom - PLAYFIELD.top);
  ui.fillStyle = 'rgba(180,220,255,0.5)'; ui.fillRect(430, 730 - 80 * state.charge, 22, 80 * state.charge);

  ui.fillStyle = 'rgba(13,18,22,0.8)'; ui.fillRect(18, 12, 465, 92);
  ui.fillStyle = '#d9f2ff'; ui.font = 'bold 20px monospace'; ui.fillText(`MONEY $${state.money.toLocaleString()}`, 28, 38);
  ui.font = 'bold 16px monospace';
  ui.fillText(`POWER ${state.miningPower}`, 28, 62);
  ui.fillText(`DEPTH ${state.depthLevel}m`, 170, 62);
  ui.fillText(`MINED ${state.blocksMined}`, 300, 62);
  ui.fillText(`UPGRADE U: $${state.upgradeCost.toLocaleString()}`, 28, 86);
  ui.font = '14px monospace'; ui.fillText('←/A  →/D  SPACE  U  R', 292, 86);
  ui.restore();
}

function resize() {
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
  glCanvas.width = Math.floor(rect.width * dpr); glCanvas.height = Math.floor(rect.height * dpr);
  uiCanvas.width = glCanvas.width; uiCanvas.height = glCanvas.height;
  const sx = glCanvas.width / WORLD.w; const sy = glCanvas.height / WORLD.h;
  ui.setTransform(sx, 0, 0, sy, 0, 0);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function tick(now) { const dt = Math.min(0.033, (now - last) / 1000); last = now; update(dt); drawGl(); drawUi(); requestAnimationFrame(tick); }
requestAnimationFrame(tick);
