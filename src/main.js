const DPR_MAX = 2;
const WORLD = { w: 500, h: 800 };

const GRID = {
  cols: 8,
  rows: 8,
  cellSize: 40,
  left: 90,
  top: 90,
  get width() { return this.cols * this.cellSize; },
  get height() { return this.rows * this.cellSize; },
};

const ZONE_TEMPLATE = [
  ['danger', 'danger', 'large', 'large', 'large', 'large', 'danger', 'danger'],
  ['danger', 'medium', 'medium', 'large', 'large', 'medium', 'medium', 'danger'],
  ['medium', 'medium', 'commercial', 'commercial', 'commercial', 'commercial', 'medium', 'medium'],
  ['medium', 'commercial', 'commercial', 'public', 'public', 'commercial', 'commercial', 'medium'],
  ['small', 'small', 'commercial', 'public', 'public', 'commercial', 'small', 'small'],
  ['small', 'residential', 'residential', 'small', 'small', 'residential', 'residential', 'small'],
  ['residential', 'residential', 'residential', 'small', 'small', 'residential', 'residential', 'residential'],
  ['residential', 'residential', 'residential', 'small', 'small', 'residential', 'residential', 'residential'],
];

const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const wrap = document.getElementById('wrap');
const uiCtx = uiCanvas.getContext('2d', { alpha: true });
const gl = glCanvas.getContext('webgl', { antialias: true, alpha: false });
if (!gl) throw new Error('WebGL unavailable');

function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function len2(x, y) { return Math.hypot(x, y); }
function randRange(min, max) { return min + Math.random() * (max - min); }

class RuntimeAtlas {
  constructor(glRef, size = 1024) {
    this.gl = glRef;
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.entries = new Map();
    this.x = 0;
    this.y = 0;
    this.row = 0;
    this.texture = glRef.createTexture();
    glRef.bindTexture(glRef.TEXTURE_2D, this.texture);
    glRef.texParameteri(glRef.TEXTURE_2D, glRef.TEXTURE_MIN_FILTER, glRef.LINEAR);
    glRef.texParameteri(glRef.TEXTURE_2D, glRef.TEXTURE_MAG_FILTER, glRef.LINEAR);
    glRef.texParameteri(glRef.TEXTURE_2D, glRef.TEXTURE_WRAP_S, glRef.CLAMP_TO_EDGE);
    glRef.texParameteri(glRef.TEXTURE_2D, glRef.TEXTURE_WRAP_T, glRef.CLAMP_TO_EDGE);
    glRef.texImage2D(glRef.TEXTURE_2D, 0, glRef.RGBA, size, size, 0, glRef.RGBA, glRef.UNSIGNED_BYTE, null);
  }
  pack(key, width, height, drawFn) {
    if (this.entries.has(key)) return this.entries.get(key);
    const pad = 2;
    const pw = width + pad * 2;
    const ph = height + pad * 2;
    if (this.x + pw > this.size) { this.x = 0; this.y += this.row; this.row = 0; }
    if (this.y + ph > this.size) throw new Error('RuntimeAtlas overflow');
    const ox = this.x + pad;
    const oy = this.y + pad;
    drawFn(this.ctx, ox, oy, width, height);
    const entry = { u0: ox / this.size, v0: oy / this.size, u1: (ox + width) / this.size, v1: (oy + height) / this.size, w: width, h: height };
    this.entries.set(key, entry);
    this.x += pw;
    this.row = Math.max(this.row, ph);
    return entry;
  }
  upload() {
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.canvas);
  }
}

function createProgram(glRef, vsSource, fsSource) {
  const compile = (type, source) => {
    const shader = glRef.createShader(type);
    glRef.shaderSource(shader, source);
    glRef.compileShader(shader);
    if (!glRef.getShaderParameter(shader, glRef.COMPILE_STATUS)) throw new Error(glRef.getShaderInfoLog(shader));
    return shader;
  };
  const program = glRef.createProgram();
  glRef.attachShader(program, compile(glRef.VERTEX_SHADER, vsSource));
  glRef.attachShader(program, compile(glRef.FRAGMENT_SHADER, fsSource));
  glRef.linkProgram(program);
  if (!glRef.getProgramParameter(program, glRef.LINK_STATUS)) throw new Error(glRef.getProgramInfoLog(program));
  return program;
}

class SpriteRenderer {
  constructor(glRef, atlas) {
    this.gl = glRef;
    this.atlas = atlas;
    this.verts = [];
    this.buffer = glRef.createBuffer();
    this.program = createProgram(
      glRef,
      'attribute vec2 a_pos;attribute vec2 a_uv;uniform vec2 u_res;varying vec2 v_uv;void main(){vec2 p=(a_pos/u_res)*2.0-1.0;gl_Position=vec4(p.x,-p.y,0.0,1.0);v_uv=a_uv;}',
      'precision mediump float;uniform sampler2D u_tex;varying vec2 v_uv;void main(){gl_FragColor=texture2D(u_tex,v_uv);}'
    );
    this.aPos = glRef.getAttribLocation(this.program, 'a_pos');
    this.aUv = glRef.getAttribLocation(this.program, 'a_uv');
    this.uRes = glRef.getUniformLocation(this.program, 'u_res');
  }
  begin() { this.verts.length = 0; }
  pushSprite(entry, x, y, w, h, rot = 0, pivotX = 0.5, pivotY = 0.5) {
    const cx = x + w * pivotX;
    const cy = y + h * pivotY;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const quad = [[0, 0, entry.u0, entry.v0], [w, 0, entry.u1, entry.v0], [w, h, entry.u1, entry.v1], [0, h, entry.u0, entry.v1]];
    const out = quad.map(([lx, ly, u, v]) => {
      const dx = lx - w * pivotX;
      const dy = ly - h * pivotY;
      return [cx + dx * c - dy * s, cy + dx * s + dy * c, u, v];
    });
    const tri = [out[0], out[1], out[2], out[0], out[2], out[3]];
    for (const v of tri) this.verts.push(...v, 1);
  }
  flush(width, height) {
    const glRef = this.gl;
    glRef.clearColor(0.03, 0.06, 0.13, 1);
    glRef.clear(glRef.COLOR_BUFFER_BIT);
    if (!this.verts.length) return;
    const data = new Float32Array(this.verts);
    glRef.useProgram(this.program);
    glRef.bindBuffer(glRef.ARRAY_BUFFER, this.buffer);
    glRef.bufferData(glRef.ARRAY_BUFFER, data, glRef.DYNAMIC_DRAW);
    glRef.enableVertexAttribArray(this.aPos);
    glRef.vertexAttribPointer(this.aPos, 2, glRef.FLOAT, false, 20, 0);
    glRef.enableVertexAttribArray(this.aUv);
    glRef.vertexAttribPointer(this.aUv, 2, glRef.FLOAT, false, 20, 8);
    glRef.uniform2f(this.uRes, width, height);
    glRef.activeTexture(glRef.TEXTURE0);
    glRef.bindTexture(glRef.TEXTURE_2D, this.atlas.texture);
    glRef.drawArrays(glRef.TRIANGLES, 0, this.verts.length / 5);
  }
}

function drawBuildingSprite(ctx, x, y, w, h, base, accent) {
  ctx.fillStyle = base; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
}
function registerAtlasSprites(atlas) {
  atlas.pack('ball', 30, 30, (ctx, x, y, w) => { const r = w * 0.5; const g = ctx.createRadialGradient(x + r * 0.7, y + r * 0.7, 2, x + r, y + r, r); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#7da8ff'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + r, y + r, r, 0, Math.PI * 2); ctx.fill(); });
  atlas.pack('flipper', 84, 20, (ctx, x, y) => { ctx.fillStyle = '#54d9ff'; ctx.beginPath(); ctx.roundRect(x, y, 84, 20, 10); ctx.fill(); });
  atlas.pack('wall', 20, 20, (ctx, x, y) => { ctx.fillStyle = '#5476cb'; ctx.fillRect(x, y, 20, 20); });
  atlas.pack('building_house', 40, 40, (c, x, y, w, h) => drawBuildingSprite(c, x, y, w, h, '#4cb88b', '#c2f8e6'));
  atlas.pack('building_convenience', 40, 40, (c, x, y, w, h) => drawBuildingSprite(c, x, y, w, h, '#eaf2ff', '#59a4ff'));
  atlas.pack('building_apartment', 40, 80, (c, x, y, w, h) => drawBuildingSprite(c, x, y, w, h, '#ff9f4a', '#ffe2c4'));
  atlas.pack('building_gas', 80, 40, (c, x, y, w, h) => drawBuildingSprite(c, x, y, w, h, '#ff5a5a', '#ffe465'));
  atlas.pack('building_tower', 80, 80, (c, x, y, w, h) => drawBuildingSprite(c, x, y, w, h, '#9867ff', '#f0e8ff'));
  atlas.pack('exp_orb', 20, 20, (c, x, y, w) => { const r = w * 0.5; c.fillStyle = '#f9ef89'; c.beginPath(); c.arc(x + r, y + r, r, 0, Math.PI * 2); c.fill(); });
}

const state = { mode: 'ready', balls: 3, ballLostTimer: 0, fps: 0, fpsS: 0, fpsN: 0, round: 1, quota: 3000, totalScore: 0, roundScore: 0, exp: 0, level: 1, levelUpsPending: 0 };
const START_POS = { x: 430, y: 640 };
const ball = { x: START_POS.x, y: START_POS.y, vx: 0, vy: 0, r: 13, active: false };
const input = { left: false, right: false, launchTap: false, pointerSide: 0 };

const allCards = [
  { id: 'house', name: '住宅', level: 1, rarity: 'common', cooldownSec: 7, cooldownTimer: 0, footprint: { w: 1, h: 1 }, score: 100, hp: 1, exp: 1, tags: ['residential', 'small'], preferredTags: ['residential', 'small'], forbiddenTags: ['danger'], maxActive: 8, effectId: null, spriteKey: 'building_house' },
  { id: 'convenience', name: 'コンビニ', level: 1, rarity: 'common', cooldownSec: 10, cooldownTimer: 1, footprint: { w: 1, h: 1 }, score: 180, hp: 1, exp: 2, tags: ['commercial', 'small'], preferredTags: ['commercial', 'small'], forbiddenTags: [], maxActive: 4, effectId: null, spriteKey: 'building_convenience' },
  { id: 'apartment', name: 'アパート', level: 1, rarity: 'uncommon', cooldownSec: 15, cooldownTimer: 2, footprint: { w: 1, h: 2 }, score: 450, hp: 2, exp: 4, tags: ['residential', 'medium'], preferredTags: ['residential', 'medium'], forbiddenTags: ['danger'], maxActive: 3, effectId: null, spriteKey: 'building_apartment' },
  { id: 'gas_station', name: 'ガソリンスタンド', level: 1, rarity: 'uncommon', cooldownSec: 20, cooldownTimer: 3, footprint: { w: 2, h: 1 }, score: 300, hp: 1, exp: 2, tags: ['commercial', 'danger', 'explosive'], preferredTags: ['danger', 'commercial'], forbiddenTags: [], maxActive: 2, effectId: 'explode', spriteKey: 'building_gas' },
  { id: 'tower', name: 'タワー', level: 1, rarity: 'rare', cooldownSec: 28, cooldownTimer: 5, footprint: { w: 2, h: 2 }, score: 1600, hp: 4, exp: 8, tags: ['large', 'landmark'], preferredTags: ['large', 'danger'], forbiddenTags: ['residential'], maxActive: 1, effectId: null, spriteKey: 'building_tower' },
];
const cardPool = new Map(allCards.map((card) => [card.id, card]));
const ownedCards = [structuredClone(cardPool.get('house')), structuredClone(cardPool.get('convenience'))];

const grid = []; let nextBuildingId = 1; const buildings = []; const orbs = []; let levelUpChoices = [];
for (let r = 0; r < GRID.rows; r += 1) { const row = []; for (let c = 0; c < GRID.cols; c += 1) row.push({ tags: [ZONE_TEMPLATE[r][c]], occupiedBy: null }); grid.push(row); }

const walls = [{ x: 25, y: 25, w: 10, h: 740 }, { x: 465, y: 25, w: 10, h: 740 }, { x: 25, y: 25, w: 450, h: 10 }];
const rails = [{ x1: 25, y1: 620, x2: 170, y2: 720, r: 10, restitution: 0.45, friction: 0.985 }, { x1: 475, y1: 620, x2: 330, y2: 720, r: 10, restitution: 0.45, friction: 0.985 }];
const flippers = {
  left: { pivot: { x: 170, y: 720 }, length: 62, radius: 9, base: 0.16, active: -0.78, angle: 0.16, prev: 0.16, upImpulse: 980 },
  right: { pivot: { x: 330, y: 720 }, length: 62, radius: 9, base: Math.PI - 0.16, active: Math.PI + 0.78, angle: Math.PI - 0.16, prev: Math.PI - 0.16, upImpulse: 980 },
};
const drain = { x0: 228, x1: 272, y: 760 };
const maxBuildings = 8;

function getNextExp() { return 5 + state.level * 3; }
function updateQuota() { state.quota = Math.floor(3000 * Math.pow(1.75, state.round - 1)); }
function resetGridOccupancy() { for (const row of grid) for (const cell of row) cell.occupiedBy = null; buildings.length = 0; orbs.length = 0; }
function resetToReady() { ball.x = START_POS.x; ball.y = START_POS.y; ball.vx = 0; ball.vy = 0; ball.active = false; state.mode = 'ready'; }
function launchBall() { ball.active = true; ball.vx = -120; ball.vy = -900; state.mode = 'playing'; }
function clearRound() { resetGridOccupancy(); for (const card of ownedCards) card.cooldownTimer = randRange(card.cooldownSec * 0.7, card.cooldownSec * 1.2); trySpawnFromCard(ownedCards.find((c) => c.id === 'house') || ownedCards[0], true); trySpawnFromCard(ownedCards.find((c) => c.id === 'convenience') || ownedCards[0], true); }
function beginRound(round) { state.round = round; state.roundScore = 0; state.balls = 3; updateQuota(); clearRound(); resetToReady(); }
function restartRun() { state.totalScore = 0; state.exp = 0; state.level = 1; state.levelUpsPending = 0; ownedCards.length = 0; ownedCards.push(structuredClone(cardPool.get('house')), structuredClone(cardPool.get('convenience'))); beginRound(1); }

function canPlace(card, col, row) { for (let dy = 0; dy < card.footprint.h; dy += 1) for (let dx = 0; dx < card.footprint.w; dx += 1) { const cell = grid[row + dy]?.[col + dx]; if (!cell || cell.occupiedBy) return false; if (card.forbiddenTags.some((tag) => cell.tags.includes(tag))) return false; } return true; }
function getCandidates(card) { const list = []; for (let row = 0; row < GRID.rows; row += 1) for (let col = 0; col < GRID.cols; col += 1) { if (!canPlace(card, col, row)) continue; let weight = 1; for (let dy = 0; dy < card.footprint.h; dy += 1) for (let dx = 0; dx < card.footprint.w; dx += 1) for (const tag of grid[row + dy][col + dx].tags) if (card.preferredTags.includes(tag)) weight += 3; list.push({ col, row, weight }); } return list; }
function weightedPick(cands) { const total = cands.reduce((a, c) => a + c.weight, 0); let v = Math.random() * total; for (const c of cands) { v -= c.weight; if (v <= 0) return c; } return cands[cands.length - 1]; }
function occupancy() { let used = 0; for (const r of grid) for (const c of r) if (c.occupiedBy) used += 1; return used / (GRID.cols * GRID.rows); }
function activeCount(cardId) { return buildings.filter((b) => b.active && b.cardId === cardId).length; }
function trySpawnFromCard(card, force = false) { if (!card) return false; if (!force) { if (buildings.filter((b) => b.active).length >= maxBuildings) return false; if (occupancy() > 0.72) return false; if (activeCount(card.id) >= card.maxActive) return false; } const cands = getCandidates(card); if (!cands.length) return false; const pick = weightedPick(cands); const x = GRID.left + pick.col * GRID.cellSize; const y = GRID.top + pick.row * GRID.cellSize; const map = { '1x1': [32, 32], '1x2': [32, 72], '2x1': [72, 32], '2x2': [72, 72] }; const key = `${card.footprint.w}x${card.footprint.h}`; const [w, h] = map[key] || [32, 32]; const b = { instanceId: nextBuildingId++, cardId: card.id, name: card.name, level: card.level, col: pick.col, row: pick.row, footprint: structuredClone(card.footprint), x: x + 4, y: y + 4, w, h, hp: card.hp, maxHp: card.hp, score: card.score, exp: card.exp, tags: [...card.tags], effectId: card.effectId, spriteKey: card.spriteKey, active: true, hitCooldown: 0 };
  buildings.push(b); for (let dy = 0; dy < card.footprint.h; dy += 1) for (let dx = 0; dx < card.footprint.w; dx += 1) grid[pick.row + dy][pick.col + dx].occupiedBy = b.instanceId; return true; }
function spawnOrbs(building, amount) { for (let i = 0; i < amount; i += 1) orbs.push({ x: building.x + building.w * 0.5 + randRange(-8, 8), y: building.y + building.h * 0.5 + randRange(-8, 8), vx: randRange(-30, 30), vy: randRange(-40, 0), r: 9, value: 1, life: 10, active: true }); }
function gainExp(v) { state.exp += v; while (state.exp >= getNextExp()) { state.exp -= getNextExp(); state.level += 1; state.levelUpsPending += 1; } }
function destroyBuilding(building, allowExplosion = true) { if (!building.active) return; building.active = false; for (let dy = 0; dy < building.footprint.h; dy += 1) for (let dx = 0; dx < building.footprint.w; dx += 1) if (grid[building.row + dy]?.[building.col + dx]?.occupiedBy === building.instanceId) grid[building.row + dy][building.col + dx].occupiedBy = null; state.roundScore += building.score; state.totalScore += building.score; spawnOrbs(building, Math.max(1, building.exp)); if (allowExplosion && building.effectId === 'explode') { const cx = building.x + building.w * 0.5; const cy = building.y + building.h * 0.5; for (const other of buildings) { if (!other.active || other.instanceId === building.instanceId) continue; const ox = other.x + other.w * 0.5; const oy = other.y + other.h * 0.5; if (len2(cx - ox, cy - oy) <= 60) { other.hp -= 1; if (other.hp <= 0) destroyBuilding(other, false); } } } }

function resolveAABB(b, w, restitution = 0.1) { const nx = clamp(b.x, w.x, w.x + w.w); const ny = clamp(b.y, w.y, w.y + w.h); const dx = b.x - nx; const dy = b.y - ny; const d2 = dx * dx + dy * dy; if (d2 >= b.r * b.r) return false; const d = Math.max(0.0001, Math.sqrt(d2)); const nxn = dx / d; const nyn = dy / d; const pen = b.r - d; b.x += nxn * pen; b.y += nyn * pen; const vn = b.vx * nxn + b.vy * nyn; if (vn < 0) { b.vx -= (1 + restitution) * vn * nxn; b.vy -= (1 + restitution) * vn * nyn; } return true; }
function segmentCapsuleHit(b, seg) {
  const abx = seg.x2 - seg.x1;
  const aby = seg.y2 - seg.y1;
  const apx = b.x - seg.x1;
  const apy = b.y - seg.y1;
  const ab2 = abx * abx + aby * aby;
  const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
  const cx = seg.x1 + abx * t;
  const cy = seg.y1 + aby * t;
  const dx = b.x - cx;
  const dy = b.y - cy;
  const rr = b.r + seg.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return null;
  const d = Math.max(0.0001, Math.sqrt(d2));
  const nx = dx / d;
  const ny = dy / d;
  const pen = rr - d;
  b.x += nx * pen;
  b.y += ny * pen;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + seg.restitution) * vn * nx;
    b.vy -= (1 + seg.restitution) * vn * ny;
  }
  b.vx *= seg.friction;
  b.vy *= seg.friction;
  return { nx, ny, t, cx, cy };
}
function flipperSegment(f) { return { x1: f.pivot.x, y1: f.pivot.y, x2: f.pivot.x + Math.cos(f.angle) * f.length, y2: f.pivot.y + Math.sin(f.angle) * f.length, r: f.radius, restitution: 0.58, friction: 0.992 }; }
function applyFlipperImpulse(f, hit, sdt) {
  const omega = (f.angle - f.prev) / Math.max(sdt, 0.0001);
  const rx = hit.cx - f.pivot.x;
  const ry = hit.cy - f.pivot.y;
  const surfaceVx = -omega * ry;
  const surfaceVy = omega * rx;
  const relVx = ball.vx - surfaceVx;
  const relVy = ball.vy - surfaceVy;
  const relN = relVx * hit.nx + relVy * hit.ny;
  if (relN >= 0) return;
  const boost = clamp((-relN) * 1.25 + Math.abs(omega) * f.length * 0.22, 0, f.upImpulse);
  ball.vx += hit.nx * boost;
  ball.vy += hit.ny * boost;
  ball.vy -= boost * 0.55;
}
function clampBallSpeed() { const max = 1300; const speed = Math.hypot(ball.vx, ball.vy); if (speed > max) { const k = max / speed; ball.vx *= k; ball.vy *= k; } }
function ensureMinBallSpeed(min = 360) { const speed = Math.hypot(ball.vx, ball.vy); if (speed > 0 && speed < min) { const k = min / speed; ball.vx *= k; ball.vy *= k; } }

function makeLevelUpChoices() { const choices = []; const unowned = allCards.filter((c) => !ownedCards.some((o) => o.id === c.id)); if (unowned.length) choices.push({ type: 'new', cardId: unowned[Math.floor(Math.random() * unowned.length)].id }); const up = ownedCards.filter((c) => c.level < 5); while (choices.length < 3 && up.length) { const p = up[Math.floor(Math.random() * up.length)]; choices.push({ type: 'up', cardId: p.id }); } while (choices.length < 3) choices.push({ type: 'up', cardId: ownedCards[Math.floor(Math.random() * ownedCards.length)].id }); return choices.slice(0, 3); }
function applyChoice(i) { const ch = levelUpChoices[i]; if (!ch) return; if (ch.type === 'new') ownedCards.push(structuredClone(cardPool.get(ch.cardId))); else { const card = ownedCards.find((c) => c.id === ch.cardId); if (!card) return; card.level = Math.min(5, card.level + 1); card.score = Math.floor(card.score * 1.25); card.exp += 1; card.cooldownSec = Math.max(2.4, card.cooldownSec * 0.9); if (['apartment', 'tower'].includes(card.id)) card.hp += 1; if ([3, 5].includes(card.level)) card.maxActive += 1; }
  state.levelUpsPending = Math.max(0, state.levelUpsPending - 1);
  if (state.levelUpsPending > 0) levelUpChoices = makeLevelUpChoices();
  else if (state.balls > 0) resetToReady();
  else if (state.roundScore >= state.quota) beginRound(state.round + 1);
  else state.mode = 'game_over';
}

addEventListener('keydown', (e) => { if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true; if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true; if (e.code === 'Space' || e.code === 'KeyW') input.launchTap = true; if (e.code === 'Digit1') applyChoice(0); if (e.code === 'Digit2') applyChoice(1); if (e.code === 'Digit3') applyChoice(2); if (e.code === 'KeyR') restartRun(); });
addEventListener('keyup', (e) => { if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false; if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false; });
function pointerDown(clientX, clientY) { const rect = wrap.getBoundingClientRect(); const x = clientX - rect.left; const y = clientY - rect.top; if (state.mode === 'level_up') { const top = 200; for (let i = 0; i < 3; i += 1) { const cy = top + i * 70; if (x > 80 && x < rect.width - 80 && y > cy && y < cy + 54) applyChoice(i); } return; } if (state.mode === 'game_over') { restartRun(); return; } if (state.mode === 'ready') { input.launchTap = true; return; } if (x < rect.width * 0.5) { input.left = true; input.pointerSide = 1; } else { input.right = true; input.pointerSide = 2; } }
function pointerUp() { if (input.pointerSide === 1) input.left = false; if (input.pointerSide === 2) input.right = false; input.pointerSide = 0; }
addEventListener('pointerdown', (e) => pointerDown(e.clientX, e.clientY)); addEventListener('pointerup', pointerUp); addEventListener('pointercancel', pointerUp);

function update(dt) {
  state.fpsS += dt; state.fpsN += 1; if (state.fpsS > 0.3) { state.fps = Math.round(state.fpsN / state.fpsS); state.fpsS = 0; state.fpsN = 0; }
  flippers.left.prev = flippers.left.angle; flippers.right.prev = flippers.right.angle;
  flippers.left.angle += ((input.left ? flippers.left.active : flippers.left.base) - flippers.left.angle) * 0.45;
  flippers.right.angle += ((input.right ? flippers.right.active : flippers.right.base) - flippers.right.angle) * 0.45;

  if (state.mode === 'playing') {
    for (const card of ownedCards) { card.cooldownTimer -= dt; if (card.cooldownTimer <= 0) { trySpawnFromCard(card); card.cooldownTimer += card.cooldownSec; } }
  }

  for (const b of buildings) if (b.active && b.hitCooldown > 0) b.hitCooldown -= dt;
  for (const orb of orbs) if (orb.active) { orb.life -= dt; if (orb.life <= 0) orb.active = false; orb.vy += 260 * dt; orb.x += orb.vx * dt; orb.y += orb.vy * dt; orb.vx *= 0.98; orb.vy *= 0.98; }

  if (state.mode === 'ready') { ball.x = START_POS.x; ball.y = START_POS.y; if (input.launchTap) launchBall(); }
  else if (state.mode === 'playing' && ball.active) {
    const speed = len2(ball.vx, ball.vy); const substeps = clamp(Math.ceil((speed * dt) / (ball.r * 0.4)), 1, 8); const sdt = dt / substeps;
    for (let s = 0; s < substeps; s += 1) {
      ball.vy += 900 * sdt; ball.x += ball.vx * sdt; ball.y += ball.vy * sdt; clampBallSpeed();
      for (const w of walls) resolveAABB(ball, w, 0.62);
      for (const seg of rails) segmentCapsuleHit(ball, seg);
      for (const key of ['left', 'right']) {
        const f = flippers[key];
        const hit = segmentCapsuleHit(ball, flipperSegment(f));
        const pressed = key === 'left' ? input.left : input.right;
        const moving = pressed && Math.abs(f.prev - f.angle) > 0.002;
        if (hit && moving) { applyFlipperImpulse(f, hit, sdt); clampBallSpeed(); ensureMinBallSpeed(420); }
      }
      for (const b of buildings) if (b.active && b.hitCooldown <= 0 && resolveAABB(ball, b, 0.55)) { ensureMinBallSpeed(380); b.hp -= 1; b.hitCooldown = 0.08; if (b.hp <= 0) { destroyBuilding(b); ball.vx *= 1.08; ball.vy *= 1.08; clampBallSpeed(); ensureMinBallSpeed(420); } }
      for (const orb of orbs) if (orb.active && len2(ball.x - orb.x, ball.y - orb.y) <= ball.r + orb.r) { orb.active = false; gainExp(orb.value); }
      if (ball.y > WORLD.h + 30 || (ball.y > drain.y && ball.x > drain.x0 && ball.x < drain.x1)) { ball.active = false; state.mode = 'ball_lost'; state.ballLostTimer = 0.8; break; }
    }
  } else if (state.mode === 'ball_lost') {
    state.ballLostTimer -= dt;
    if (state.ballLostTimer <= 0) {
      state.balls -= 1;
      if (state.levelUpsPending > 0) {
        state.mode = 'level_up';
        levelUpChoices = makeLevelUpChoices();
      } else if (state.balls <= 0) {
        if (state.roundScore >= state.quota) { beginRound(state.round + 1); }
        else state.mode = 'game_over';
      } else resetToReady();
    }
  }
  input.launchTap = false;
}

let dpr = 1;
function resize() { dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX); const rect = wrap.getBoundingClientRect(); const w = Math.floor(rect.width * dpr); const h = Math.floor(rect.height * dpr); glCanvas.width = w; glCanvas.height = h; uiCanvas.width = w; uiCanvas.height = h; gl.viewport(0, 0, w, h); }
addEventListener('resize', resize);

const atlas = new RuntimeAtlas(gl, 1024); registerAtlasSprites(atlas); atlas.upload(); const renderer = new SpriteRenderer(gl, atlas);
function drawSegmentSprite(entry, x1, y1, x2, y2, thickness, sx, sy) { const dx = x2 - x1; const dy = y2 - y1; const len = Math.hypot(dx, dy); const ang = Math.atan2(dy, dx); renderer.pushSprite(entry, x1 * sx, (y1 - thickness) * sy, len * sx, thickness * 2 * sy, ang, 0, 0.5); }
function render() {
  const sx = glCanvas.width / WORLD.w; const sy = glCanvas.height / WORLD.h; renderer.begin();
  const wallSpr = atlas.entries.get('wall'); const flipSpr = atlas.entries.get('flipper'); const ballSpr = atlas.entries.get('ball'); const orbSpr = atlas.entries.get('exp_orb');
  for (const w of walls) renderer.pushSprite(wallSpr, w.x * sx, w.y * sy, w.w * sx, w.h * sy);
  for (let r = 0; r < GRID.rows; r += 1) for (let c = 0; c < GRID.cols; c += 1) renderer.pushSprite(wallSpr, (GRID.left + c * GRID.cellSize) * sx, (GRID.top + r * GRID.cellSize) * sy, 1 * sx, 1 * sy);
  for (const seg of rails) drawSegmentSprite(wallSpr, seg.x1, seg.y1, seg.x2, seg.y2, seg.r, sx, sy);
  for (const b of buildings) if (b.active) renderer.pushSprite(atlas.entries.get(b.spriteKey), b.x * sx, b.y * sy, b.w * sx, b.h * sy);
  for (const orb of orbs) if (orb.active) renderer.pushSprite(orbSpr, (orb.x - orb.r) * sx, (orb.y - orb.r) * sy, orb.r * 2 * sx, orb.r * 2 * sy);
  for (const key of ['left', 'right']) { const f = flippers[key]; const seg = flipperSegment(f); const ang = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1); renderer.pushSprite(flipSpr, seg.x1 * sx, (seg.y1 - f.radius) * sy, f.length * sx, f.radius * 2 * sy, ang, 0, 0.5); }
  if (ball.active || state.mode === 'ready') renderer.pushSprite(ballSpr, (ball.x - ball.r) * sx, (ball.y - ball.r) * sy, ball.r * 2 * sx, ball.r * 2 * sy);
  renderer.flush(glCanvas.width, glCanvas.height);

  uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height); uiCtx.save(); uiCtx.scale(dpr, dpr); const vw = uiCanvas.width / dpr; const vh = uiCanvas.height / dpr;
  uiCtx.fillStyle = '#dfecff'; uiCtx.font = '700 18px system-ui'; uiCtx.fillText(`ROUND ${state.round}`, 18, 28);
  uiCtx.fillText(`SCORE ${state.roundScore}/${state.quota}`, 18, 52); uiCtx.fillText(`TOTAL ${state.totalScore}`, 18, 76); uiCtx.fillText(`BALLS ${state.balls}`, 18, 100);
  uiCtx.fillText(`LV ${state.level} EXP ${state.exp}/${getNextExp()}`, 18, 124);
  uiCtx.font = '500 12px system-ui'; let y = 148; for (const card of ownedCards) { uiCtx.fillText(`[${card.name} Lv${card.level} CD ${Math.max(0, card.cooldownTimer).toFixed(1)}]`, 18, y); y += 16; }
  if (state.mode === 'ready') { uiCtx.fillStyle = '#fff'; uiCtx.font = '700 20px system-ui'; uiCtx.fillText('READY', 210, 500); }
  if (state.mode === 'game_over') { uiCtx.fillStyle = '#ff9cb7'; uiCtx.font = '700 34px system-ui'; uiCtx.fillText('GAME OVER', 145, 380); }
  if (state.mode === 'level_up') {
    uiCtx.fillStyle = 'rgba(0,0,0,0.65)'; uiCtx.fillRect(30, 150, vw - 60, 280); uiCtx.fillStyle = '#fff'; uiCtx.font = '700 30px system-ui'; uiCtx.fillText('LEVEL UP!', 165, 188);
    uiCtx.font = '600 18px system-ui'; for (let i = 0; i < levelUpChoices.length; i += 1) { const ch = levelUpChoices[i]; const card = cardPool.get(ch.cardId) || ownedCards.find((c) => c.id === ch.cardId); const txt = ch.type === 'new' ? `${i + 1}. [NEW] ${card?.name}` : `${i + 1}. [UP] ${card?.name}`; uiCtx.fillStyle = '#1d2a4f'; uiCtx.fillRect(80, 200 + i * 70, vw - 160, 54); uiCtx.fillStyle = '#d5e7ff'; uiCtx.fillText(txt, 95, 235 + i * 70); }
  }
  uiCtx.fillStyle = '#a9bbff'; uiCtx.font = '500 12px system-ui'; uiCtx.fillText('A/← 左 D/→ 右 SPACE 打ち出し R リスタート 数字キーでLvUP選択', 14, vh - 12); uiCtx.restore();
}

let prev = performance.now();
function loop(t) { const dt = Math.min((t - prev) / 1000, 1 / 30); prev = t; update(dt); render(); requestAnimationFrame(loop); }
resize(); restartRun(); requestAnimationFrame(loop);
