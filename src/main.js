import { createMedalEconomy } from './medalEconomy.js';

const DPR_MAX = 2;
const WORLD = { w: 500, h: 800 };
const PLAYFIELD_TOP_Y = 104;
const GRID_TOP_Y = 132;
const BALL_RADIUS = 18;
const BALL_SPRITE_SIZE = 42;
const BALL_COST = 10;

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

const TERRAIN = {
  cols: 50,
  rows: 76,
  cell: 8,
  left: 50,
  top: 132,
  digStartY: 142,
  digEndBuffer: 150,
  launcherCols: 0,
  pixels: [],
};
const GRID = {
  cols: 12,
  rows: 12,
  cellSize: (52 * 8) / 12,
  left: 90,
  top: GRID_TOP_Y,
  get width() { return this.cols * this.cellSize; },
  get height() { return this.rows * this.cellSize; },
};

const ZONE_TEMPLATE_BASE = [
  ['danger', 'danger', 'large', 'large', 'large', 'large', 'danger', 'danger'],
  ['danger', 'medium', 'medium', 'large', 'large', 'medium', 'medium', 'danger'],
  ['medium', 'medium', 'commercial', 'commercial', 'commercial', 'commercial', 'medium', 'medium'],
  ['medium', 'commercial', 'commercial', 'public', 'public', 'commercial', 'commercial', 'medium'],
  ['small', 'small', 'commercial', 'public', 'public', 'commercial', 'small', 'small'],
  ['small', 'residential', 'residential', 'small', 'small', 'residential', 'residential', 'small'],
  ['residential', 'residential', 'residential', 'small', 'small', 'residential', 'residential', 'residential'],
  ['residential', 'residential', 'residential', 'small', 'small', 'residential', 'residential', 'residential'],
];

const ZONE_TEMPLATE = Array.from({ length: GRID.rows }, (_, row) => (
  Array.from({ length: GRID.cols }, (_, col) => {
    const srcRow = Math.min(ZONE_TEMPLATE_BASE.length - 1, Math.floor((row / GRID.rows) * ZONE_TEMPLATE_BASE.length));
    const srcCol = Math.min(ZONE_TEMPLATE_BASE[0].length - 1, Math.floor((col / GRID.cols) * ZONE_TEMPLATE_BASE[0].length));
    return ZONE_TEMPLATE_BASE[srcRow][srcCol];
  })
));

const THEME = {
  clear: [0.92, 0.98, 1.00, 1],
  asphalt: '#6f7376',
  asphaltDark: '#3d464b',
  lane: '#f0d65c',
  sidewalk: '#c8bea6',
  road: '#585f62',
  roadLine: '#f2d85e',
  water: '#48a7d3',
  plaza: '#dfd2b2',
  boardGlass: '#cbd7c0',
  boardEdge: '#27343d',
  railLight: '#f7f8ef',
  railMid: '#6e93a1',
  railDark: '#233640',
  flipperTop: '#f9fbf2',
  flipperMid: '#72b8c8',
  flipperBottom: '#294d5a',
  targetFrame: '#101820',
  targetFrameHot: '#ffc83d',
  targetDeck: '#e8ddc2',
  shadow: 'rgba(18, 24, 28, 0.34)',
  hudPanel: 'rgba(255, 255, 255, 0.88)',
  hudStroke: '#66c7e7',
  hudText: '#173244',
  hudSubText: '#5f7d8b',
  zone: {
    residential: ['#8dbf72', '#5d8d4f', '#f2d7a6'],
    small: ['#b9b3a4', '#7a7d79', '#f2cf5c'],
    medium: ['#9fb0b7', '#657d88', '#e2edf0'],
    commercial: ['#c9ad68', '#af6545', '#f4d452'],
    public: ['#88bd72', '#497d59', '#f3ead0'],
    danger: ['#8b7d65', '#1d1f20', '#f0c33f'],
    large: ['#90a9b7', '#475f6c', '#d9f3ff'],
  },
};

const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const wrap = document.getElementById('wrap');
const uiCtx = uiCanvas.getContext('2d', { alpha: true });
const gl = glCanvas.getContext('webgl', { antialias: true, alpha: false });
if (!gl) throw new Error('WebGL unavailable');

function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function len2(x, y) { return Math.hypot(x, y); }
function randRange(min, max) { return min + Math.random() * (max - min); }
function worldPan(x) { return clamp((x / WORLD.w) * 1.6 - 0.8, -0.8, 0.8); }

const sound = { ctx: null, master: null, enabled: false, unlockedCue: false, last: Object.create(null) };

function ensureAudio() {
  if (sound.ctx) return sound.ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  sound.ctx = new AudioCtx();
  sound.master = sound.ctx.createGain();
  sound.master.gain.value = 0.9;
  sound.master.connect(sound.ctx.destination);
  return sound.ctx;
}
function unlockAudio() {
  const ctx = ensureAudio();
  if (!ctx) return;
  const shouldCue = !sound.unlockedCue;
  sound.enabled = true;
  const playUnlockCue = () => {
    if (!shouldCue || sound.unlockedCue) return;
    sound.unlockedCue = true;
    playSfx('audioOn', 1, 0);
  };
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  playUnlockCue();
}
function sfxGain(value, duration, start = 0, attack = 0.004) {
  const ctx = sound.ctx;
  const gain = ctx.createGain();
  const now = ctx.currentTime + start;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(value, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  return gain;
}
function sfxOut(gain, pan = 0) {
  if (sound.ctx.createStereoPanner) {
    const panner = sound.ctx.createStereoPanner();
    panner.pan.value = pan;
    gain.connect(panner);
    panner.connect(sound.master);
  } else {
    gain.connect(sound.master);
  }
}
function tone({ type = 'triangle', freq = 440, to = 440, duration = 0.1, gain = 0.08, pan = 0, start = 0 }) {
  const ctx = sound.ctx;
  const osc = ctx.createOscillator();
  const amp = sfxGain(gain, duration, start);
  const t = ctx.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
  osc.connect(amp);
  sfxOut(amp, pan);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}
function noise({ duration = 0.08, gain = 0.05, pan = 0, start = 0, filter = 1600, type = 'bandpass' }) {
  const ctx = sound.ctx;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  const biquad = ctx.createBiquadFilter();
  const amp = sfxGain(gain, duration, start, 0.002);
  biquad.type = type;
  biquad.frequency.value = filter;
  biquad.Q.value = 0.8;
  src.buffer = buffer;
  src.connect(biquad);
  biquad.connect(amp);
  sfxOut(amp, pan);
  const t = ctx.currentTime + start;
  src.start(t);
  src.stop(t + duration + 0.02);
}
function playSfx(kind, intensity = 1, pan = 0) {
  if (!sound.enabled || !sound.ctx) return;
  const ctx = sound.ctx;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;
  const cooldown = {
    hit: 0.045, flipper: 0.055, sweet: 0.075, rush: 0.18, destroy: 0.055, explode: 0.12, launch: 0.18,
    audioOn: 0.5, collect: 0.08, crush: 0.035, level: 0.35, levelReady: 0.42, upgrade: 0.12,
    newCard: 0.18, roundClear: 0.55, gameOver: 0.55, drain: 0.24,
  }[kind] || 0;
  if (now - (sound.last[kind] || -1) < cooldown) return;
  sound.last[kind] = now;

  if (kind === 'audioOn') {
    tone({ type: 'square', freq: 560, to: 860, duration: 0.09, gain: 0.120 * intensity, pan, start: 0 });
    tone({ type: 'triangle', freq: 920, to: 1320, duration: 0.12, gain: 0.105 * intensity, pan, start: 0.075 });
    noise({ duration: 0.055, gain: 0.024 * intensity, filter: 4200, type: 'bandpass', pan, start: 0.02 });
  } else if (kind === 'launch') {
    tone({ type: 'triangle', freq: 150, to: 620, duration: 0.20, gain: 0.09 * intensity, pan });
    noise({ duration: 0.16, gain: 0.025 * intensity, filter: 900, type: 'highpass', pan });
  } else if (kind === 'flipper') {
    tone({ type: 'square', freq: 460, to: 210, duration: 0.045, gain: 0.055 * intensity, pan });
    noise({ duration: 0.035, gain: 0.030 * intensity, filter: 2200, type: 'bandpass', pan });
  } else if (kind === 'sweet') {
    tone({ type: 'square', freq: 520, to: 780, duration: 0.055, gain: 0.080 * intensity, pan });
    tone({ type: 'triangle', freq: 980, to: 1420, duration: 0.075, gain: 0.052 * intensity, pan, start: 0.035 });
    noise({ duration: 0.038, gain: 0.030 * intensity, filter: 3600, type: 'bandpass', pan });
  } else if (kind === 'rush') {
    tone({ type: 'triangle', freq: 520, to: 760, duration: 0.08, gain: 0.050 * intensity, pan, start: 0 });
    tone({ type: 'triangle', freq: 760, to: 1080, duration: 0.09, gain: 0.052 * intensity, pan, start: 0.055 });
    tone({ type: 'sine', freq: 1220, to: 1560, duration: 0.08, gain: 0.035 * intensity, pan, start: 0.13 });
  } else if (kind === 'hit') {
    tone({ type: 'triangle', freq: 760, to: 1180, duration: 0.055, gain: 0.050 * intensity, pan });
    tone({ type: 'sine', freq: 1420, to: 920, duration: 0.035, gain: 0.030 * intensity, pan, start: 0.012 });
    noise({ duration: 0.035, gain: 0.020 * intensity, filter: 3600, type: 'bandpass', pan });
  } else if (kind === 'destroy') {
    tone({ type: 'square', freq: 180, to: 85, duration: 0.12, gain: 0.088 * intensity, pan });
    tone({ type: 'triangle', freq: 390, to: 680, duration: 0.12, gain: 0.075 * intensity, pan, start: 0.035 });
    tone({ type: 'sine', freq: 980, to: 620, duration: 0.055, gain: 0.042 * intensity, pan, start: 0.02 });
    noise({ duration: 0.14, gain: 0.065 * intensity, filter: 1400, type: 'bandpass', pan });
  } else if (kind === 'explode') {
    noise({ duration: 0.27, gain: 0.115 * intensity, filter: 520, type: 'lowpass', pan });
    tone({ type: 'sawtooth', freq: 220, to: 58, duration: 0.22, gain: 0.105 * intensity, pan });
    tone({ type: 'triangle', freq: 520, to: 920, duration: 0.13, gain: 0.070 * intensity, pan, start: 0.05 });
  } else if (kind === 'collect') {
    tone({ type: 'sine', freq: 900, to: 1350, duration: 0.070, gain: 0.040 * intensity, pan });
  } else if (kind === 'crush') {
    tone({ type: 'square', freq: 220, to: 130, duration: 0.055, gain: 0.072 * intensity, pan });
    tone({ type: 'triangle', freq: 760, to: 420, duration: 0.045, gain: 0.042 * intensity, pan, start: 0.012 });
    noise({ duration: 0.055, gain: 0.035 * intensity, filter: 900, type: 'lowpass', pan });
  } else if (kind === 'level') {
    tone({ type: 'triangle', freq: 520, to: 680, duration: 0.08, gain: 0.052 * intensity, pan, start: 0 });
    tone({ type: 'triangle', freq: 700, to: 920, duration: 0.09, gain: 0.052 * intensity, pan, start: 0.07 });
    tone({ type: 'triangle', freq: 920, to: 1260, duration: 0.12, gain: 0.060 * intensity, pan, start: 0.14 });
  } else if (kind === 'levelReady') {
    tone({ type: 'triangle', freq: 460, to: 640, duration: 0.08, gain: 0.040 * intensity, pan, start: 0 });
    tone({ type: 'triangle', freq: 680, to: 880, duration: 0.09, gain: 0.040 * intensity, pan, start: 0.065 });
    tone({ type: 'sine', freq: 1040, to: 1260, duration: 0.10, gain: 0.036 * intensity, pan, start: 0.14 });
  } else if (kind === 'upgrade') {
    tone({ type: 'triangle', freq: 620, to: 920, duration: 0.075, gain: 0.050 * intensity, pan });
    tone({ type: 'sine', freq: 1060, to: 1380, duration: 0.08, gain: 0.038 * intensity, pan, start: 0.055 });
    noise({ duration: 0.035, gain: 0.014 * intensity, filter: 4200, type: 'bandpass', pan });
  } else if (kind === 'newCard') {
    tone({ type: 'triangle', freq: 520, to: 760, duration: 0.085, gain: 0.052 * intensity, pan, start: 0 });
    tone({ type: 'triangle', freq: 760, to: 1040, duration: 0.095, gain: 0.050 * intensity, pan, start: 0.07 });
    tone({ type: 'sine', freq: 1240, to: 1480, duration: 0.08, gain: 0.034 * intensity, pan, start: 0.15 });
  } else if (kind === 'roundClear') {
    tone({ type: 'triangle', freq: 420, to: 620, duration: 0.09, gain: 0.050 * intensity, pan, start: 0 });
    tone({ type: 'triangle', freq: 620, to: 860, duration: 0.10, gain: 0.050 * intensity, pan, start: 0.08 });
    tone({ type: 'triangle', freq: 860, to: 1180, duration: 0.12, gain: 0.056 * intensity, pan, start: 0.17 });
    tone({ type: 'sine', freq: 1360, to: 1520, duration: 0.10, gain: 0.030 * intensity, pan, start: 0.29 });
  } else if (kind === 'gameOver') {
    tone({ type: 'sine', freq: 330, to: 210, duration: 0.16, gain: 0.052 * intensity, pan, start: 0 });
    tone({ type: 'triangle', freq: 210, to: 110, duration: 0.24, gain: 0.050 * intensity, pan, start: 0.11 });
  } else if (kind === 'drain') {
    tone({ type: 'sine', freq: 260, to: 120, duration: 0.20, gain: 0.055 * intensity, pan });
  }
}

class RuntimeAtlas {
  constructor(glRef, size = 1024) {
    this.gl = glRef;
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
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
    glRef.clearColor(...THEME.clear);
    glRef.clear(glRef.COLOR_BUFFER_BIT);
    if (!this.verts.length) return;
    glRef.enable(glRef.BLEND);
    glRef.blendFunc(glRef.SRC_ALPHA, glRef.ONE_MINUS_SRC_ALPHA);
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

function drawWindowGrid(ctx, x, y, cols, rows, gapX, gapY, winW, winH, color) {
  ctx.fillStyle = color;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      ctx.fillRect(x + col * gapX, y + row * gapY, winW, winH);
    }
  }
}
function drawIsoDiamond(ctx, cx, cy, w, h, fill, stroke) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.5);
  ctx.lineTo(cx + w * 0.5, cy);
  ctx.lineTo(cx, cy + h * 0.5);
  ctx.lineTo(cx - w * 0.5, cy);
  ctx.closePath();
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
function drawIsoBlock(ctx, x, y, w, h, depth, top, front, side) {
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.moveTo(x + w, y + depth);
  ctx.lineTo(x + w - depth, y + h);
  ctx.lineTo(x + depth, y + h);
  ctx.lineTo(x + depth * 2, y + h - depth);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = front;
  ctx.beginPath();
  ctx.moveTo(x + depth, y + depth * 1.5);
  ctx.lineTo(x + w, y + depth);
  ctx.lineTo(x + depth * 2, y + h - depth);
  ctx.lineTo(x, y + h - depth * 1.5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(x + depth, y + depth * 1.5);
  ctx.lineTo(x + w - depth, y);
  ctx.lineTo(x + w, y + depth);
  ctx.lineTo(x + depth * 2, y + h - depth);
  ctx.closePath();
  ctx.fill();
}
function drawRoadLine(ctx, x1, y1, x2, y2, width, color, dash = null) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}
function drawTree(ctx, x, y, scale = 1) {
  ctx.fillStyle = 'rgba(67, 104, 72, 0.18)';
  ctx.beginPath();
  ctx.ellipse(x + 2 * scale, y + 8 * scale, 7 * scale, 3 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6fc36d';
  ctx.beginPath();
  ctx.arc(x, y, 6 * scale, 0, Math.PI * 2);
  ctx.arc(x + 5 * scale, y + 3 * scale, 5 * scale, 0, Math.PI * 2);
  ctx.arc(x - 4 * scale, y + 4 * scale, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6a9d4d';
  ctx.fillRect(x - 1 * scale, y + 5 * scale, 3 * scale, 7 * scale);
}
function drawTinyCar(ctx, x, y, color, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(48, 74, 89, 0.20)';
  ctx.beginPath();
  ctx.roundRect(-9, -4, 18, 10, 5);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-8, -6, 16, 10, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.74)';
  ctx.fillRect(-4, -5, 8, 3);
  ctx.restore();
}
function drawCrosswalk(ctx, x, y, w, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  for (let i = -2; i <= 2; i += 1) ctx.fillRect(i * 7 - 2, -w * 0.5, 4, w);
  ctx.restore();
}
function drawPopPad(ctx, cx, cy, radius, color) {
  ctx.fillStyle = 'rgba(39, 70, 88, 0.18)';
  ctx.beginPath();
  ctx.ellipse(cx + 2, cy + 6, radius * 1.15, radius * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  const ring = ctx.createRadialGradient(cx - radius * 0.25, cy - radius * 0.32, 2, cx, cy, radius);
  ring.addColorStop(0, '#ffffff');
  ring.addColorStop(0.58, '#fffdf3');
  ring.addColorStop(1, color);
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
}
function drawPixelFrame(ctx, x, y, w, h, fill, stroke = '#101820', hi = 'rgba(255,255,255,0.35)') {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(x + 4, y + 5, w, h);
  ctx.fillStyle = stroke;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
  ctx.fillStyle = hi;
  ctx.fillRect(x + 5, y + 5, w - 10, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(x + 5, y + h - 7, w - 10, 2);
}
function drawAsphaltTicks(ctx, x, y, w, h, color = 'rgba(245,220,98,0.78)', vertical = false) {
  ctx.fillStyle = color;
  const step = 19;
  if (vertical) {
    for (let yy = y + 8; yy < y + h - 8; yy += step) ctx.fillRect(x + w * 0.5 - 1, yy, 2, 9);
  } else {
    for (let xx = x + 8; xx < x + w - 8; xx += step) ctx.fillRect(xx, y + h * 0.5 - 1, 9, 2);
  }
}
function drawPavingGrid(ctx, x, y, w, h, color = 'rgba(255,255,255,0.18)', step = 12) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let xx = x + step; xx < x + w; xx += step) {
    ctx.moveTo(xx, y);
    ctx.lineTo(xx, y + h);
  }
  for (let yy = y + step; yy < y + h; yy += step) {
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy);
  }
  ctx.stroke();
}
function drawTargetBase(ctx, x, y, w, h, hot = false) {
  drawPixelFrame(ctx, x + 2, y + 3, w - 4, h - 7, hot ? '#fff4b8' : '#e6edf2', hot ? '#f0c137' : '#98a9b4');
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(x + 7, y + h - 8, w - 14, 2);
  ctx.fillStyle = hot ? '#ffe27a' : '#d4dde3';
  ctx.fillRect(x + 7, y + 8, 8, 2);
  ctx.fillRect(x + w - 15, y + 8, 8, 2);
  ctx.fillStyle = hot ? '#ffffff' : '#6f8088';
  ctx.fillRect(x + 10, y + h - 16, w - 20, 2);
  if (hot) {
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(x + 11, y + 12, w - 22, 3);
  }
}
function drawGlassTower(ctx, x, y, w, h, accent = '#32bde2') {
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.fillRect(x + 5, y + 7, w, h);
  ctx.fillStyle = '#111820';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#6c93a5';
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
  ctx.fillStyle = '#a8d6e6';
  ctx.fillRect(x + 7, y + 6, w * 0.32, h - 12);
  ctx.fillStyle = '#3e6576';
  for (let yy = y + 12; yy < y + h - 8; yy += 10) ctx.fillRect(x + 8, yy, w - 16, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  for (let yy = y + 12; yy < y + h - 10; yy += 14) {
    ctx.fillRect(x + 12, yy, 4, 3);
    ctx.fillRect(x + w - 16, yy + 4, 4, 3);
  }
  ctx.fillStyle = accent;
  ctx.fillRect(x + 6, y - 6, w - 12, 8);
  ctx.fillStyle = '#fff2a6';
  ctx.fillRect(x + 10, y - 4, w - 20, 2);
}
function drawSkyline(ctx, x, baseY, width) {
  const towers = [
    [0.02, 58, 25], [0.09, 92, 34], [0.19, 66, 28], [0.27, 108, 42],
    [0.40, 76, 30], [0.50, 120, 48], [0.64, 84, 32], [0.74, 112, 40], [0.88, 72, 30],
  ];
  ctx.fillStyle = 'rgba(41, 55, 62, 0.22)';
  for (const [ratio, height, tw] of towers) {
    const tx = x + width * ratio;
    const ty = baseY - height;
    ctx.fillRect(tx, ty, tw, height);
    ctx.fillStyle = 'rgba(255,244,185,0.38)';
    for (let wy = ty + 12; wy < baseY - 8; wy += 14) {
      ctx.fillRect(tx + 6, wy, 5, 4);
      ctx.fillRect(tx + tw - 11, wy, 5, 4);
    }
    ctx.fillStyle = 'rgba(41, 55, 62, 0.22)';
  }
}
function drawUrbanCellIcon(ctx, x, y, kind, accent) {
  if (kind === 'large') {
    ctx.fillStyle = '#5fbfd9';
    ctx.beginPath();
    ctx.roundRect(x + 7, y + 7, 7, 19, 2);
    ctx.roundRect(x + 17, y + 3, 8, 23, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    for (let wy = y + 8; wy < y + 24; wy += 6) {
      ctx.fillRect(x + 10, wy, 3, 2);
      ctx.fillRect(x + 19, wy - 2, 3, 2);
    }
  } else if (kind === 'commercial') {
    ctx.fillStyle = accent;
    ctx.fillRect(x + 6, y + 9, 20, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 7, y + 15, 18, 4);
    ctx.fillStyle = '#59c8df';
    ctx.fillRect(x + 9, y + 20, 14, 5);
  } else if (kind === 'public') {
    ctx.fillStyle = '#61c86f';
    ctx.beginPath();
    ctx.arc(x + 12, y + 14, 6, 0, Math.PI * 2);
    ctx.arc(x + 21, y + 19, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.78)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 24);
    ctx.lineTo(x + 24, y + 10);
    ctx.stroke();
  } else if (kind === 'danger') {
    ctx.fillStyle = '#ffb65b';
    ctx.fillRect(x + 5, y + 7, 22, 18);
    ctx.strokeStyle = '#fff2ae';
    ctx.lineWidth = 2;
    for (let i = 4; i < 24; i += 8) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + 26);
      ctx.lineTo(x + i + 9, y + 7);
      ctx.stroke();
    }
  } else if (kind === 'residential') {
    ctx.fillStyle = '#89c69a';
    ctx.beginPath();
    ctx.roundRect(x + 7, y + 11, 18, 15, 3);
    ctx.fill();
    ctx.fillStyle = '#f47b68';
    ctx.fillRect(x + 8, y + 9, 16, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(x + 11, y + 16, 4, 3);
    ctx.fillRect(x + 18, y + 16, 4, 3);
  } else {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(x + 8, y + 9, 16, 14, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillRect(x + 11, y + 12, 10, 3);
    ctx.fillRect(x + 11, y + 18, 10, 3);
  }
}
function drawShopBlock(ctx, x, y, w, h, roof, awning) {
  ctx.fillStyle = 'rgba(52, 79, 92, 0.16)';
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 7, w, h, 8);
  ctx.fill();
  ctx.fillStyle = '#fff8df';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 10);
  ctx.lineTo(x + w * 0.52, y - 8);
  ctx.lineTo(x + w - 8, y + 10);
  ctx.lineTo(x + w - 4, y + 18);
  ctx.lineTo(x + 4, y + 18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = awning;
  for (let i = 0; i < 5; i += 1) ctx.fillRect(x + 7 + i * 11, y + 22, 7, 9);
  ctx.fillStyle = '#75cce7';
  ctx.fillRect(x + 12, y + 36, w - 24, 12);
}
function drawCivicHall(ctx, x, y) {
  ctx.fillStyle = 'rgba(50, 76, 88, 0.14)';
  ctx.beginPath();
  ctx.roundRect(x + 8, y + 14, 146, 86, 14);
  ctx.fill();
  ctx.fillStyle = '#fff6de';
  ctx.beginPath();
  ctx.roundRect(x, y + 28, 150, 68, 12);
  ctx.fill();
  ctx.fillStyle = '#46bdd4';
  ctx.beginPath();
  ctx.arc(x + 75, y + 30, 24, Math.PI, 0);
  ctx.lineTo(x + 99, y + 34);
  ctx.lineTo(x + 51, y + 34);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fb6f5e';
  ctx.fillRect(x + 36, y + 43, 78, 5);
  ctx.fillStyle = '#fefdf8';
  for (let i = 0; i < 5; i += 1) ctx.fillRect(x + 42 + i * 15, y + 51, 8, 35);
  ctx.fillStyle = '#39769a';
  ctx.fillRect(x + 67, y + 61, 16, 25);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x + 75, y + 30, 24, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = '#ffcf45';
  ctx.beginPath();
  ctx.moveTo(x + 75, y + 0);
  ctx.lineTo(x + 75, y + 20);
  ctx.strokeStyle = '#35607a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 77, y + 4);
  ctx.lineTo(x + 96, y + 10);
  ctx.lineTo(x + 77, y + 16);
  ctx.closePath();
  ctx.fill();
}
function drawTargetLot(ctx, cx, cy, color) {
  ctx.fillStyle = 'rgba(55, 83, 100, 0.16)';
  ctx.beginPath();
  ctx.roundRect(cx - 17, cy - 12, 34, 28, 7);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.beginPath();
  ctx.roundRect(cx - 16, cy - 16, 32, 32, 8);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(cx - 8, cy + 3, 16, 4);
  ctx.fillStyle = 'rgba(85, 165, 190, 0.45)';
  ctx.fillRect(cx - 6, cy - 7, 12, 7);
}
function drawMiniDistrict(ctx, x, y) {
  const gx = x + GRID.left;
  const gy = y + GRID.top;
  const gw = GRID.width;
  const gh = GRID.height;

  ctx.fillStyle = 'rgba(29, 50, 63, 0.20)';
  ctx.beginPath();
  ctx.roundRect(gx - 28, gy - 22, gw + 56, gh + 48, 18);
  ctx.fill();

  const deck = ctx.createLinearGradient(gx, gy - 30, gx, gy + gh + 20);
  deck.addColorStop(0, '#f9fbff');
  deck.addColorStop(1, '#e4eff4');
  ctx.fillStyle = deck;
  ctx.beginPath();
  ctx.roundRect(gx - 24, gy - 28, gw + 48, gh + 48, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.86)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#6f7f8b';
  ctx.beginPath();
  ctx.roundRect(gx - 10, gy - 10, gw + 20, gh + 20, 12);
  ctx.fill();

  for (let row = 0; row < GRID.rows; row += 1) {
    for (let col = 0; col < GRID.cols; col += 1) {
      const kind = ZONE_TEMPLATE[row][col];
      const lx = gx + col * GRID.cellSize + 4;
      const ly = gy + row * GRID.cellSize + 4;
      const palette = {
        residential: ['#dceee3', '#74c989'],
        small: ['#f2f5f8', '#f6c850'],
        medium: ['#e4edf5', '#58bdd6'],
        commercial: ['#fff0ca', '#f3b84a'],
        public: ['#d4f0d0', '#58bd6d'],
        danger: ['#ffe0c6', '#f58b55'],
        large: ['#d7edf7', '#45bde0'],
      }[kind] || ['#f2f5f8', '#58bdd6'];

      ctx.fillStyle = 'rgba(17, 35, 46, 0.14)';
      ctx.beginPath();
      ctx.roundRect(lx + 2, ly + 3, 32, 32, 6);
      ctx.fill();
      ctx.fillStyle = palette[0];
      ctx.beginPath();
      ctx.roundRect(lx, ly, 32, 32, 6);
      ctx.fill();
      ctx.strokeStyle = row < 2 || col === 0 || col === GRID.cols - 1 ? 'rgba(255, 196, 74, 0.78)' : 'rgba(255,255,255,0.78)';
      ctx.lineWidth = 2;
      ctx.stroke();
      drawUrbanCellIcon(ctx, lx, ly, kind, palette[1]);
    }
  }

  for (let i = 1; i < GRID.cols; i += 1) {
    const px = gx + i * GRID.cellSize;
    drawRoadLine(ctx, px, gy - 6, px, gy + gh + 6, i === 3 || i === 5 ? 6 : 3, 'rgba(70, 84, 94, 0.72)');
    if (i === 3 || i === 5) drawRoadLine(ctx, px, gy + 8, px, gy + gh - 8, 1.5, 'rgba(255,255,255,0.78)', [8, 10]);
  }
  for (let i = 1; i < GRID.rows; i += 1) {
    const py = gy + i * GRID.cellSize;
    drawRoadLine(ctx, gx - 6, py, gx + gw + 6, py, i === 2 || i === 5 ? 6 : 3, 'rgba(70, 84, 94, 0.72)');
    if (i === 2 || i === 5) drawRoadLine(ctx, gx + 8, py, gx + gw - 8, 1.5, 'rgba(255,255,255,0.78)', [8, 10]);
  }

  drawCrosswalk(ctx, gx + GRID.cellSize * 3, gy + GRID.cellSize * 2, 20, Math.PI * 0.5);
  drawCrosswalk(ctx, gx + GRID.cellSize * 5, gy + GRID.cellSize * 5, 20, Math.PI * 0.5);
  drawCrosswalk(ctx, gx + GRID.cellSize * 3, gy + GRID.cellSize * 5, 20, 0);
  drawTinyCar(ctx, gx + 63, gy + 82, '#ffd04c', 0);
  drawTinyCar(ctx, gx + 264, gy + 204, '#f56f60', Math.PI);
  drawTinyCar(ctx, gx + 206, gy + 122, '#5ac7e2', Math.PI * 0.5);

  ctx.strokeStyle = 'rgba(255,255,255,0.76)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(gx - 22, gy - 26, gw + 44, gh + 44, 18);
  ctx.stroke();
}
function drawLotIcon(ctx, x, y, size, kind, tone) {
  const cx = x + size * 0.5;
  const cy = y + size * 0.52;
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 2, size - 4, size - 4, 4);
  ctx.fill();

  if (kind === 'residential') {
    ctx.fillStyle = 'rgba(117, 178, 142, 0.32)';
    ctx.fillRect(x + 5, y + 16, size - 10, 8);
    ctx.fillStyle = 'rgba(226, 119, 91, 0.58)';
    ctx.beginPath();
    ctx.moveTo(x + 7, y + 16);
    ctx.lineTo(cx, y + 9);
    ctx.lineTo(x + size - 7, y + 16);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'public') {
    ctx.fillStyle = 'rgba(97, 177, 107, 0.40)';
    ctx.beginPath();
    ctx.arc(x + 12, y + 15, 6, 0, Math.PI * 2);
    ctx.arc(x + 21, y + 20, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.62)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 7, y + 24);
    ctx.lineTo(x + 24, y + 13);
    ctx.stroke();
  } else if (kind === 'commercial') {
    ctx.fillStyle = 'rgba(238, 185, 82, 0.34)';
    ctx.fillRect(x + 6, y + 9, size - 12, 14);
    ctx.fillStyle = 'rgba(56, 137, 172, 0.34)';
    ctx.fillRect(x + 9, y + 16, size - 18, 5);
  } else if (kind === 'large') {
    ctx.fillStyle = 'rgba(112, 145, 168, 0.34)';
    ctx.fillRect(x + 7, y + 8, 7, 17);
    ctx.fillRect(x + 17, y + 5, 7, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.fillRect(x + 9, y + 11, 3, 2);
    ctx.fillRect(x + 19, y + 9, 3, 2);
  } else if (kind === 'danger') {
    ctx.fillStyle = 'rgba(214, 142, 83, 0.20)';
    ctx.fillRect(x + 5, y + 7, size - 10, size - 12);
    ctx.strokeStyle = 'rgba(190, 132, 76, 0.34)';
    ctx.lineWidth = 1.5;
    for (let i = 6; i < size - 5; i += 9) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + 25);
      ctx.lineTo(x + i + 8, y + 10);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = 'rgba(125, 149, 165, 0.22)';
    ctx.fillRect(x + 8, y + 11, size - 16, size - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.fillRect(x + 11, y + 15, size - 22, 3);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.46)';
  ctx.beginPath();
  ctx.arc(cx + 8, cy - 9, 1.4, 0, Math.PI * 2);
  ctx.fill();
}
function drawDistrictMap(ctx, x, y) {
  const gx = x + GRID.left;
  const gy = y + GRID.top;
  const gw = GRID.width;
  const gh = GRID.height;

  ctx.fillStyle = 'rgba(54, 78, 94, 0.18)';
  ctx.beginPath();
  ctx.roundRect(gx - 22, gy - 14, gw + 44, gh + 40, 14);
  ctx.fill();
  ctx.fillStyle = '#eef5e8';
  ctx.beginPath();
  ctx.roundRect(gx - 18, gy - 20, gw + 36, gh + 36, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(92, 130, 151, 0.42)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#b9c7d0';
  ctx.fillRect(gx - 8, gy - 8, gw + 16, gh + 16);
  for (let row = 0; row < GRID.rows; row += 1) {
    for (let col = 0; col < GRID.cols; col += 1) {
      const kind = ZONE_TEMPLATE[row][col];
      const tone = THEME.zone[kind] || THEME.zone.small;
      const lotX = gx + col * GRID.cellSize + 5;
      const lotY = gy + row * GRID.cellSize + 5;
      ctx.fillStyle = kind === 'public' ? '#dcefd4' : kind === 'commercial' ? '#f7efd8' : kind === 'danger' ? '#f2e6d8' : kind === 'large' ? '#e2ebf1' : '#edf2f0';
      ctx.fillRect(lotX, lotY, 30, 30);
      if (kind === 'public' || (kind === 'large' && (row + col) % 2 === 0) || (row * 2 + col) % 5 === 0) {
        drawLotIcon(ctx, lotX, lotY, 30, kind, tone);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.26)';
        ctx.fillRect(lotX + 7, lotY + 10, 16, 4);
        ctx.fillRect(lotX + 10, lotY + 18, 10, 4);
      }
    }
  }

  for (let i = 0; i <= GRID.cols; i += 1) {
    const rx = gx + i * GRID.cellSize;
    drawRoadLine(ctx, rx, gy - 9, rx, gy + gh + 9, i === 3 || i === 5 ? 7 : 3, '#aab9c2');
    if (i > 0 && i < GRID.cols) drawRoadLine(ctx, rx, gy - 4, rx, gy + gh + 4, 1, '#f7fbff', [7, 9]);
  }
  for (let i = 0; i <= GRID.rows; i += 1) {
    const ry = gy + i * GRID.cellSize;
    drawRoadLine(ctx, gx - 9, ry, gx + gw + 9, ry, i === 2 || i === 5 ? 7 : 3, '#aab9c2');
    if (i > 0 && i < GRID.rows) drawRoadLine(ctx, gx - 4, ry, gx + gw + 4, 1, '#f7fbff', [7, 9]);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.70)';
  ctx.strokeStyle = 'rgba(93, 128, 148, 0.22)';
  ctx.lineWidth = 1.5;
  for (const [cx, cy] of [[gx + 120, gy + 80], [gx + 200, gy + 200], [gx + 280, gy + 80]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
function drawCityTile(ctx, x, y, w, h, kind) {
  const styles = THEME.zone[kind] || THEME.zone.small;
  ctx.fillStyle = THEME.road;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.62)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 2, y + 20);
  ctx.lineTo(x + w - 2, y + 20);
  ctx.moveTo(x + 20, y + 2);
  ctx.lineTo(x + 20, y + h - 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(92, 113, 126, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x + 22, y + 24, 15, 8, -0.35, 0, Math.PI * 2);
  ctx.fill();
  drawIsoDiamond(ctx, x + 20, y + 20, 29, 22, styles[0], styles[1]);

  if (kind === 'commercial') {
    ctx.fillStyle = styles[2];
    ctx.fillRect(x + 12, y + 17, 16, 3);
    ctx.fillRect(x + 15, y + 23, 10, 3);
  } else if (kind === 'public') {
    ctx.fillStyle = styles[2];
    ctx.beginPath();
    ctx.arc(x + 16, y + 17, 5, 0, Math.PI * 2);
    ctx.arc(x + 25, y + 23, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'danger') {
    ctx.strokeStyle = styles[2];
    ctx.lineWidth = 2;
    for (let i = 3; i < 36; i += 8) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + 27);
      ctx.lineTo(x + i + 11, y + 13);
      ctx.stroke();
    }
  } else if (kind === 'large') {
    drawIsoBlock(ctx, x + 12, y + 9, 16, 24, 5, styles[2], '#9eb8ce', '#7f9ab1');
    drawWindowGrid(ctx, x + 15, y + 18, 2, 2, 5, 5, 2, 2, '#ffffff');
  } else if (kind === 'residential') {
    ctx.fillStyle = styles[2];
    ctx.beginPath();
    ctx.moveTo(x + 13, y + 22);
    ctx.lineTo(x + 20, y + 14);
    ctx.lineTo(x + 27, y + 22);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = styles[2];
    ctx.fillRect(x + 14, y + 17, 12, 4);
  }
}
function drawHouseSprite(ctx, x, y, w, h) {
  ctx.fillStyle = THEME.shadow;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.56, y + h - 7, 15, 6, -0.18, 0, Math.PI * 2);
  ctx.fill();
  drawIsoBlock(ctx, x + 6, y + 9, w - 12, h - 9, 6, '#f8fdff', '#d7edf3', '#b5d2dc');
  ctx.fillStyle = '#58bfd8';
  ctx.fillRect(x + 10, y + 12, w - 20, 4);
  ctx.fillStyle = '#ffffff';
  drawWindowGrid(ctx, x + 11, y + 18, 3, 2, 8, 7, 4, 3, '#ffffff');
  ctx.fillStyle = '#73c87e';
  ctx.beginPath();
  ctx.arc(x + 28, y + 12, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a718b';
  ctx.fillRect(x + 17, y + 28, 6, 7);
}
function drawConvenienceSprite(ctx, x, y, w, h) {
  ctx.fillStyle = THEME.shadow;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.55, y + h - 7, 16, 6, -0.22, 0, Math.PI * 2);
  ctx.fill();
  drawIsoBlock(ctx, x + 5, y + 10, w - 10, h - 10, 6, '#ffffff', '#e9f6fb', '#c2dce8');
  ctx.fillStyle = '#277fce';
  ctx.fillRect(x + 5, y + 11, w - 10, 5);
  ctx.fillStyle = '#f26d61';
  ctx.fillRect(x + 5, y + 16, w - 10, 3);
  ctx.fillStyle = '#223553';
  ctx.font = '700 8px system-ui';
  ctx.fillText('24', x + 14, y + 28);
  ctx.fillStyle = '#79d2ed';
  ctx.fillRect(x + 7, y + 21, 8, 10);
  ctx.fillRect(x + 25, y + 21, 8, 10);
}
function drawApartmentSprite(ctx, x, y, w, h) {
  ctx.fillStyle = THEME.shadow;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.58, y + h - 8, 15, 7, -0.25, 0, Math.PI * 2);
  ctx.fill();
  drawIsoBlock(ctx, x + 5, y + 7, w - 10, h - 9, 7, '#f8fdff', '#9ed1e2', '#6fa8c2');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 9, y + 4, w - 18, 5);
  drawWindowGrid(ctx, x + 10, y + 15, 3, 6, 8, 9, 4, 4, '#f7fbff');
  ctx.fillStyle = '#397493';
  ctx.fillRect(x + 17, y + h - 15, 6, 8);
}
function drawGasSprite(ctx, x, y, w, h) {
  ctx.fillStyle = THEME.shadow;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.52, y + h - 6, 31, 7, -0.15, 0, Math.PI * 2);
  ctx.fill();
  drawIsoBlock(ctx, x + 5, y + 17, w - 10, h - 8, 8, '#ffffff', '#edf7fb', '#c6d8e0');
  ctx.fillStyle = '#f26d61';
  ctx.fillRect(x + 6, y + 8, w - 12, 10);
  ctx.fillStyle = '#f4c748';
  ctx.fillRect(x + 8, y + 12, w - 16, 3);
  ctx.fillStyle = '#f3f8ff';
  ctx.fillRect(x + 14, y + 22, 10, 12);
  ctx.fillRect(x + w - 24, y + 22, 10, 12);
  ctx.fillStyle = '#21384a';
  ctx.font = '700 8px system-ui';
  ctx.fillText('GAS', x + w * 0.5 - 9, y + 16);
}
function drawTowerSprite(ctx, x, y, w, h) {
  ctx.fillStyle = THEME.shadow;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.56, y + h - 8, 30, 9, -0.25, 0, Math.PI * 2);
  ctx.fill();
  drawIsoBlock(ctx, x + 8, y + 4, w - 16, h - 8, 11, '#eefbff', '#9ec4dc', '#6f9ab9');
  drawWindowGrid(ctx, x + 16, y + 14, 5, 6, 9, 8, 4, 4, '#ffffff');
  ctx.fillStyle = '#f1fbff';
  ctx.fillRect(x + 28, y + 7, 24, 4);
}
function drawPlayfieldSprite(ctx, x, y, w, h) {
  const sky = ctx.createLinearGradient(x, y, x, y + h);
  sky.addColorStop(0, '#78d5ff');
  sky.addColorStop(0.32, '#ccefff');
  sky.addColorStop(1, '#edf5f0');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = '#f5efe1';
  ctx.beginPath();
  ctx.roundRect(x + 18, y + 20, w - 36, h - 34, 34);
  ctx.fill();
  ctx.strokeStyle = '#fff7e9';
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = '#247fa8';
  ctx.lineWidth = 7;
  ctx.stroke();

  ctx.fillStyle = '#eef7f3';
  ctx.beginPath();
  ctx.roundRect(x + 35, y + 58, w - 70, h - 92, 26);
  ctx.fill();

  drawSkyline(ctx, x + 48, y + 120, 404);

  ctx.fillStyle = '#1fb5d8';
  ctx.beginPath();
  ctx.moveTo(x + 50, y + 120);
  ctx.bezierCurveTo(x + 118, y + 204, x + 40, y + 380, x + 94, y + 536);
  ctx.bezierCurveTo(x + 122, y + 615, x + 86, y + 686, x + 60, y + 742);
  ctx.lineTo(x + 36, y + 742);
  ctx.lineTo(x + 36, y + 116);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1ca8d4';
  ctx.beginPath();
  ctx.moveTo(x + 436, y + 108);
  ctx.bezierCurveTo(x + 360, y + 210, x + 460, y + 388, x + 398, y + 535);
  ctx.bezierCurveTo(x + 360, y + 620, x + 404, y + 686, x + 442, y + 748);
  ctx.lineTo(x + 464, y + 748);
  ctx.lineTo(x + 464, y + 104);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.62)';
  ctx.lineWidth = 3;
  for (const by of [188, 332, 504, 654]) {
    drawRoadLine(ctx, x + 44, y + by, x + 96, y + by + 42, 3, 'rgba(255,255,255,0.62)');
    drawRoadLine(ctx, x + 456, y + by, x + 404, y + by + 42, 3, 'rgba(255,255,255,0.62)');
  }

  drawRoadLine(ctx, x + 74, y + 488, x + 426, y + 488, 58, '#65747f');
  drawRoadLine(ctx, x + 250, y + 430, x + 250, y + 724, 56, '#65747f');
  drawRoadLine(ctx, x + 86, y + 654, x + 202, y + 704, 44, '#6d7d88');
  drawRoadLine(ctx, x + 414, y + 654, x + 298, y + 704, 44, '#6d7d88');
  drawRoadLine(ctx, x + 92, y + 488, x + 408, y + 488, 3, '#f8fbff', [18, 16]);
  drawRoadLine(ctx, x + 250, y + 450, x + 250, y + 716, 3, '#f8fbff', [18, 16]);
  drawRoadLine(ctx, x + 94, y + 654, x + 198, y + 699, 3, '#f8fbff', [14, 12]);
  drawRoadLine(ctx, x + 406, y + 654, x + 302, y + 699, 3, '#f8fbff', [14, 12]);
  drawCrosswalk(ctx, x + 250, y + 492, 46, 0);
  drawCrosswalk(ctx, x + 250, y + 620, 46, 0);
  drawCrosswalk(ctx, x + 154, y + 492, 44, Math.PI * 0.5);
  drawCrosswalk(ctx, x + 346, y + 492, 44, Math.PI * 0.5);

  ctx.fillStyle = '#d6ead7';
  ctx.beginPath();
  ctx.roundRect(x + 166, y + 552, 168, 104, 20);
  ctx.fill();
  ctx.fillStyle = '#f7f0db';
  ctx.beginPath();
  ctx.arc(x + 250, y + 602, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2fbcdc';
  ctx.beginPath();
  ctx.arc(x + 250, y + 602, 27, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.beginPath();
  ctx.arc(x + 250, y + 594, 8, 0, Math.PI * 2);
  ctx.fill();
  for (const [tx, ty] of [[180, 562], [320, 562], [176, 642], [324, 642]]) drawTree(ctx, x + tx, y + ty, 0.8);

  drawMiniDistrict(ctx, x, y);

  drawRoadLine(ctx, x + 86, y + 640, x + 420, y + 455, 20, '#f6c23d');
  drawRoadLine(ctx, x + 94, y + 636, x + 412, y + 460, 4, '#fff8c6', [16, 12]);
  drawPopPad(ctx, x + 122, y + 520, 17, '#f7c943');
  drawPopPad(ctx, x + 378, y + 520, 17, '#f7c943');
  drawPopPad(ctx, x + 164, y + 448, 17, '#49c7e5');
  drawPopPad(ctx, x + 336, y + 448, 17, '#ff6d63');

  drawGlassTower(ctx, x + 70, y + 526, 48, 72, '#f6c23d');
  drawGlassTower(ctx, x + 382, y + 526, 48, 72, '#f26d61');
  drawGlassTower(ctx, x + 72, y + 418, 42, 68, '#f6c23d');
  drawGlassTower(ctx, x + 386, y + 418, 42, 68, '#f26d61');
  drawTinyCar(ctx, x + 114, y + 478, '#ffcf45', 0);
  drawTinyCar(ctx, x + 386, y + 494, '#73d55f', Math.PI);
  drawTinyCar(ctx, x + 308, y + 676, '#fb6f62', 0.18);

  ctx.fillStyle = 'rgba(255,255,255,0.84)';
  ctx.beginPath();
  ctx.roundRect(x + 190, y + 724, 120, 48, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(47, 94, 118, 0.34)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#1c3548';
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.roundRect(x + 220 + i * 10, y + 752, 5, 18, 3);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 58, y + 66);
  ctx.lineTo(x + 442, y + 66);
  ctx.stroke();
}
function registerAtlasSprites(atlas) {
  atlas.pack('ball', 30, 30, (ctx, x, y, w) => { const r = w * 0.5; const g = ctx.createRadialGradient(x + r * 0.65, y + r * 0.6, 2, x + r, y + r, r); g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#d9f8ff'); g.addColorStop(1, '#4f9bc9'); ctx.fillStyle = THEME.shadow; ctx.beginPath(); ctx.arc(x + r + 1, y + r + 2, r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + r, y + r, r, 0, Math.PI * 2); ctx.fill(); });
  atlas.pack('flipper', 84, 20, (ctx, x, y) => {
    ctx.fillStyle = 'rgba(29, 55, 72, 0.26)';
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 4, 84, 15, 8);
    ctx.fill();
    const deck = ctx.createLinearGradient(x, y, x, y + 20);
    deck.addColorStop(0, '#ffffff');
    deck.addColorStop(0.48, '#dff6fb');
    deck.addColorStop(1, '#5abed6');
    ctx.fillStyle = deck;
    ctx.beginPath();
    ctx.roundRect(x, y, 84, 20, 10);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#2389a8';
    ctx.fillRect(x + 8, y + 14, 58, 3);
    ctx.fillStyle = 'rgba(246,194,61,0.78)';
    for (let i = 0; i < 5; i += 1) ctx.fillRect(x + 13 + i * 10, y + 4, 5, 2);
  });
  atlas.pack('wall', 20, 20, (ctx, x, y) => {
    const g = ctx.createLinearGradient(x, y, x + 20, y);
    g.addColorStop(0, '#2f6f8d');
    g.addColorStop(0.46, '#d9f6ff');
    g.addColorStop(1, '#2f6f8d');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 20, 20);
    ctx.fillStyle = 'rgba(255,255,255,.70)';
    ctx.fillRect(x + 4, y, 2, 20);
    ctx.fillStyle = 'rgba(20,55,74,.32)';
    ctx.fillRect(x + 16, y, 2, 20);
  });
  atlas.pack('building_base', 40, 40, (ctx, x, y, w, h) => drawTargetBase(ctx, x, y, w, h, false));
  atlas.pack('building_hit_base', 40, 40, (ctx, x, y, w, h) => drawTargetBase(ctx, x, y, w, h, true));
  for (const kind of ['residential', 'small', 'medium', 'commercial', 'public', 'danger', 'large']) atlas.pack(`zone_${kind}`, 40, 40, (c, x, y, w, h) => drawCityTile(c, x, y, w, h, kind));
  atlas.pack('building_house', 40, 40, (c, x, y, w, h) => drawHouseSprite(c, x, y, w, h));
  atlas.pack('building_convenience', 40, 40, (c, x, y, w, h) => drawConvenienceSprite(c, x, y, w, h));
  atlas.pack('building_apartment', 40, 80, (c, x, y, w, h) => drawApartmentSprite(c, x, y, w, h));
  atlas.pack('building_gas', 80, 40, (c, x, y, w, h) => drawGasSprite(c, x, y, w, h));
  atlas.pack('building_tower', 80, 80, (c, x, y, w, h) => drawTowerSprite(c, x, y, w, h));
  atlas.pack('exp_orb', 20, 20, (c, x, y, w) => { const r = w * 0.5; const g = c.createRadialGradient(x + r, y + r, 1, x + r, y + r, r); g.addColorStop(0, '#fffbe5'); g.addColorStop(1, '#ffbd4f'); c.fillStyle = g; c.beginPath(); c.arc(x + r, y + r, r, 0, Math.PI * 2); c.fill(); });
  atlas.pack('playfield', WORLD.w, WORLD.h, (ctx, x, y, w, h) => drawPlayfieldSprite(ctx, x, y, w, h));
}

const REDESIGN_ZONE = {
  residential: { base: '#98bf75', floor: '#6f9f5e', ink: '#1b2a20', accent: '#f3c15e' },
  small: { base: '#bcb6a6', floor: '#898c86', ink: '#25292b', accent: '#f0cf54' },
  medium: { base: '#a6b7be', floor: '#788b91', ink: '#1f2d33', accent: '#eef4ea' },
  commercial: { base: '#cfae63', floor: '#ad7049', ink: '#2b2118', accent: '#f5d54a' },
  public: { base: '#8fbd72', floor: '#5f8a5d', ink: '#1f3222', accent: '#f2e5c0' },
  danger: { base: '#9b896d', floor: '#3b3e3a', ink: '#15191a', accent: '#f2c53b' },
  large: { base: '#92aab7', floor: '#566e78', ink: '#16232a', accent: '#d7f1ff' },
};
function redesignZone(kind) { return REDESIGN_ZONE[kind] || REDESIGN_ZONE.small; }
function drawBlockShadow(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 4, y + 5, w, h);
}
function drawBlock(ctx, x, y, w, h, fill, stroke = '#101820', hi = 'rgba(255,255,255,0.25)') {
  drawBlockShadow(ctx, x, y, w, h);
  ctx.fillStyle = stroke;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
  ctx.fillStyle = hi;
  ctx.fillRect(x + 5, y + 5, w - 10, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(x + 5, y + h - 7, w - 10, 2);
}
function drawBlockWindows(ctx, x, y, cols, rows, color = '#f4f1d0') {
  ctx.fillStyle = color;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) ctx.fillRect(x + col * 8, y + row * 8, 4, 4);
  }
}
function drawHazardStripe(ctx, x, y, w, h, step = 10) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#f3c63d';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#1a1d1e';
  ctx.lineWidth = 4;
  for (let i = -h; i < w + h; i += step) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();
}
function drawMiniTree(ctx, x, y, scale = 1) {
  ctx.fillStyle = '#2c4a2f';
  ctx.fillRect(x - 1 * scale, y + 2 * scale, 2 * scale, 8 * scale);
  ctx.fillStyle = '#5fa85c';
  ctx.beginPath();
  ctx.arc(x, y, 6 * scale, 0, Math.PI * 2);
  ctx.arc(x - 4 * scale, y + 4 * scale, 5 * scale, 0, Math.PI * 2);
  ctx.arc(x + 5 * scale, y + 4 * scale, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d9f3a4';
  ctx.fillRect(x - 2 * scale, y - 2 * scale, 2 * scale, 2 * scale);
}
function drawFreshRoad(ctx, x1, y1, x2, y2, width, center = false) {
  drawRoadLine(ctx, x1, y1, x2, y2, width + 5, '#151b1e');
  drawRoadLine(ctx, x1, y1, x2, y2, width, '#4f5658');
  if (center) drawRoadLine(ctx, x1, y1, x2, y2, 2, '#f0d65c', [16, 12]);
}
function drawFreshCrosswalk(ctx, x, y, w, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#f3f0dd';
  for (let i = -3; i <= 3; i += 1) ctx.fillRect(i * 7 - 2, -w * 0.5, 4, w);
  ctx.restore();
}
function drawParcelIcon(ctx, x, y, kind) {
  const z = redesignZone(kind);
  if (kind === 'danger') {
    drawHazardStripe(ctx, x + 6, y + 8, 20, 18, 9);
    ctx.fillStyle = '#1d2223';
    ctx.fillRect(x + 12, y + 15, 8, 5);
    return;
  }
  if (kind === 'public') {
    ctx.fillStyle = '#3f7f4a';
    ctx.fillRect(x + 5, y + 18, 22, 8);
    drawMiniTree(ctx, x + 12, y + 14, 0.65);
    drawMiniTree(ctx, x + 22, y + 17, 0.55);
    ctx.fillStyle = '#efe2b7';
    ctx.fillRect(x + 6, y + 23, 20, 2);
    return;
  }
  if (kind === 'large') {
    drawBlock(ctx, x + 6, y + 6, 8, 21, '#6f8794', '#16232a');
    drawBlock(ctx, x + 17, y + 2, 10, 25, '#7896a4', '#16232a');
    ctx.fillStyle = '#e9f9ff';
    for (let yy = y + 8; yy < y + 24; yy += 7) {
      ctx.fillRect(x + 9, yy, 3, 2);
      ctx.fillRect(x + 20, yy - 2, 4, 2);
    }
    return;
  }
  if (kind === 'commercial') {
    ctx.fillStyle = '#27211b';
    ctx.fillRect(x + 6, y + 12, 22, 15);
    ctx.fillStyle = z.accent;
    ctx.fillRect(x + 6, y + 8, 22, 6);
    ctx.fillStyle = '#f8efe0';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(x + 8 + i * 5, y + 15, 3, 5);
    return;
  }
  if (kind === 'residential') {
    ctx.fillStyle = '#202a21';
    ctx.fillRect(x + 7, y + 15, 20, 12);
    ctx.fillStyle = '#e7c05f';
    ctx.fillRect(x + 9, y + 13, 16, 4);
    ctx.fillStyle = '#dce9d4';
    ctx.fillRect(x + 11, y + 17, 5, 4);
    ctx.fillRect(x + 19, y + 17, 5, 4);
    return;
  }
  ctx.fillStyle = z.ink;
  ctx.fillRect(x + 9, y + 10, 16, 17);
  ctx.fillStyle = z.accent;
  ctx.fillRect(x + 11, y + 13, 12, 3);
  ctx.fillRect(x + 11, y + 20, 12, 3);
}
drawUrbanCellIcon = function drawUrbanCellIconRedesign(ctx, x, y, kind) {
  drawParcelIcon(ctx, x, y, kind);
};
drawMiniDistrict = function drawMiniDistrictRedesign(ctx, x, y) {
  const gx = x + GRID.left;
  const gy = y + GRID.top;
  const gw = GRID.width;
  const gh = GRID.height;

  ctx.fillStyle = '#101820';
  ctx.fillRect(gx - 18, gy - 18, gw + 36, gh + 36);
  ctx.fillStyle = '#3e4647';
  ctx.fillRect(gx - 12, gy - 12, gw + 24, gh + 24);

  for (let row = 0; row < GRID.rows; row += 1) {
    for (let col = 0; col < GRID.cols; col += 1) {
      const kind = ZONE_TEMPLATE[row][col];
      const z = redesignZone(kind);
      const lx = gx + col * GRID.cellSize + 4;
      const ly = gy + row * GRID.cellSize + 4;
      ctx.fillStyle = '#182023';
      ctx.fillRect(lx + 2, ly + 3, 32, 32);
      ctx.fillStyle = z.base;
      ctx.fillRect(lx, ly, 32, 32);
      ctx.fillStyle = z.floor;
      ctx.fillRect(lx + 4, ly + 5, 24, 22);
      drawPavingGrid(ctx, lx + 4, ly + 5, 24, 22, 'rgba(255,255,255,0.16)', 8);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(lx, ly + 29, 32, 3);
      ctx.strokeStyle = '#20282b';
      ctx.lineWidth = 2;
      ctx.strokeRect(lx, ly, 32, 32);
      if (kind === 'public' || kind === 'danger' || (row + col) % 4 === 0) {
        ctx.save();
        ctx.globalAlpha = kind === 'danger' ? 0.42 : 0.30;
        drawParcelIcon(ctx, lx, ly, kind);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(18, 24, 28, 0.20)';
        ctx.fillRect(lx + 10, ly + 12, 12, 3);
        ctx.fillRect(lx + 8, ly + 20, 16, 3);
      }
    }
  }

  for (let i = 0; i <= GRID.cols; i += 1) {
    const px = gx + i * GRID.cellSize;
    drawRoadLine(ctx, px, gy - 12, px, gy + gh + 12, i === 0 || i === GRID.cols ? 5 : 8, '#171d20');
    if (i > 0 && i < GRID.cols) drawRoadLine(ctx, px, gy - 6, px, gy + gh + 6, 2, '#e9cf58', [13, 12]);
  }
  for (let i = 0; i <= GRID.rows; i += 1) {
    const py = gy + i * GRID.cellSize;
    drawRoadLine(ctx, gx - 12, py, gx + gw + 12, py, i === 0 || i === GRID.rows ? 5 : 8, '#171d20');
    if (i > 0 && i < GRID.rows) drawRoadLine(ctx, gx - 6, py, gx + gw + 6, 2, '#e9cf58', [13, 12]);
  }
  for (const [cx, cy, rot] of [
    [gx + 120, gy + 80, 0], [gx + 200, gy + 200, 0], [gx + 120, gy + 200, Math.PI * 0.5],
    [gx + 280, gy + 80, Math.PI * 0.5], [gx + 280, gy + 200, 0],
  ]) drawFreshCrosswalk(ctx, cx, cy, 28, rot);

  drawTinyCar(ctx, gx + 62, gy + 82, '#f0c844', 0);
  drawTinyCar(ctx, gx + 258, gy + 204, '#dc5b45', Math.PI);
  drawTinyCar(ctx, gx + 205, gy + 124, '#73bed0', Math.PI * 0.5);

  ctx.strokeStyle = '#f5ead1';
  ctx.lineWidth = 3;
  ctx.strokeRect(gx - 16, gy - 16, gw + 32, gh + 32);
  ctx.strokeStyle = '#101820';
  ctx.lineWidth = 2;
  ctx.strokeRect(gx - 20, gy - 20, gw + 40, gh + 40);
};
drawCityTile = function drawCityTileRedesign(ctx, x, y, w, h, kind) {
  const z = redesignZone(kind);
  ctx.fillStyle = '#171d20';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = z.base;
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
  ctx.fillStyle = z.floor;
  ctx.fillRect(x + 7, y + 8, w - 14, h - 14);
  drawPavingGrid(ctx, x + 7, y + 8, w - 14, h - 14, 'rgba(255,255,255,0.14)', 8);
  drawParcelIcon(ctx, x + 4, y + 4, kind);
};
function drawFreshFacade(ctx, x, y, w, h, fill, roof, accent) {
  drawBlock(ctx, x, y, w, h, fill, '#101820');
  ctx.fillStyle = roof;
  ctx.fillRect(x + 3, y + 3, w - 6, 7);
  ctx.fillStyle = accent;
  ctx.fillRect(x + 6, y + 11, w - 12, 4);
  ctx.fillStyle = '#f3f0d4';
}
drawHouseSprite = function drawHouseSpriteRedesign(ctx, x, y, w, h) {
  drawFreshFacade(ctx, x + 4, y + 7, w - 8, h - 8, '#d6cfaa', '#b24f42', '#f0c75a');
  ctx.fillStyle = '#101820';
  ctx.fillRect(x + 15, y + 25, 8, 10);
  ctx.fillStyle = '#e9f4ee';
  ctx.fillRect(x + 9, y + 18, 6, 5);
  ctx.fillRect(x + 25, y + 18, 6, 5);
  drawMiniTree(ctx, x + 33, y + 12, 0.55);
};
drawConvenienceSprite = function drawConvenienceSpriteRedesign(ctx, x, y, w, h) {
  drawFreshFacade(ctx, x + 3, y + 10, w - 6, h - 9, '#e6dcc6', '#176a8a', '#f6cf42');
  ctx.fillStyle = '#e95643';
  ctx.fillRect(x + 3, y + 17, w - 6, 3);
  ctx.fillStyle = '#101820';
  ctx.fillRect(x + 14, y + 24, 10, 9);
  ctx.fillStyle = '#8ed4e0';
  ctx.fillRect(x + 6, y + 24, 7, 9);
  ctx.fillRect(x + w - 13, y + 24, 7, 9);
  ctx.fillStyle = '#f5f1d4';
  ctx.font = '700 7px monospace';
  ctx.fillText('24', x + 14, y + 16);
};
drawApartmentSprite = function drawApartmentSpriteRedesign(ctx, x, y, w, h) {
  drawFreshFacade(ctx, x + 4, y + 5, w - 8, h - 7, '#8ba2a8', '#4d6269', '#f1d76a');
  drawBlockWindows(ctx, x + 10, y + 16, 3, 6, '#eef4df');
  ctx.fillStyle = '#25343a';
  for (let yy = y + 22; yy < y + h - 14; yy += 13) ctx.fillRect(x + 8, yy, w - 16, 2);
  ctx.fillStyle = '#101820';
  ctx.fillRect(x + 17, y + h - 17, 8, 10);
};
drawGasSprite = function drawGasSpriteRedesign(ctx, x, y, w, h) {
  drawBlock(ctx, x + 5, y + 17, w - 10, h - 12, '#d8d0b8', '#101820');
  drawHazardStripe(ctx, x + 9, y + 9, w - 18, 9, 10);
  ctx.fillStyle = '#f5edd4';
  ctx.fillRect(x + 16, y + 24, 12, 11);
  ctx.fillRect(x + w - 28, y + 24, 12, 11);
  ctx.fillStyle = '#e34f3d';
  ctx.fillRect(x + 20, y + 20, w - 40, 4);
  ctx.fillStyle = '#101820';
  ctx.font = '700 8px monospace';
  ctx.fillText('GAS', x + w * 0.5 - 10, y + 17);
};
drawTowerSprite = function drawTowerSpriteRedesign(ctx, x, y, w, h) {
  drawBlock(ctx, x + 10, y + 4, w - 20, h - 8, '#6f8794', '#101820');
  ctx.fillStyle = '#a8d3df';
  ctx.fillRect(x + 17, y + 9, 13, h - 18);
  drawBlockWindows(ctx, x + 34, y + 13, 3, 7, '#ecf4dc');
  ctx.fillStyle = '#e9cf58';
  ctx.fillRect(x + 22, y + 2, w - 44, 5);
  ctx.fillStyle = '#28383f';
  ctx.fillRect(x + 16, y + h - 13, w - 32, 5);
};
drawPlayfieldSprite = function drawPlayfieldSpriteRedesign(ctx, x, y, w, h) {
  ctx.fillStyle = '#101820';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#26343a';
  ctx.fillRect(x + 15, y + 15, w - 30, h - 30);
  ctx.fillStyle = '#50624d';
  ctx.fillRect(x + 31, y + 31, w - 62, h - 62);
  ctx.fillStyle = '#b7b09b';
  ctx.fillRect(x + 40, y + 46, w - 80, h - 86);
  drawPavingGrid(ctx, x + 40, y + 46, w - 80, h - 86, 'rgba(255,255,255,0.10)', 20);

  ctx.fillStyle = '#142028';
  ctx.fillRect(x + 25, y + 25, 10, 740);
  ctx.fillRect(x + 465, y + 25, 10, 740);
  ctx.fillRect(x + 25, y + 25, 450, 10);
  ctx.fillStyle = '#f0d65c';
  ctx.fillRect(x + 27, y + 54, 4, 70);
  ctx.fillRect(x + 469, y + 54, 4, 70);
  for (let yy = 146; yy < 720; yy += 74) {
    ctx.fillStyle = yy % 148 === 0 ? '#f0d65c' : '#6e93a1';
    ctx.fillRect(x + 28, y + yy, 4, 34);
    ctx.fillRect(x + 468, y + yy, 4, 34);
  }

  drawMiniDistrict(ctx, x, y);

  drawFreshRoad(ctx, x + 70, y + 488, x + 430, y + 488, 54, true);
  drawFreshRoad(ctx, x + 250, y + 430, x + 250, y + 736, 52, true);
  drawFreshCrosswalk(ctx, x + 250, y + 488, 46, 0);
  drawFreshCrosswalk(ctx, x + 154, y + 488, 42, Math.PI * 0.5);
  drawFreshCrosswalk(ctx, x + 346, y + 488, 42, Math.PI * 0.5);

  ctx.fillStyle = '#7fb371';
  ctx.fillRect(x + 174, y + 545, 152, 102);
  ctx.fillStyle = '#d9c89f';
  ctx.fillRect(x + 186, y + 556, 128, 80);
  ctx.fillStyle = '#3aa1c7';
  ctx.beginPath();
  ctx.arc(x + 250, y + 598, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d8eff6';
  ctx.beginPath();
  ctx.arc(x + 250, y + 591, 8, 0, Math.PI * 2);
  ctx.fill();
  for (const [tx, ty] of [[184, 558], [315, 560], [186, 634], [314, 634]]) drawMiniTree(ctx, x + tx, y + ty, 0.8);

  drawFreshRoad(ctx, x + 86, y + 640, x + 420, y + 455, 22, false);
  drawRoadLine(ctx, x + 90, y + 639, x + 416, y + 458, 4, '#f2d85e', [18, 13]);

  drawFreshRoad(ctx, x + 25, y + 620, x + 160, y + 704, 26, false);
  drawFreshRoad(ctx, x + 475, y + 620, x + 340, y + 704, 26, false);
  drawRoadLine(ctx, x + 46, y + 633, x + 154, y + 700, 3, '#f0d65c', [12, 9]);
  drawRoadLine(ctx, x + 454, y + 633, x + 346, y + 700, 3, '#f0d65c', [12, 9]);

  drawPopPad(ctx, x + 122, y + 520, 16, '#f1c83c');
  drawPopPad(ctx, x + 378, y + 520, 16, '#ef5945');
  drawPopPad(ctx, x + 164, y + 448, 15, '#82cbd3');
  drawPopPad(ctx, x + 336, y + 448, 15, '#f1c83c');

  drawGlassTower(ctx, x + 68, y + 526, 50, 70, '#f1c83c');
  drawGlassTower(ctx, x + 382, y + 526, 50, 70, '#ef5945');
  drawGlassTower(ctx, x + 70, y + 418, 42, 66, '#f1c83c');
  drawGlassTower(ctx, x + 388, y + 418, 42, 66, '#82cbd3');
  drawTinyCar(ctx, x + 116, y + 478, '#f0c844', 0);
  drawTinyCar(ctx, x + 386, y + 496, '#73bed0', Math.PI);
  drawTinyCar(ctx, x + 309, y + 678, '#dc5b45', 0.18);

  ctx.fillStyle = '#0f1518';
  ctx.fillRect(x + 216, y + 742, 68, 34);
  ctx.fillStyle = '#2e3a3d';
  ctx.fillRect(x + 222, y + 748, 56, 22);
  ctx.fillStyle = '#111820';
  for (let i = 0; i < 7; i += 1) ctx.fillRect(x + 228 + i * 7, y + 750, 4, 18);
  ctx.fillStyle = '#f0d65c';
  ctx.fillRect(x + 218, y + 739, 64, 4);
  ctx.fillRect(x + 218, y + 775, 64, 4);

  ctx.fillStyle = '#142028';
  ctx.fillRect(x + 408, y + 566, 42, 154);
  ctx.fillStyle = '#f0d65c';
  for (let yy = 584; yy < 704; yy += 24) ctx.fillRect(x + 426, y + yy, 7, 12);

  ctx.strokeStyle = '#f5ead1';
  ctx.lineWidth = 4;
  ctx.strokeRect(x + 40, y + 46, w - 80, h - 86);
  ctx.strokeStyle = '#101820';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 17, y + 17, w - 34, h - 34);
};
registerAtlasSprites = function registerAtlasSpritesRedesign(atlas) {
  atlas.pack('ball', 30, 30, (ctx, x, y, w) => {
    const r = w * 0.5;
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.arc(x + r + 2, y + r + 3, r - 1, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(x + r * 0.65, y + r * 0.55, 2, x + r, y + r, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#dfe7e8');
    g.addColorStop(1, '#6f7c82');
    ctx.fillStyle = '#101820';
    ctx.beginPath();
    ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x + r, y + r, r - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0d65c';
    ctx.fillRect(x + 8, y + 6, 5, 3);
  });
  atlas.pack('flipper', 84, 20, (ctx, x, y) => {
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(x + 4, y + 5, 80, 14);
    ctx.fillStyle = '#101820';
    ctx.beginPath();
    ctx.moveTo(x, y + 5);
    ctx.lineTo(x + 76, y + 1);
    ctx.lineTo(x + 84, y + 10);
    ctx.lineTo(x + 76, y + 19);
    ctx.lineTo(x, y + 15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f7f5e8';
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 7);
    ctx.lineTo(x + 72, y + 4);
    ctx.lineTo(x + 78, y + 10);
    ctx.lineTo(x + 72, y + 16);
    ctx.lineTo(x + 4, y + 13);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6fb4c3';
    ctx.fillRect(x + 10, y + 12, 56, 3);
    drawHazardStripe(ctx, x + 14, y + 5, 42, 4, 10);
  });
  atlas.pack('wall', 20, 20, (ctx, x, y) => {
    ctx.fillStyle = '#101820';
    ctx.fillRect(x, y, 20, 20);
    ctx.fillStyle = '#34464e';
    ctx.fillRect(x + 3, y, 14, 20);
    ctx.fillStyle = '#f0d65c';
    ctx.fillRect(x + 5, y + 2, 4, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.fillRect(x + 12, y, 2, 20);
  });
  atlas.pack('building_base', 40, 40, (ctx, x, y, w, h) => drawTargetBase(ctx, x, y, w, h, false));
  atlas.pack('building_hit_base', 40, 40, (ctx, x, y, w, h) => drawTargetBase(ctx, x, y, w, h, true));
  for (const kind of ['residential', 'small', 'medium', 'commercial', 'public', 'danger', 'large']) atlas.pack(`zone_${kind}`, 40, 40, (c, x, y, w, h) => drawCityTile(c, x, y, w, h, kind));
  atlas.pack('building_house', 40, 40, (c, x, y, w, h) => drawHouseSprite(c, x, y, w, h));
  atlas.pack('building_convenience', 40, 40, (c, x, y, w, h) => drawConvenienceSprite(c, x, y, w, h));
  atlas.pack('building_apartment', 40, 80, (c, x, y, w, h) => drawApartmentSprite(c, x, y, w, h));
  atlas.pack('building_gas', 80, 40, (c, x, y, w, h) => drawGasSprite(c, x, y, w, h));
  atlas.pack('building_tower', 80, 80, (c, x, y, w, h) => drawTowerSprite(c, x, y, w, h));
  atlas.pack('exp_orb', 20, 20, (c, x, y, w) => {
    const r = w * 0.5;
    c.fillStyle = '#101820';
    c.fillRect(x + 2, y + 2, 16, 16);
    c.fillStyle = '#f0d65c';
    c.fillRect(x + 5, y + 5, 10, 10);
    c.fillStyle = '#fff7b7';
    c.fillRect(x + 7, y + 3, 6, 14);
    c.fillRect(x + 3, y + 7, 14, 6);
    c.fillStyle = 'rgba(255,255,255,0.70)';
    c.beginPath();
    c.arc(x + r, y + r, 3, 0, Math.PI * 2);
    c.fill();
  });
  atlas.pack('playfield', WORLD.w, WORLD.h, (ctx, x, y, w, h) => drawPlayfieldSprite(ctx, x, y, w, h));
};

const CASUAL_CITY = {
  skyTop: '#8edcff',
  skyBottom: '#f6fbff',
  board: '#f7f1dc',
  boardInset: '#fffaf0',
  boardEdge: '#4bb3d8',
  rail: '#2e6b86',
  road: '#65737d',
  roadDark: '#40515a',
  roadLine: '#fff2a6',
  sidewalk: '#eef1ea',
  water: '#4fc3e8',
  ramp: '#ffc94c',
  grass: '#78c96b',
  plaza: '#efdcae',
  ink: '#173244',
  shadow: 'rgba(25, 63, 88, 0.22)',
  zones: {
    residential: { lot: '#b9e6bb', tint: '#eaf8e4', accent: '#ff8d7a' },
    small: { lot: '#e5ecf2', tint: '#f9fbff', accent: '#ffd25c' },
    medium: { lot: '#d7e6f2', tint: '#f4fbff', accent: '#6cc6e7' },
    commercial: { lot: '#ffe2a2', tint: '#fff4d4', accent: '#ffb84f' },
    public: { lot: '#b9e8b1', tint: '#ecfae7', accent: '#52b56b' },
    danger: { lot: '#ffd5b7', tint: '#fff0de', accent: '#ff7d52' },
    large: { lot: '#cde7f8', tint: '#f1fbff', accent: '#4db9df' },
  },
};
function zoneLook(kind) { return CASUAL_CITY.zones[kind] || CASUAL_CITY.zones.small; }
function softRoundRect(ctx, x, y, w, h, r, fill, stroke = null, line = 1) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = line;
    ctx.stroke();
  }
}
function softBlobShadow(ctx, cx, cy, rx, ry, alpha = 0.18) {
  ctx.fillStyle = `rgba(31, 70, 92, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}
function casualRoad(ctx, x1, y1, x2, y2, width, dash = true) {
  drawRoadLine(ctx, x1, y1, x2, y2, width + 10, CASUAL_CITY.sidewalk);
  drawRoadLine(ctx, x1, y1, x2, y2, width, CASUAL_CITY.road);
  if (dash) drawRoadLine(ctx, x1, y1, x2, y2, 3, CASUAL_CITY.roadLine, [18, 16]);
}
function casualCrosswalk(ctx, x, y, length, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(255,255,255,0.86)';
  for (let i = -3; i <= 3; i += 1) ctx.fillRect(i * 8 - 2, -length * 0.5, 4, length);
  ctx.restore();
}
function casualTree(ctx, x, y, scale = 1) {
  ctx.fillStyle = 'rgba(47, 91, 63, 0.20)';
  ctx.beginPath();
  ctx.ellipse(x + 2 * scale, y + 8 * scale, 9 * scale, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6eb35f';
  ctx.beginPath();
  ctx.arc(x, y, 7 * scale, 0, Math.PI * 2);
  ctx.arc(x - 5 * scale, y + 5 * scale, 6 * scale, 0, Math.PI * 2);
  ctx.arc(x + 6 * scale, y + 5 * scale, 6 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5d8f42';
  ctx.fillRect(x - 1 * scale, y + 7 * scale, 3 * scale, 7 * scale);
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.beginPath();
  ctx.arc(x - 3 * scale, y - 2 * scale, 2 * scale, 0, Math.PI * 2);
  ctx.fill();
}
function casualCar(ctx, x, y, color, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  softBlobShadow(ctx, 1, 4, 10, 4, 0.16);
  softRoundRect(ctx, -9, -6, 18, 11, 5, color);
  softRoundRect(ctx, -4, -5, 8, 4, 2, 'rgba(255,255,255,0.72)');
  ctx.fillStyle = 'rgba(30,56,75,0.25)';
  ctx.fillRect(-7, 3, 14, 2);
  ctx.restore();
}
function drawLotTexture(ctx, x, y, w, h, kind, row, col) {
  const z = zoneLook(kind);
  softRoundRect(ctx, x, y, w, h, 6, z.lot, 'rgba(68, 111, 132, 0.22)', 1);
  ctx.fillStyle = z.tint;
  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 4, w - 8, h - 8, 4);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (kind === 'public') {
    casualTree(ctx, x + w * 0.36, y + h * 0.42, 0.46);
    casualTree(ctx, x + w * 0.66, y + h * 0.56, 0.40);
    ctx.strokeStyle = 'rgba(255,255,255,0.70)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + h - 8);
    ctx.lineTo(x + w - 7, y + 8);
    ctx.stroke();
    return;
  }
  if (kind === 'danger') {
    ctx.fillStyle = 'rgba(255, 125, 82, 0.32)';
    ctx.fillRect(x + 7, y + 7, w - 14, h - 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.76)';
    ctx.lineWidth = 2;
    for (let i = -8; i < w + 8; i += 10) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + h - 6);
      ctx.lineTo(x + i + 18, y + 6);
      ctx.stroke();
    }
    return;
  }
  ctx.fillStyle = z.accent;
  if (kind === 'large') {
    ctx.fillRect(x + 10, y + 9, 6, 18);
    ctx.fillRect(x + 19, y + 6, 8, 21);
  } else if (kind === 'commercial') {
    ctx.fillRect(x + 8, y + 12, 19, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillRect(x + 9, y + 18, 17, 5);
  } else if (kind === 'residential') {
    ctx.beginPath();
    ctx.moveTo(x + 9, y + 18);
    ctx.lineTo(x + 18, y + 10);
    ctx.lineTo(x + 27, y + 18);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x + 10, y + 18, 16, 9);
  } else if ((row + col) % 3 === 0) {
    ctx.fillRect(x + 10, y + 13, 16, 11);
  } else {
    ctx.fillStyle = 'rgba(77, 120, 143, 0.20)';
    ctx.fillRect(x + 9, y + 13, 18, 4);
    ctx.fillRect(x + 12, y + 21, 12, 4);
  }
}
drawTargetBase = function drawTargetBaseCasual(ctx, x, y, w, h, hot = false) {
  softBlobShadow(ctx, x + w * 0.53, y + h * 0.68, w * 0.48, h * 0.20, hot ? 0.30 : 0.20);
  softRoundRect(ctx, x + 2, y + 2, w - 4, h - 5, 9, hot ? '#fff2b4' : '#ffffff', hot ? '#ff9d4a' : '#68b9d6', hot ? 3 : 2);
  ctx.fillStyle = hot ? 'rgba(255,157,74,0.24)' : 'rgba(104,185,214,0.12)';
  ctx.fillRect(x + 8, y + h - 12, w - 16, 4);
  ctx.fillStyle = hot ? '#ff7758' : '#ffc94c';
  ctx.fillRect(x + 8, y + 8, 9, 4);
  ctx.fillRect(x + w - 17, y + 8, 9, 4);
};
drawMiniDistrict = function drawMiniDistrictCasual(ctx, x, y) {
  const gx = x + GRID.left;
  const gy = y + GRID.top;
  const gw = GRID.width;
  const gh = GRID.height;

  softBlobShadow(ctx, gx + gw * 0.5, gy + gh * 0.55, gw * 0.58, gh * 0.09, 0.14);
  softRoundRect(ctx, gx - 22, gy - 22, gw + 44, gh + 44, 20, 'rgba(255,255,255,0.62)', 'rgba(79,156,190,0.32)', 2);
  softRoundRect(ctx, gx - 13, gy - 13, gw + 26, gh + 26, 14, '#dfe9e7');

  ctx.fillStyle = '#ccd9dc';
  ctx.fillRect(gx - 4, gy - 4, gw + 8, gh + 8);
  for (let row = 0; row < GRID.rows; row += 1) {
    for (let col = 0; col < GRID.cols; col += 1) {
      const lx = gx + col * GRID.cellSize + 5;
      const ly = gy + row * GRID.cellSize + 5;
      drawLotTexture(ctx, lx, ly, 30, 30, ZONE_TEMPLATE[row][col], row, col);
    }
  }
  for (let i = 0; i <= GRID.cols; i += 1) {
    const px = gx + i * GRID.cellSize;
    drawRoadLine(ctx, px, gy - 7, px, gy + gh + 7, i === 0 || i === GRID.cols ? 6 : 7, '#aab8bd');
    if (i > 0 && i < GRID.cols) drawRoadLine(ctx, px, gy + 3, px, gy + gh - 3, 1.5, '#ffffff', [8, 10]);
  }
  for (let i = 0; i <= GRID.rows; i += 1) {
    const py = gy + i * GRID.cellSize;
    drawRoadLine(ctx, gx - 7, py, gx + gw + 7, py, i === 0 || i === GRID.rows ? 6 : 7, '#aab8bd');
    if (i > 0 && i < GRID.rows) drawRoadLine(ctx, gx + 3, py, gx + gw - 3, 1.5, '#ffffff', [8, 10]);
  }

  casualCrosswalk(ctx, gx + 120, gy + 80, 24, Math.PI * 0.5);
  casualCrosswalk(ctx, gx + 200, gy + 200, 24, 0);
  casualCrosswalk(ctx, gx + 280, gy + 80, 24, Math.PI * 0.5);
  casualCar(ctx, gx + 63, gy + 82, '#ffd05f', 0);
  casualCar(ctx, gx + 264, gy + 204, '#ff7a68', Math.PI);
  casualCar(ctx, gx + 205, gy + 122, '#65c8e8', Math.PI * 0.5);

  softRoundRect(ctx, gx - 23, gy - 23, gw + 46, gh + 46, 20, 'rgba(255,255,255,0)', 'rgba(255,255,255,0.78)', 3);
};
drawCityTile = function drawCityTileCasual(ctx, x, y, w, h, kind) {
  drawLotTexture(ctx, x + 2, y + 2, w - 4, h - 4, kind, 0, 0);
};
function drawCasualBuildingBody(ctx, x, y, w, h, body, roof, accent) {
  softBlobShadow(ctx, x + w * 0.56, y + h - 6, w * 0.34, 6, 0.22);
  softRoundRect(ctx, x + 4, y + 9, w - 8, h - 11, 7, body, '#25647d', 2);
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.roundRect(x + 7, y + 5, w - 14, 10, 5);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(x + 10, y + 18, w - 20, 5);
}
drawHouseSprite = function drawHouseSpriteCasual(ctx, x, y, w, h) {
  drawCasualBuildingBody(ctx, x, y, w, h, '#fff2d0', '#ff866d', '#ffc94c');
  ctx.fillStyle = '#6bbfe2';
  ctx.fillRect(x + 10, y + 24, 6, 5);
  ctx.fillRect(x + 24, y + 24, 6, 5);
  ctx.fillStyle = '#31576b';
  ctx.fillRect(x + 17, y + 29, 7, 8);
  casualTree(ctx, x + 31, y + 14, 0.46);
};
drawConvenienceSprite = function drawConvenienceSpriteCasual(ctx, x, y, w, h) {
  drawCasualBuildingBody(ctx, x, y, w, h, '#ffffff', '#4bb3d8', '#ff755f');
  ctx.fillStyle = '#ffd05f';
  ctx.fillRect(x + 7, y + 17, w - 14, 3);
  ctx.fillStyle = '#70c9e6';
  softRoundRect(ctx, x + 8, y + 25, 8, 10, 2, '#70c9e6');
  softRoundRect(ctx, x + w - 16, y + 25, 8, 10, 2, '#70c9e6');
  ctx.fillStyle = '#31576b';
  ctx.font = '700 8px system-ui';
  ctx.fillText('24', x + 14, y + 16);
};
drawApartmentSprite = function drawApartmentSpriteCasual(ctx, x, y, w, h) {
  drawCasualBuildingBody(ctx, x, y, w, h, '#bfe4f2', '#62a9c5', '#ffffff');
  ctx.fillStyle = '#f9feff';
  for (let yy = y + 24; yy < y + h - 13; yy += 10) {
    ctx.fillRect(x + 10, yy, 5, 4);
    ctx.fillRect(x + 19, yy, 5, 4);
    ctx.fillRect(x + 28, yy, 5, 4);
  }
  ctx.fillStyle = '#31576b';
  ctx.fillRect(x + 17, y + h - 15, 7, 9);
};
drawGasSprite = function drawGasSpriteCasual(ctx, x, y, w, h) {
  softBlobShadow(ctx, x + w * 0.52, y + h - 6, w * 0.38, 6, 0.22);
  softRoundRect(ctx, x + 6, y + 18, w - 12, h - 11, 8, '#fff3d6', '#25647d', 2);
  softRoundRect(ctx, x + 12, y + 9, w - 24, 13, 7, '#ff755f');
  ctx.fillStyle = '#ffc94c';
  ctx.fillRect(x + 17, y + 14, w - 34, 4);
  ctx.fillStyle = '#4bb3d8';
  softRoundRect(ctx, x + 14, y + 26, 12, 12, 4, '#4bb3d8');
  softRoundRect(ctx, x + w - 26, y + 26, 12, 12, 4, '#4bb3d8');
  ctx.fillStyle = '#31576b';
  ctx.font = '700 8px system-ui';
  ctx.fillText('GAS', x + w * 0.5 - 10, y + 19);
};
drawTowerSprite = function drawTowerSpriteCasual(ctx, x, y, w, h) {
  softBlobShadow(ctx, x + w * 0.54, y + h - 7, w * 0.35, 7, 0.22);
  softRoundRect(ctx, x + 11, y + 5, w - 22, h - 9, 10, '#95d6ee', '#25647d', 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.roundRect(x + 18, y + 10, 13, h - 20, 6);
  ctx.fill();
  ctx.fillStyle = '#f9feff';
  for (let yy = y + 18; yy < y + h - 14; yy += 10) {
    ctx.fillRect(x + 36, yy, 5, 4);
    ctx.fillRect(x + 47, yy, 5, 4);
    ctx.fillRect(x + 58, yy, 5, 4);
  }
  softRoundRect(ctx, x + 23, y + 2, w - 46, 8, 4, '#ffc94c');
};
drawGlassTower = function drawGlassTowerCasual(ctx, x, y, w, h, accent = '#ffc94c') {
  softBlobShadow(ctx, x + w * 0.55, y + h - 5, w * 0.42, 6, 0.18);
  softRoundRect(ctx, x, y, w, h, 10, '#8bd0ea', '#2d7997', 2);
  ctx.fillStyle = 'rgba(255,255,255,0.50)';
  ctx.beginPath();
  ctx.roundRect(x + 8, y + 8, w * 0.32, h - 16, 8);
  ctx.fill();
  ctx.fillStyle = '#f8feff';
  for (let yy = y + 14; yy < y + h - 12; yy += 13) {
    ctx.fillRect(x + w - 16, yy, 5, 4);
    ctx.fillRect(x + w - 27, yy + 4, 5, 4);
  }
  softRoundRect(ctx, x + w * 0.22, y - 7, w * 0.56, 11, 6, accent);
};
drawSkyline = function drawSkylineCasual(ctx, x, baseY, width) {
  const towers = [
    [0.01, 54, 24, '#bfeafa'], [0.08, 80, 34, '#a6dff2'], [0.18, 62, 30, '#d7eef7'],
    [0.28, 96, 42, '#9bd3e7'], [0.41, 70, 30, '#cbecf8'], [0.52, 112, 48, '#91cbe2'],
    [0.66, 76, 34, '#c5e8f5'], [0.77, 98, 40, '#a9dff1'], [0.90, 64, 30, '#d8f0f8'],
  ];
  ctx.save();
  ctx.globalAlpha = 0.72;
  for (const [ratio, height, tw, color] of towers) {
    const tx = x + width * ratio;
    const ty = baseY - height;
    softRoundRect(ctx, tx, ty, tw, height, 7, color, 'rgba(255,255,255,0.68)', 1);
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.beginPath();
    ctx.roundRect(tx + 6, ty + 8, Math.max(6, tw * 0.28), height - 16, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(50, 126, 154, 0.26)';
    for (let wy = ty + 18; wy < baseY - 10; wy += 17) {
      ctx.fillRect(tx + tw - 12, wy, 5, 4);
      ctx.fillRect(tx + tw - 23, wy + 5, 5, 4);
    }
  }
  ctx.restore();
};
drawPlayfieldSprite = function drawPlayfieldSpriteCasual(ctx, x, y, w, h) {
  const sky = ctx.createLinearGradient(x, y, x, y + h);
  sky.addColorStop(0, CASUAL_CITY.skyTop);
  sky.addColorStop(0.40, CASUAL_CITY.skyBottom);
  sky.addColorStop(1, '#eaf8ef');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);

  softRoundRect(ctx, x + 18, y + 18, w - 36, h - 34, 34, '#c9efff', '#2f9cc8', 5);
  softRoundRect(ctx, x + 32, y + 36, w - 64, h - 68, 25, CASUAL_CITY.board, '#ffffff', 6);
  softRoundRect(ctx, x + 43, y + 58, w - 86, h - 108, 20, CASUAL_CITY.boardInset, 'rgba(66, 140, 166, 0.22)', 2);

  drawSkyline(ctx, x + 52, y + 126, 396);

  drawMiniDistrict(ctx, x, y);

  casualRoad(ctx, x + 78, y + 492, x + 422, y + 492, 45, true);
  casualRoad(ctx, x + 250, y + 430, x + 250, y + 724, 45, true);
  casualRoad(ctx, x + 91, y + 650, x + 202, y + 704, 34, true);
  casualRoad(ctx, x + 409, y + 650, x + 298, y + 704, 34, true);
  casualCrosswalk(ctx, x + 250, y + 493, 42, 0);
  casualCrosswalk(ctx, x + 250, y + 618, 42, 0);
  casualCrosswalk(ctx, x + 154, y + 493, 40, Math.PI * 0.5);
  casualCrosswalk(ctx, x + 346, y + 493, 40, Math.PI * 0.5);

  softRoundRect(ctx, x + 165, y + 550, 170, 104, 22, '#a7df91');
  softRoundRect(ctx, x + 184, y + 564, 132, 76, 20, CASUAL_CITY.plaza);
  ctx.fillStyle = CASUAL_CITY.water;
  ctx.beginPath();
  ctx.arc(x + 250, y + 603, 29, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.beginPath();
  ctx.arc(x + 242, y + 594, 8, 0, Math.PI * 2);
  ctx.fill();
  for (const [tx, ty] of [[181, 562], [322, 562], [178, 644], [325, 644]]) casualTree(ctx, x + tx, y + ty, 0.80);

  drawRoadLine(ctx, x + 84, y + 640, x + 420, y + 455, 27, 'rgba(130, 104, 40, 0.25)');
  drawRoadLine(ctx, x + 86, y + 638, x + 418, y + 456, 22, '#f9c84d');
  drawRoadLine(ctx, x + 94, y + 635, x + 410, y + 462, 3, '#fff4be', [18, 13]);
  drawRoadLine(ctx, x + 86, y + 638, x + 418, y + 456, 3, '#d49827');
  drawRoadLine(ctx, x + 84, y + 640, x + 420, y + 455, 3, '#d49827');

  drawPopPad(ctx, x + 122, y + 520, 18, '#ffc94c');
  drawPopPad(ctx, x + 378, y + 520, 18, '#ffc94c');
  drawPopPad(ctx, x + 164, y + 448, 16, '#4fc3e8');
  drawPopPad(ctx, x + 336, y + 448, 16, '#ff806d');

  drawGlassTower(ctx, x + 70, y + 526, 48, 72, '#ffc94c');
  drawGlassTower(ctx, x + 382, y + 526, 48, 72, '#ff806d');
  drawGlassTower(ctx, x + 72, y + 418, 42, 68, '#ffc94c');
  drawGlassTower(ctx, x + 386, y + 418, 42, 68, '#4fc3e8');
  casualCar(ctx, x + 114, y + 478, '#ffd05f', 0);
  casualCar(ctx, x + 386, y + 494, '#7ad66d', Math.PI);
  casualCar(ctx, x + 308, y + 676, '#ff806d', 0.18);

  softRoundRect(ctx, x + 191, y + 725, 118, 46, 14, '#ffffff', 'rgba(49,88,108,0.30)', 2);
  ctx.fillStyle = '#27475a';
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.roundRect(x + 221 + i * 10, y + 752, 5, 18, 3);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.80)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 58, y + 66);
  ctx.lineTo(x + 442, y + 66);
  ctx.stroke();
};
registerAtlasSprites = function registerAtlasSpritesCasual(atlas) {
  atlas.pack('ball', 30, 30, (ctx, x, y, w) => {
    const r = w * 0.5;
    softBlobShadow(ctx, x + r + 1, y + r + 2, r * 0.82, r * 0.38, 0.24);
    const g = ctx.createRadialGradient(x + r * 0.65, y + r * 0.58, 2, x + r, y + r, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.42, '#e8fbff');
    g.addColorStop(1, '#4fa5d9');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x + r, y + r, r - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,90,120,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
  atlas.pack('flipper', 84, 20, (ctx, x, y) => {
    softBlobShadow(ctx, x + 43, y + 14, 39, 6, 0.22);
    const grad = ctx.createLinearGradient(x, y, x, y + 20);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, '#f3fbff');
    grad.addColorStop(1, '#72c6df');
    softRoundRect(ctx, x, y, 84, 20, 10, grad, '#2f90b6', 2);
    ctx.fillStyle = '#ffbf3e';
    ctx.beginPath();
    ctx.roundRect(x + 12, y + 5, 44, 5, 3);
    ctx.fill();
    ctx.fillStyle = '#2486a7';
    ctx.fillRect(x + 11, y + 14, 56, 3);
  });
  atlas.pack('wall', 20, 20, (ctx, x, y) => {
    const g = ctx.createLinearGradient(x, y, x + 20, y);
    g.addColorStop(0, '#2f90b6');
    g.addColorStop(0.46, '#e8fbff');
    g.addColorStop(1, '#2f90b6');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 20, 20);
    ctx.fillStyle = 'rgba(255,255,255,.70)';
    ctx.fillRect(x + 4, y, 2, 20);
    ctx.fillStyle = 'rgba(31,70,92,.25)';
    ctx.fillRect(x + 16, y, 2, 20);
  });
  atlas.pack('building_base', 40, 40, (ctx, x, y, w, h) => drawTargetBase(ctx, x, y, w, h, false));
  atlas.pack('building_hit_base', 40, 40, (ctx, x, y, w, h) => drawTargetBase(ctx, x, y, w, h, true));
  for (const kind of ['residential', 'small', 'medium', 'commercial', 'public', 'danger', 'large']) atlas.pack(`zone_${kind}`, 40, 40, (c, x, y, w, h) => drawCityTile(c, x, y, w, h, kind));
  atlas.pack('building_house', 40, 40, (c, x, y, w, h) => drawHouseSprite(c, x, y, w, h));
  atlas.pack('building_convenience', 40, 40, (c, x, y, w, h) => drawConvenienceSprite(c, x, y, w, h));
  atlas.pack('building_apartment', 40, 80, (c, x, y, w, h) => drawApartmentSprite(c, x, y, w, h));
  atlas.pack('building_gas', 80, 40, (c, x, y, w, h) => drawGasSprite(c, x, y, w, h));
  atlas.pack('building_tower', 80, 80, (c, x, y, w, h) => drawTowerSprite(c, x, y, w, h));
  atlas.pack('exp_orb', 20, 20, (c, x, y, w) => {
    const r = w * 0.5;
    const g = c.createRadialGradient(x + r, y + r, 1, x + r, y + r, r);
    g.addColorStop(0, '#fffbe5');
    g.addColorStop(1, '#ffbd4f');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x + r, y + r, r, 0, Math.PI * 2);
    c.fill();
  });
  atlas.pack('playfield', WORLD.w, WORLD.h, (ctx, x, y, w, h) => drawPlayfieldSprite(ctx, x, y, w, h));
};

const PIXEL_CITY = {
  sky: '#16a8df',
  skyDark: '#0876b9',
  cream: '#f8deb0',
  creamHi: '#fff5cf',
  creamShadow: '#c99863',
  ink: '#123452',
  ink2: '#0a223a',
  road: '#6e7f86',
  roadDark: '#4e626b',
  roadLine: '#fff0ba',
  railBlue: '#126ca6',
  railHi: '#62d6ff',
  water: '#00a8de',
  waterHi: '#68e4ff',
  yellow: '#ffd13a',
  orange: '#f08b22',
  red: '#f25b49',
  green: '#63b84f',
  grass: '#83d35b',
  zones: {
    residential: { base: '#a8df68', top: '#f6f4c8', icon: '#f05a43' },
    small: { base: '#f2d79d', top: '#fff0bf', icon: '#f0a121' },
    medium: { base: '#9ed9ee', top: '#dff6ff', icon: '#1c8ec2' },
    commercial: { base: '#ffd05b', top: '#fff0af', icon: '#ff8a2a' },
    public: { base: '#77ce56', top: '#c8ef87', icon: '#2a9c4a' },
    danger: { base: '#d5a150', top: '#ffd36b', icon: '#101820' },
    large: { base: '#84c7e6', top: '#c9f1ff', icon: '#147fb6' },
  },
};

THEME.clear = [0.02, 0.24, 0.38, 1];
THEME.hudPanel = '#176aa3';
THEME.hudStroke = '#0b3458';
THEME.hudText = '#fff3bd';
THEME.hudSubText = '#bce9ff';

function px(v) { return Math.round(v); }
function pxRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(px(x), px(y), px(w), px(h));
}
function pxStroke(ctx, x, y, w, h, color, line = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = line;
  ctx.strokeRect(px(x) + line * 0.5, px(y) + line * 0.5, Math.max(0, px(w) - line), Math.max(0, px(h) - line));
}
function pxFrame(ctx, x, y, w, h, fill, edge = PIXEL_CITY.ink, hi = '#ffffff', shadow = true) {
  x = px(x); y = px(y); w = px(w); h = px(h);
  if (shadow) pxRect(ctx, x + 5, y + 6, w, h, 'rgba(6, 24, 38, 0.28)');
  pxRect(ctx, x, y, w, h, edge);
  pxRect(ctx, x + 4, y + 4, w - 8, h - 8, fill);
  pxRect(ctx, x + 6, y + 6, w - 12, 3, hi);
  pxRect(ctx, x + 6, y + h - 9, w - 12, 3, 'rgba(0,0,0,0.18)');
  pxRect(ctx, x + w - 9, y + 7, 3, h - 15, 'rgba(0,0,0,0.18)');
}
function pxCutPanel(ctx, x, y, w, h, fill, edge = PIXEL_CITY.ink, hi = '#ffffff') {
  x = px(x); y = px(y); w = px(w); h = px(h);
  pxRect(ctx, x + 6, y + 6, w, h, 'rgba(6, 24, 38, 0.22)');
  pxRect(ctx, x + 8, y, w - 16, h, edge);
  pxRect(ctx, x, y + 8, w, h - 16, edge);
  pxRect(ctx, x + 8, y + 4, w - 16, h - 8, fill);
  pxRect(ctx, x + 4, y + 8, w - 8, h - 16, fill);
  pxRect(ctx, x + 12, y + 8, w - 24, 3, hi);
  pxRect(ctx, x + 12, y + h - 11, w - 24, 3, 'rgba(0,0,0,0.18)');
}
function pxDisk(ctx, cx, cy, r, fill, edge = PIXEL_CITY.ink, hi = '#ffffff') {
  cx = px(cx); cy = px(cy); r = px(r);
  for (let yy = -r; yy <= r; yy += 2) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - yy * yy)) / 2) * 2;
    pxRect(ctx, cx - half, cy + yy, half * 2, 2, edge);
  }
  const ir = Math.max(2, r - 4);
  for (let yy = -ir; yy <= ir; yy += 2) {
    const half = Math.floor(Math.sqrt(Math.max(0, ir * ir - yy * yy)) / 2) * 2;
    pxRect(ctx, cx - half, cy + yy, half * 2, 2, fill);
  }
  pxRect(ctx, cx - r * 0.38, cy - r * 0.48, Math.max(4, r * 0.42), 3, hi);
  pxRect(ctx, cx - r * 0.52, cy - r * 0.18, 4, 4, 'rgba(255,255,255,0.65)');
}
function pxLine(ctx, x1, y1, x2, y2, width, color, dash = null) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(px(x1), px(y1));
  ctx.lineTo(px(x2), px(y2));
  ctx.stroke();
  ctx.restore();
}
function pxRoad(ctx, x1, y1, x2, y2, width, dashed = true) {
  pxLine(ctx, x1 + 4, y1 + 5, x2 + 4, y2 + 5, width + 8, 'rgba(6, 24, 38, 0.28)');
  pxLine(ctx, x1, y1, x2, y2, width + 6, PIXEL_CITY.ink);
  pxLine(ctx, x1, y1, x2, y2, width, PIXEL_CITY.road);
  if (dashed) pxLine(ctx, x1, y1, x2, y2, 3, PIXEL_CITY.roadLine, [16, 14]);
}
function pxWater(ctx, x, y, w, h) {
  pxFrame(ctx, x, y, w, h, PIXEL_CITY.water, '#075f94', PIXEL_CITY.waterHi);
  for (let yy = y + 18; yy < y + h - 12; yy += 34) {
    pxRect(ctx, x + 9, yy, 16, 3, PIXEL_CITY.waterHi);
    pxRect(ctx, x + 19, yy + 7, 14, 3, '#39d2f3');
  }
}
function pxTree(ctx, x, y, s = 1) {
  pxRect(ctx, x - 3 * s, y + 7 * s, 6 * s, 9 * s, '#8b5a2b');
  pxDisk(ctx, x, y + 3 * s, 9 * s, '#56b841', '#267d38', '#a9f073');
  pxDisk(ctx, x - 6 * s, y + 6 * s, 7 * s, '#68c94e', '#267d38', '#b7f37d');
  pxDisk(ctx, x + 6 * s, y + 6 * s, 7 * s, '#4eac3d', '#267d38', '#9ce66c');
}
function pxCar(ctx, x, y, color, vertical = false) {
  ctx.save();
  ctx.translate(px(x), px(y));
  if (vertical) ctx.rotate(Math.PI * 0.5);
  pxRect(ctx, -10, -5, 20, 12, PIXEL_CITY.ink);
  pxRect(ctx, -8, -7, 16, 12, color);
  pxRect(ctx, -4, -6, 8, 4, '#bdefff');
  pxRect(ctx, -7, 3, 14, 2, 'rgba(0,0,0,0.25)');
  ctx.restore();
}
function pxCrosswalk(ctx, x, y, length, vertical = false) {
  for (let i = -3; i <= 3; i += 1) {
    if (vertical) pxRect(ctx, x - length * 0.5, y + i * 6 - 2, length, 3, '#fff6dc');
    else pxRect(ctx, x + i * 6 - 2, y - length * 0.5, 3, length, '#fff6dc');
  }
}
function pxTriangle(ctx, x, y, dir = 'up', fill = PIXEL_CITY.yellow, edge = PIXEL_CITY.ink) {
  ctx.save();
  ctx.translate(px(x), px(y));
  const pts = dir === 'left' ? [[12, -16], [-14, 0], [12, 16]] : dir === 'right' ? [[-12, -16], [14, 0], [-12, 16]] : [[-16, 12], [0, -14], [16, 12]];
  ctx.fillStyle = edge;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[1][0], pts[1][1]);
  ctx.lineTo(pts[2][0], pts[2][1]);
  ctx.closePath();
  ctx.fill();
  ctx.translate(0, 0);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * 0.72, pts[0][1] * 0.72);
  ctx.lineTo(pts[1][0] * 0.72, pts[1][1] * 0.72);
  ctx.lineTo(pts[2][0] * 0.72, pts[2][1] * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function pxZoneLot(ctx, x, y, w, h, kind, row = 0, col = 0) {
  const z = PIXEL_CITY.zones[kind] || PIXEL_CITY.zones.small;
  pxFrame(ctx, x, y, w, h, z.base, '#2b4a57', z.top, false);
  pxRect(ctx, x + 5, y + 5, w - 10, h - 10, z.top);
  if (kind === 'public') {
    pxTree(ctx, x + w * 0.52, y + h * 0.43, 0.46);
    pxRect(ctx, x + 8, y + h - 9, w - 16, 3, '#eff6a8');
    return;
  }
  if (kind === 'danger') {
    pxRect(ctx, x + 7, y + 8, w - 14, h - 16, '#f7b743');
    for (let i = -8; i < w; i += 10) pxLine(ctx, x + i, y + h - 7, x + i + 16, y + 8, 3, '#1a2430');
    return;
  }
  if (kind === 'residential') {
    pxRect(ctx, x + 11, y + 16, 16, 10, '#fff2b9');
    pxRect(ctx, x + 9, y + 13, 20, 5, z.icon);
    pxRect(ctx, x + 17, y + 20, 5, 6, '#47778e');
  } else if (kind === 'commercial') {
    pxRect(ctx, x + 8, y + 12, 22, 5, z.icon);
    pxRect(ctx, x + 10, y + 18, 18, 8, '#fff7d5');
    pxRect(ctx, x + 14, y + 21, 10, 4, '#54bfe6');
  } else if (kind === 'large' || kind === 'medium') {
    pxRect(ctx, x + 11, y + 9, 8, 18, z.icon);
    pxRect(ctx, x + 21, y + 6, 9, 21, z.icon);
    pxRect(ctx, x + 13, y + 12, 4, 3, '#c6f4ff');
    pxRect(ctx, x + 23, y + 11, 4, 3, '#c6f4ff');
    pxRect(ctx, x + 23, y + 19, 4, 3, '#c6f4ff');
  } else if ((row + col) % 2 === 0) {
    pxRect(ctx, x + 10, y + 14, 20, 6, z.icon);
    pxRect(ctx, x + 13, y + 22, 14, 4, '#fff7d5');
  } else {
    pxRect(ctx, x + 11, y + 13, 18, 4, '#75c9e8');
    pxRect(ctx, x + 15, y + 22, 11, 4, '#eda62a');
  }
}

drawTargetBase = function drawTargetBasePixel(ctx, x, y, w, h, hot = false) {
  pxRect(ctx, x + 5, y + 7, w - 2, h - 4, 'rgba(4, 20, 31, 0.32)');
  pxFrame(ctx, x, y, w, h, hot ? '#ffd84c' : '#f3d8a5', hot ? '#ff5b47' : PIXEL_CITY.ink, '#fff5c4', false);
  pxRect(ctx, x + 7, y + h - 11, w - 14, 4, hot ? '#ff8d2b' : '#b9854d');
  pxRect(ctx, x + 7, y + 7, 6, 6, hot ? '#ffffff' : '#ffe69b');
  pxRect(ctx, x + w - 13, y + 7, 6, 6, hot ? '#ffffff' : '#ffe69b');
};
drawCityTile = function drawCityTilePixel(ctx, x, y, w, h, kind) {
  pxZoneLot(ctx, x + 1, y + 1, w - 2, h - 2, kind, 0, 0);
};
drawMiniDistrict = function drawMiniDistrictPixel(ctx, x, y) {
  const gx = x + GRID.left;
  const gy = y + GRID.top;
  const gw = GRID.width;
  const gh = GRID.height;
  pxFrame(ctx, gx - 23, gy - 23, gw + 46, gh + 46, '#58737d', PIXEL_CITY.ink, '#b7e6f2');
  pxRect(ctx, gx - 9, gy - 9, gw + 18, gh + 18, PIXEL_CITY.road);

  for (let row = 0; row < GRID.rows; row += 1) {
    for (let col = 0; col < GRID.cols; col += 1) {
      const lx = gx + col * GRID.cellSize + 4;
      const ly = gy + row * GRID.cellSize + 4;
      pxZoneLot(ctx, lx, ly, 32, 32, ZONE_TEMPLATE[row][col], row, col);
    }
  }

  for (let i = 0; i <= GRID.cols; i += 1) {
    const pxX = gx + i * GRID.cellSize;
    pxRect(ctx, pxX - 3, gy - 9, 6, gh + 18, '#415861');
    if (i > 0 && i < GRID.cols) {
      for (let yy = gy + 9; yy < gy + gh - 8; yy += 24) pxRect(ctx, pxX - 1, yy, 2, 10, '#fff2c6');
    }
  }
  for (let i = 0; i <= GRID.rows; i += 1) {
    const py = gy + i * GRID.cellSize;
    pxRect(ctx, gx - 9, py - 3, gw + 18, 6, '#415861');
    if (i > 0 && i < GRID.rows) {
      for (let xx = gx + 9; xx < gx + gw - 8; xx += 24) pxRect(ctx, xx, py - 1, 10, 2, '#fff2c6');
    }
  }
  pxCrosswalk(ctx, gx + 120, gy + 160, 28, true);
  pxCrosswalk(ctx, gx + 200, gy + 200, 28, false);
  pxCrosswalk(ctx, gx + 280, gy + 120, 28, true);
  pxCar(ctx, gx + 63, gy + 83, '#ff4d65', false);
  pxCar(ctx, gx + 264, gy + 204, '#36c4dd', false);
  pxCar(ctx, gx + 205, gy + 121, '#ffd13a', true);
  pxRect(ctx, gx - 23, gy - 23, gw + 46, 5, '#f6e6b9');
};
function pxBuildingCore(ctx, x, y, w, h, body, roof, accent) {
  pxRect(ctx, x + 5, y + h - 3, w - 5, 4, 'rgba(4, 20, 31, 0.32)');
  pxFrame(ctx, x + 4, y + 8, w - 8, h - 9, body, PIXEL_CITY.ink, '#ffffff', false);
  pxRect(ctx, x + 8, y + 4, w - 16, 8, roof);
  pxRect(ctx, x + 10, y + 16, w - 20, 5, accent);
}
drawHouseSprite = function drawHouseSpritePixel(ctx, x, y, w, h) {
  pxBuildingCore(ctx, x, y, w, h, '#ffe7ac', '#ff5b47', '#fff6ce');
  pxRect(ctx, x + 12, y + 23, 6, 5, '#55c6ec');
  pxRect(ctx, x + 24, y + 23, 6, 5, '#55c6ec');
  pxRect(ctx, x + 18, y + 29, 6, 8, '#2b536a');
};
drawConvenienceSprite = function drawConvenienceSpritePixel(ctx, x, y, w, h) {
  pxBuildingCore(ctx, x, y, w, h, '#fff4c4', '#1f9ad2', '#ff5b47');
  pxRect(ctx, x + 8, y + 18, w - 16, 4, '#ffd13a');
  pxRect(ctx, x + 11, y + 26, 7, 10, '#5fd8ff');
  pxRect(ctx, x + 22, y + 26, 7, 10, '#5fd8ff');
};
drawApartmentSprite = function drawApartmentSpritePixel(ctx, x, y, w, h) {
  pxBuildingCore(ctx, x, y, w, h, '#4fb5dc', '#d9f7ff', '#ffd13a');
  for (let yy = y + 23; yy < y + h - 11; yy += 10) {
    pxRect(ctx, x + 10, yy, 5, 4, '#d9f7ff');
    pxRect(ctx, x + 20, yy, 5, 4, '#d9f7ff');
    pxRect(ctx, x + 30, yy, 5, 4, '#d9f7ff');
  }
  pxRect(ctx, x + 17, y + h - 14, 7, 9, '#123452');
};
drawGasSprite = function drawGasSpritePixel(ctx, x, y, w, h) {
  pxRect(ctx, x + 8, y + h - 3, w - 9, 4, 'rgba(4,20,31,.32)');
  pxFrame(ctx, x + 5, y + 17, w - 10, h - 10, '#ffd36b', PIXEL_CITY.ink, '#fff4b0', false);
  pxRect(ctx, x + 12, y + 8, w - 24, 12, '#ff5b47');
  pxRect(ctx, x + 17, y + 13, w - 34, 4, '#fff4b0');
  pxRect(ctx, x + 14, y + 26, 12, 12, '#1f9ad2');
  pxRect(ctx, x + w - 26, y + 26, 12, 12, '#1f9ad2');
  pxRect(ctx, x + 31, y + 28, w - 62, 4, '#123452');
};
drawTowerSprite = function drawTowerSpritePixel(ctx, x, y, w, h) {
  pxRect(ctx, x + 12, y + h - 3, w - 18, 4, 'rgba(4,20,31,.32)');
  pxFrame(ctx, x + 13, y + 5, w - 26, h - 8, '#3db4e0', PIXEL_CITY.ink, '#c9f5ff', false);
  pxRect(ctx, x + 24, y + 1, w - 48, 8, '#ffd13a');
  pxRect(ctx, x + 20, y + 12, 13, h - 24, '#bff2ff');
  for (let yy = y + 20; yy < y + h - 13; yy += 10) {
    pxRect(ctx, x + 39, yy, 5, 4, '#d9f7ff');
    pxRect(ctx, x + 50, yy, 5, 4, '#d9f7ff');
    pxRect(ctx, x + 61, yy, 5, 4, '#d9f7ff');
  }
};
drawSkyline = function drawSkylinePixel(ctx, x, baseY, width) {
  const towers = [
    [0.00, 36, 20, '#6bc8e8'], [0.08, 58, 30, '#ffe1a0'], [0.20, 44, 24, '#a1e1f3'],
    [0.31, 66, 34, '#65bce5'], [0.46, 42, 24, '#ffd36b'], [0.55, 70, 38, '#4eb1de'],
    [0.70, 50, 28, '#e7f5ff'], [0.82, 62, 30, '#ff735b'], [0.92, 40, 24, '#7bd36b'],
  ];
  for (const [ratio, height, tw, color] of towers) {
    const tx = x + width * ratio;
    const ty = baseY - height;
    pxFrame(ctx, tx, ty, tw, height, color, '#15506f', '#ffffff', false);
    for (let yy = ty + 12; yy < baseY - 8; yy += 12) {
      pxRect(ctx, tx + 7, yy, 4, 4, '#d9f7ff');
      pxRect(ctx, tx + tw - 11, yy + 4, 4, 4, '#d9f7ff');
    }
  }
};
drawPlayfieldSprite = function drawPlayfieldSpritePixel(ctx, x, y, w, h) {
  pxRect(ctx, x, y, w, h, PIXEL_CITY.sky);
  pxRect(ctx, x, y + h - 96, w, 96, PIXEL_CITY.skyDark);
  for (let yy = y + h - 86; yy < y + h; yy += 24) pxRect(ctx, x, yy, w, 3, '#0a5f9c');

  pxFrame(ctx, x + 13, y + 10, w - 26, h - 18, PIXEL_CITY.cream, PIXEL_CITY.ink2, PIXEL_CITY.creamHi);
  pxFrame(ctx, x + 27, y + 46, w - 54, h - 82, '#ecd09d', '#1a5374', '#fff4c8');
  pxRect(ctx, x + 38, y + 62, w - 76, h - 112, '#f3dcb2');

  pxWater(ctx, x + 40, y + 104, 37, 612);
  pxWater(ctx, x + 423, y + 104, 37, 612);
  pxRoad(ctx, x + 62, y + 86, x + 438, y + 86, 26, true);
  pxRoad(ctx, x + 64, y + 570, x + 436, y + 570, 32, true);
  drawSkyline(ctx, x + 75, y + 86, 350);
  drawMiniDistrict(ctx, x, y);

  pxRoad(ctx, x + 250, y + 421, x + 250, y + 735, 36, true);
  pxRoad(ctx, x + 78, y + 520, x + 178, y + 478, 28, true);
  pxRoad(ctx, x + 422, y + 520, x + 322, y + 478, 28, true);
  pxCrosswalk(ctx, x + 250, y + 455, 36, false);
  pxCrosswalk(ctx, x + 250, y + 543, 36, false);

  pxFrame(ctx, x + 152, y + 455, 196, 118, '#d6b17e', '#7d6241', '#fff1c8');
  pxDisk(ctx, x + 188, y + 505, 21, '#ffefc0', '#d94337', '#ffffff');
  pxDisk(ctx, x + 250, y + 487, 22, '#ffefc0', '#d94337', '#ffffff');
  pxDisk(ctx, x + 312, y + 505, 21, '#ffefc0', '#d94337', '#ffffff');
  pxTriangle(ctx, x + 146, y + 530, 'right', '#62d6ff');
  pxTriangle(ctx, x + 354, y + 530, 'left', '#62d6ff');

  pxFrame(ctx, x + 139, y + 575, 222, 108, '#70c957', '#2d7e48', '#bff38a');
  pxWater(ctx, x + 196, y + 604, 108, 48);
  pxDisk(ctx, x + 250, y + 628, 18, '#ffffff', '#126ca6', '#c9f7ff');
  pxTree(ctx, x + 160, y + 602, 0.72);
  pxTree(ctx, x + 335, y + 648, 0.72);
  pxTree(ctx, x + 182, y + 668, 0.60);
  pxTree(ctx, x + 320, y + 590, 0.60);

  pxRoad(ctx, x + 93, y + 666, x + 420, y + 468, 22, true);
  pxLine(ctx, x + 92, y + 666, x + 421, y + 468, 31, '#b06f1e');
  pxLine(ctx, x + 94, y + 662, x + 418, y + 466, 25, PIXEL_CITY.yellow);
  pxLine(ctx, x + 103, y + 658, x + 408, y + 473, 3, '#fff7bf', [18, 13]);

  pxTriangle(ctx, x + 106, y + 646, 'right', PIXEL_CITY.yellow);
  pxTriangle(ctx, x + 394, y + 646, 'left', PIXEL_CITY.yellow);
  pxRoad(ctx, x + 36, y + 704, x + 160, y + 704, 26, false);
  pxRoad(ctx, x + 464, y + 704, x + 340, y + 704, 26, false);
  pxFrame(ctx, x + 206, y + 735, 88, 42, '#415461', PIXEL_CITY.ink, '#6e8796');
  pxRect(ctx, x + 225, y + 756, 50, 4, '#0a1828');
  for (let i = 0; i < 7; i += 1) pxRect(ctx, x + 219 + i * 9, y + 768, 5, 18, '#061323');

  pxCar(ctx, x + 95, y + 609, '#ff5b47', true);
  pxCar(ctx, x + 399, y + 610, '#ffd13a', true);
  pxCar(ctx, x + 82, y + 178, '#36c4dd', true);
  pxCar(ctx, x + 418, y + 252, '#ff5b47', true);
};
registerAtlasSprites = function registerAtlasSpritesPixel(atlas) {
  atlas.pack('ball', 30, 30, (ctx, x, y, w) => {
    pxDisk(ctx, x + w * 0.5, y + w * 0.5, w * 0.46, '#d7e3ec', '#102a44', '#ffffff');
    pxRect(ctx, x + 8, y + 7, 8, 4, '#ffffff');
    pxRect(ctx, x + 18, y + 21, 5, 3, '#82919d');
  });
  atlas.pack('flipper', 84, 20, (ctx, x, y) => {
    pxRect(ctx, x + 4, y + 14, 78, 6, 'rgba(4,20,31,.32)');
    pxFrame(ctx, x, y, 84, 20, '#fff6d6', PIXEL_CITY.ink, '#ffffff', false);
    pxRect(ctx, x + 7, y + 4, 70, 4, '#ff9c25');
    pxRect(ctx, x + 9, y + 13, 58, 3, '#d35a2a');
    pxRect(ctx, x + 68, y + 6, 8, 8, '#62d6ff');
  });
  atlas.pack('wall', 20, 20, (ctx, x, y) => {
    pxRect(ctx, x, y, 20, 20, PIXEL_CITY.ink);
    pxRect(ctx, x + 4, y, 12, 20, '#1674ad');
    pxRect(ctx, x + 6, y, 3, 20, '#65d6ff');
    pxRect(ctx, x + 13, y, 2, 20, '#ffd13a');
  });
  atlas.pack('building_base', 40, 40, (ctx, x, y, w, h) => drawTargetBase(ctx, x, y, w, h, false));
  atlas.pack('building_hit_base', 40, 40, (ctx, x, y, w, h) => drawTargetBase(ctx, x, y, w, h, true));
  for (const kind of ['residential', 'small', 'medium', 'commercial', 'public', 'danger', 'large']) atlas.pack(`zone_${kind}`, 40, 40, (c, x, y, w, h) => drawCityTile(c, x, y, w, h, kind));
  atlas.pack('building_house', 40, 40, (c, x, y, w, h) => drawHouseSprite(c, x, y, w, h));
  atlas.pack('building_convenience', 40, 40, (c, x, y, w, h) => drawConvenienceSprite(c, x, y, w, h));
  atlas.pack('building_apartment', 40, 80, (c, x, y, w, h) => drawApartmentSprite(c, x, y, w, h));
  atlas.pack('building_gas', 80, 40, (c, x, y, w, h) => drawGasSprite(c, x, y, w, h));
  atlas.pack('building_tower', 80, 80, (c, x, y, w, h) => drawTowerSprite(c, x, y, w, h));
  atlas.pack('exp_orb', 20, 20, (ctx, x, y, w) => {
    pxDisk(ctx, x + w * 0.5, y + w * 0.5, w * 0.45, '#ffd13a', '#8a4d10', '#fff7bf');
    pxRect(ctx, x + 8, y + 5, 4, 10, '#fff7bf');
    pxRect(ctx, x + 5, y + 8, 10, 4, '#fff7bf');
  });
  atlas.pack('playfield', WORLD.w, WORLD.h, (ctx, x, y, w, h) => drawPlayfieldSprite(ctx, x, y, w, h));
};

const REF_PIXEL = {
  cream: '#d8e0e2',
  cream2: '#eef0e8',
  blue: '#4fa6d4',
  blueDark: '#2f6588',
  blueDeep: '#214b68',
  water: '#7e95a3',
  waterLight: '#b9c6cf',
  asphalt: '#8f9aa1',
  asphaltDark: '#6f7980',
  lane: '#d9dee1',
  yellow: '#ffd33f',
  orange: '#f08b22',
  red: '#ee5548',
  grass: '#69bf43',
  grassLight: '#a9e66b',
  ink: '#102a44',
};

GRID.left = 42;
GRID.top = GRID_TOP_Y;
THEME.clear = [0.70, 0.82, 0.92, 1];

function refLinePath(ctx, pts, width, color, dash = null) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(px(pts[0][0]), px(pts[0][1]));
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(px(pts[i][0]), px(pts[i][1]));
  ctx.stroke();
  ctx.restore();
}
function refRoadPath(ctx, pts, width = 24, dashed = true) {
  refLinePath(ctx, pts.map(([a, b]) => [a + 2, b + 3]), width + 5, 'rgba(32,42,52,.16)');
  refLinePath(ctx, pts, width + 3, '#7d888f');
  refLinePath(ctx, pts, width, REF_PIXEL.asphalt);
  if (dashed) refLinePath(ctx, pts, 2, REF_PIXEL.lane, [10, 14]);
}
function refRampPath(ctx, pts) {
  refLinePath(ctx, pts.map(([a, b]) => [a + 2, b + 3]), 22, 'rgba(38,46,54,.18)');
  refLinePath(ctx, pts, 22, '#919ba2');
  refLinePath(ctx, pts, 16, '#b4bdc3');
  refLinePath(ctx, pts, 2, '#dce3e7', [18, 14]);
}
function refStar(ctx, cx, cy, r, fill = REF_PIXEL.red, edge = '#9e2f2b') {
  ctx.save();
  ctx.translate(px(cx), px(cy));
  ctx.fillStyle = edge;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const pxp = Math.cos(a) * rr;
    const pyp = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(pxp, pyp);
    else ctx.lineTo(pxp, pyp);
  }
  ctx.closePath();
  ctx.fill();
  ctx.scale(0.72, 0.72);
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const pxp = Math.cos(a) * rr;
    const pyp = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(pxp, pyp);
    else ctx.lineTo(pxp, pyp);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function refWaterChannel(ctx, x, y, w, h, side = 'left') {
  pxFrame(ctx, x, y, w, h, '#a9b5bc', '#6e7b84', '#d5dde1');
  pxRect(ctx, x + 5, y + 3, w - 10, h - 6, REF_PIXEL.water);
  pxRect(ctx, x + 7, y + 5, w - 14, h - 10, '#6f8794');
  for (let yy = y + 44; yy < y + h - 26; yy += 98) {
    pxRect(ctx, x + 10, yy, w - 20, 2, REF_PIXEL.waterLight);
    pxRect(ctx, side === 'left' ? x + 5 : x + w - 10, yy + 18, 3, 10, '#d3dbe0');
  }
}
function refTreeCluster(ctx, x, y, s = 1) {
  pxTree(ctx, x - 9 * s, y + 5 * s, 0.72 * s);
  pxTree(ctx, x + 8 * s, y, 0.84 * s);
  pxTree(ctx, x + 1 * s, y + 11 * s, 0.62 * s);
}
function refWindow(ctx, x, y, w = 4, h = 4, glass = '#c9f6ff') {
  pxRect(ctx, x, y, w, h, '#24465a');
  pxRect(ctx, x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2), glass);
  pxRect(ctx, x + 1, y + 1, Math.max(1, w - 3), 1, '#ffffff');
}
function refWindowGrid(ctx, x, y, cols, rows, gapX = 7, gapY = 7, glass = '#c9f6ff') {
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      refWindow(ctx, x + col * gapX, y + row * gapY, 4, 4, glass);
    }
  }
}
function refAwning(ctx, x, y, w, h, a = REF_PIXEL.red, b = '#fff2d2') {
  pxRect(ctx, x, y, w, h, '#72362f');
  for (let xx = 0; xx < w; xx += 6) pxRect(ctx, x + xx, y + 1, Math.min(5, w - xx), h - 2, (xx / 6) % 2 ? b : a);
  pxRect(ctx, x, y + h - 2, w, 2, '#d85b2a');
}
function refPlanter(ctx, x, y, w = 12) {
  pxRect(ctx, x, y + 4, w, 4, '#8b5730');
  pxRect(ctx, x + 1, y + 2, w - 2, 3, '#4fb34b');
  pxRect(ctx, x + 3, y, 3, 3, '#a9e66b');
  pxRect(ctx, x + w - 6, y + 1, 3, 3, '#7bd35d');
}
function refDecorBuilding(ctx, x, y, w, h, type = 'tower') {
  pxRect(ctx, x + 5, y + h - 2, w, 5, 'rgba(6,18,30,.30)');
  if (type === 'tower') {
    pxFrame(ctx, x, y, w, h, '#4eaed7', REF_PIXEL.ink, '#d7f7ff', false);
    pxRect(ctx, x + 5, y + 5, w - 10, 5, '#eaf9ff');
    pxRect(ctx, x + w - 8, y + 9, 4, h - 16, '#2b7ca0');
    pxRect(ctx, x + 7, y + 11, Math.max(5, w * 0.26), h - 19, '#b6f0ff');
    refWindowGrid(ctx, x + Math.max(12, w * 0.42), y + 13, Math.max(1, Math.floor((w - 18) / 8)), Math.max(1, Math.floor((h - 20) / 8)), 7, 8, '#dffaff');
    pxRect(ctx, x + w * 0.36, y - 4, Math.max(8, w * 0.30), 6, REF_PIXEL.yellow);
    pxRect(ctx, x + w * 0.47, y - 8, 2, 5, '#ffffff');
  } else if (type === 'shop') {
    pxFrame(ctx, x, y + 8, w, h - 8, '#ffe1a0', REF_PIXEL.ink, '#fff6c8', false);
    pxRect(ctx, x + 5, y + 5, w - 10, 7, '#287fb4');
    refAwning(ctx, x + 5, y + 13, w - 10, 7);
    pxRect(ctx, x + 9, y + 23, Math.max(7, w * 0.28), h - 30, '#7ce3ff');
    refWindow(ctx, x + w - 15, y + 24, 7, 8, '#dffaff');
    pxRect(ctx, x + w * 0.42, y + h - 13, 10, 10, '#2d647d');
    refPlanter(ctx, x + 5, y + h - 9, 10);
  } else if (type === 'house') {
    pxFrame(ctx, x + 3, y + 13, w - 6, h - 13, '#ffe6a7', REF_PIXEL.ink, '#fff6c8', false);
    pxRect(ctx, x + 8, y + 8, w - 16, 5, '#b93f36');
    pxRect(ctx, x + 6, y + 13, w - 12, 5, REF_PIXEL.red);
    pxRect(ctx, x + 10, y + 20, 7, 6, '#8be8ff');
    refWindow(ctx, x + w - 17, y + 20, 7, 6, '#8be8ff');
    pxRect(ctx, x + Math.max(12, w * 0.42), y + h - 14, 9, 11, '#2e657d');
    pxRect(ctx, x + Math.max(15, w * 0.42 + 3), y + h - 9, 2, 2, REF_PIXEL.yellow);
    refPlanter(ctx, x + 5, y + h - 8, 10);
  } else if (type === 'construction') {
    pxFrame(ctx, x, y, w, h, '#eeb140', REF_PIXEL.ink, '#ffe27b', false);
    for (let i = -h; i < w; i += 13) refLinePath(ctx, [[x + i, y + h - 4], [x + i + 18, y + 5]], 4, '#1c2430');
    pxRect(ctx, x + 5, y + h - 10, w - 10, 5, '#101820');
    pxRect(ctx, x + w * 0.58, y + 9, 6, h - 18, '#9c5a19');
    pxRect(ctx, x + w * 0.35, y + 9, w * 0.42, 6, REF_PIXEL.yellow);
    pxRect(ctx, x + w * 0.27, y + 13, 4, h * 0.32, '#c77922');
    pxRect(ctx, x + w * 0.23, y + 13, 18, 3, REF_PIXEL.yellow);
  } else if (type === 'park') {
    pxFrame(ctx, x, y, w, h, '#74c953', '#2c7b42', '#c5f18a', false);
    pxDisk(ctx, x + w * 0.52, y + h * 0.55, Math.min(w, h) * 0.24, REF_PIXEL.water, '#197aa4', REF_PIXEL.waterLight);
    pxRect(ctx, x + w * 0.42, y + h * 0.50, Math.max(6, w * 0.18), 2, '#b9f8ff');
    refTreeCluster(ctx, x + w * 0.25, y + h * 0.28, 0.62);
    refTreeCluster(ctx, x + w * 0.76, y + h * 0.70, 0.52);
    pxRect(ctx, x + 6, y + h - 8, w - 12, 3, '#eff6a8');
  }
}
function refLot(ctx, x, y, w, h, kind, row = 0, col = 0) {
  const zoneTone = {
    danger: '#d7d2c7',
    public: '#d4e1cf',
    residential: '#e3e6df',
    commercial: '#dde2dd',
    large: '#d7dde0',
    medium: '#dce2e4',
    small: '#e6e9e2',
  };
  const fill = zoneTone[kind] || '#e8dfcf';
  pxFrame(ctx, x, y, w, h, fill, '#b4c0c6', '#f8f5ed', false);
  pxRect(ctx, x + 3, y + 3, w - 6, h - 6, fill);
  pxRect(ctx, x + 6, y + h - 9, w - 12, 2, 'rgba(120,130,136,.25)');
}
function refBuildingBase(ctx, x, y, w, h, body, trim = REF_PIXEL.ink, hi = '#ffffff') {
  pxRect(ctx, x + 6, y + h - 2, w - 8, 4, 'rgba(9,22,35,.28)');
  pxFrame(ctx, x + 3, y + 7, w - 6, h - 10, body, '#0f2c45', hi, false);
  pxRect(ctx, x + 7, y + h - 11, w - 14, 2, 'rgba(0,0,0,.14)');
}
drawHouseSprite = function drawHouseSpriteRef(ctx, x, y, w, h) {
  refBuildingBase(ctx, x, y, w, h, '#ffe6a7', REF_PIXEL.ink, '#fff6c8');
  pxRect(ctx, x + 8, y + 5, w - 16, 5, '#b93f36');
  pxRect(ctx, x + 6, y + 10, w - 12, 7, REF_PIXEL.red);
  refWindow(ctx, x + 10, y + 22, 7, 6, '#8be8ff');
  refWindow(ctx, x + w - 17, y + 22, 7, 6, '#8be8ff');
  pxRect(ctx, x + 18, y + h - 16, 8, 12, '#2e657d');
  pxRect(ctx, x + 22, y + h - 10, 2, 2, REF_PIXEL.yellow);
  refPlanter(ctx, x + 6, y + h - 9, 10);
  refPlanter(ctx, x + w - 17, y + h - 9, 10);
};
drawConvenienceSprite = function drawConvenienceSpriteRef(ctx, x, y, w, h) {
  refBuildingBase(ctx, x, y, w, h, '#fff0b8', REF_PIXEL.ink, '#fff8d7');
  pxRect(ctx, x + 7, y + 6, w - 14, 7, '#1d8ec0');
  pxRect(ctx, x + 11, y + 8, w - 22, 3, '#c9f7ff');
  refAwning(ctx, x + 6, y + 15, w - 12, 7, REF_PIXEL.red, '#fff4d5');
  refWindow(ctx, x + 9, y + 26, 8, 9, '#88e7ff');
  pxRect(ctx, x + 20, y + 25, 9, 11, '#2e657d');
  refWindow(ctx, x + 30, y + 26, 6, 8, '#dffaff');
  pxRect(ctx, x + 23, y + 30, 2, 2, REF_PIXEL.yellow);
};
drawApartmentSprite = function drawApartmentSpriteRef(ctx, x, y, w, h) {
  refBuildingBase(ctx, x, y, w, h, '#4fb5dc', REF_PIXEL.ink, '#d7f7ff');
  pxRect(ctx, x + 10, y + 3, w - 20, 8, '#dffaff');
  pxRect(ctx, x + 16, y, w - 32, 5, '#ffd33f');
  pxRect(ctx, x + w - 10, y + 12, 4, h - 22, '#2d7ca0');
  refWindowGrid(ctx, x + 9, y + 18, 3, Math.max(3, Math.floor((h - 30) / 9)), 10, 9, '#dffaff');
  for (let yy = y + 25; yy < y + h - 18; yy += 18) {
    pxRect(ctx, x + 7, yy, w - 14, 2, '#2d7ca0');
  }
  pxRect(ctx, x + 17, y + h - 15, 8, 11, '#123452');
  pxRect(ctx, x + 25, y + h - 15, 7, 11, '#8be8ff');
};
drawGasSprite = function drawGasSpriteRef(ctx, x, y, w, h) {
  pxRect(ctx, x + 8, y + h - 3, w - 9, 5, 'rgba(6,18,30,.34)');
  pxFrame(ctx, x + 5, y + 19, w - 10, h - 12, '#ffe1a0', REF_PIXEL.ink, '#fff7bf', false);
  pxRect(ctx, x + 12, y + 8, w - 24, 10, REF_PIXEL.red);
  pxRect(ctx, x + 17, y + 12, w - 34, 3, '#fff4b0');
  pxRect(ctx, x + 13, y + 18, 6, h - 18, '#9b5b27');
  pxRect(ctx, x + w - 19, y + 18, 6, h - 18, '#9b5b27');
  pxFrame(ctx, x + 17, y + 26, 13, 12, '#1f9ad2', REF_PIXEL.ink, '#c9f7ff', false);
  pxFrame(ctx, x + w - 30, y + 26, 13, 12, '#1f9ad2', REF_PIXEL.ink, '#c9f7ff', false);
  pxRect(ctx, x + 35, y + 29, w - 70, 5, '#123452');
  pxRect(ctx, x + 36, y + 35, w - 72, 3, '#ffd33f');
};
drawTowerSprite = function drawTowerSpriteRef(ctx, x, y, w, h) {
  pxRect(ctx, x + 13, y + h - 3, w - 18, 5, 'rgba(6,18,30,.34)');
  pxFrame(ctx, x + 12, y + 8, w - 24, h - 10, '#45add8', REF_PIXEL.ink, '#d7f7ff', false);
  pxRect(ctx, x + 23, y + 2, w - 46, 8, '#ffd33f');
  pxRect(ctx, x + 19, y + 14, 14, h - 25, '#bff2ff');
  pxRect(ctx, x + w - 19, y + 16, 5, h - 28, '#2a7fa5');
  refWindowGrid(ctx, x + 38, y + 20, 3, Math.max(3, Math.floor((h - 32) / 10)), 11, 10, '#dffaff');
  for (let yy = y + 29; yy < y + h - 17; yy += 20) pxRect(ctx, x + 36, yy, w - 50, 2, '#2a7fa5');
  pxRect(ctx, x + 32, y + h - 14, 18, 10, '#16425d');
};
drawMiniDistrict = function drawMiniDistrictRef(ctx, x, y) {
  const gx = x + GRID.left;
  const gy = y + GRID.top;
  const gw = GRID.width;
  const gh = GRID.height;
  pxFrame(ctx, gx - 28, gy - 28, gw + 56, gh + 56, '#74848c', REF_PIXEL.ink, '#dfe8eb');
  pxRect(ctx, gx - 12, gy - 12, gw + 24, gh + 24, REF_PIXEL.asphalt);
  for (let row = 0; row < GRID.rows; row += 1) {
    for (let col = 0; col < GRID.cols; col += 1) {
      const lotInset = 4;
      const lotSize = GRID.cellSize - lotInset * 2;
      refLot(ctx, gx + col * GRID.cellSize + lotInset, gy + row * GRID.cellSize + lotInset, lotSize, lotSize, ZONE_TEMPLATE[row][col], row, col);
    }
  }
  for (let i = 0; i <= GRID.cols; i += 1) {
    const xx = gx + i * GRID.cellSize;
    pxRect(ctx, xx - 2, gy - 12, 4, gh + 24, '#95a3aa');
    if (i > 0 && i < GRID.cols) for (let yy = gy + 10; yy < gy + gh - 8; yy += 34) pxRect(ctx, xx - 1, yy, 2, 5, '#d9e2e7');
  }
  for (let i = 0; i <= GRID.rows; i += 1) {
    const yy = gy + i * GRID.cellSize;
    pxRect(ctx, gx - 12, yy - 2, gw + 24, 4, '#95a3aa');
    if (i > 0 && i < GRID.rows) for (let xx = gx + 10; xx < gx + gw - 8; xx += 34) pxRect(ctx, xx, yy - 1, 5, 2, '#d9e2e7');
  }
};
drawPlayfieldSprite = function drawPlayfieldSpriteRef(ctx, x, y, w, h) {
  const laneTop = PLAYFIELD_TOP_Y + 4;
  const laneBottom = h - 30;
  const deckTop = laneTop + 15;
  const deckBottom = h - 47;
  pxRect(ctx, x, y, w, h, '#27485a');
  pxFrame(ctx, x + 8, y + 6, w - 16, h - 10, '#7a6041', '#24313a', '#c99b5b');
  pxFrame(ctx, x + 22, y + laneTop, w - 44, laneBottom - laneTop, '#4b3829', '#2b2520', '#94704a');
  pxRect(ctx, x + 34, y + deckTop, w - 68, deckBottom - deckTop, '#5d4430');
  for (let yy = deckTop + 18; yy < deckBottom - 12; yy += 36) {
    const band = yy % 72 === 0 ? '#6d5138' : '#503927';
    pxRect(ctx, x + 42, y + yy, w - 84, 10, band);
    pxRect(ctx, x + 50, y + yy + 3, w - 100, 2, 'rgba(255,255,255,.12)');
  }
  pxRect(ctx, x + 56, y + deckTop + 8, w - 112, 3, '#d0a05c');
  pxRect(ctx, x + 56, y + deckBottom - 12, w - 112, 3, '#3b2a20');
};

function refCityFurniture(ctx, x, y) {
  const stop = [
    [x + 88, y + 146],
    [x + 374, y + 146],
    [x + 90, y + 628],
    [x + 372, y + 628],
  ];
  for (const [sx, sy] of stop) {
    pxRect(ctx, sx, sy, 24, 4, '#f2d873');
    pxRect(ctx, sx + 2, sy - 7, 2, 7, '#5a6870');
    pxRect(ctx, sx + 20, sy - 7, 2, 7, '#5a6870');
    pxRect(ctx, sx + 6, sy - 14, 12, 6, '#dfeaf0');
    pxRect(ctx, sx + 8, sy - 12, 8, 2, '#4d6e80');
  }

  const crosswalks = [
    [x + 150, y + 108, 'h'],
    [x + 312, y + 108, 'h'],
    [x + 150, y + 672, 'h'],
    [x + 312, y + 672, 'h'],
  ];
  for (const [cx, cy, dir] of crosswalks) {
    for (let i = 0; i < 6; i += 1) {
      if (dir === 'h') pxRect(ctx, cx + i * 8, cy, 5, 3, '#edf3f6');
    }
  }

  const lamps = [
    [x + 126, y + 196], [x + 372, y + 196],
    [x + 126, y + 602], [x + 372, y + 602],
  ];
  for (const [lx, ly] of lamps) {
    pxRect(ctx, lx, ly, 2, 18, '#4f5c64');
    pxRect(ctx, lx - 3, ly - 3, 8, 4, '#e9f2f6');
    pxRect(ctx, lx - 1, ly + 18, 4, 3, '#6b7880');
  }

  pxFrame(ctx, x + 177, y + 544, 32, 20, '#d9e4ea', '#4e5f68', '#f4f8fb', false);
  pxRect(ctx, x + 182, y + 551, 22, 7, '#5ea2c6');
  pxRect(ctx, x + 214, y + 549, 8, 11, '#cf4f3d');

  pxFrame(ctx, x + 292, y + 544, 32, 20, '#d9e4ea', '#4e5f68', '#f4f8fb', false);
  pxRect(ctx, x + 297, y + 551, 22, 7, '#6fb36a');
  pxRect(ctx, x + 284, y + 549, 8, 11, '#2d7ca0');
}

function packHiDpi(atlas, key, width, height, drawFn, scale = 2) {
  atlas.pack(key, width * scale, height * scale, (ctx, x, y) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    drawFn(ctx, 0, 0, width, height);
    ctx.restore();
  });
}
registerAtlasSprites = function registerAtlasSpritesRef(atlas) {
  packHiDpi(atlas, 'ball', BALL_SPRITE_SIZE, BALL_SPRITE_SIZE, (ctx, x, y, w) => {
    pxDisk(ctx, x + w * 0.5, y + w * 0.5, w * 0.47, '#bcc7d0', REF_PIXEL.ink, '#f8fbff');
    pxRect(ctx, x + 12, y + 11, 8, 3, '#ffffff');
    pxRect(ctx, x + 27, y + 29, 4, 2, '#7e8a94');
  });
  packHiDpi(atlas, 'flipper', 84, 20, (ctx, x, y) => {
    pxRect(ctx, x + 4, y + 15, 78, 5, 'rgba(36,44,50,.25)');
    pxFrame(ctx, x, y, 84, 20, '#d7dde1', '#4d5a62', '#f2f5f7', false);
    pxRect(ctx, x + 7, y + 6, 70, 3, '#b6c0c6');
    pxRect(ctx, x + 10, y + 12, 56, 3, '#8f9ba3');
    pxDisk(ctx, x + 70, y + 10, 5, '#c8d0d6', '#4d5a62', '#eef2f5');
  });
  packHiDpi(atlas, 'wall', 20, 20, (ctx, x, y) => {
    pxRect(ctx, x, y, 20, 20, '#5f6d74');
    pxRect(ctx, x + 3, y, 14, 20, '#8e9ca3');
    pxRect(ctx, x + 5, y, 4, 20, '#c4cdd2');
    pxRect(ctx, x + 11, y, 4, 20, '#e4eaed');
    pxRect(ctx, x + 16, y, 2, 20, '#9aa7ad');
  });
  packHiDpi(atlas, 'building_base', 40, 40, (ctx, x, y, w, h) => drawTargetBase(ctx, x, y, w, h, false));
  packHiDpi(atlas, 'building_hit_base', 40, 40, (ctx, x, y, w, h) => drawTargetBase(ctx, x, y, w, h, true));
  for (const kind of ['residential', 'small', 'medium', 'commercial', 'public', 'danger', 'large']) {
    packHiDpi(atlas, `zone_${kind}`, 40, 40, (c, x, y, w, h) => refLot(c, x + 2, y + 2, w - 4, h - 4, kind, 0, 0));
  }
  packHiDpi(atlas, 'building_house', 40, 40, (c, x, y, w, h) => drawHouseSprite(c, x, y, w, h));
  packHiDpi(atlas, 'building_convenience', 40, 40, (c, x, y, w, h) => drawConvenienceSprite(c, x, y, w, h));
  packHiDpi(atlas, 'building_apartment', 40, 80, (c, x, y, w, h) => drawApartmentSprite(c, x, y, w, h));
  packHiDpi(atlas, 'building_gas', 80, 40, (c, x, y, w, h) => drawGasSprite(c, x, y, w, h));
  packHiDpi(atlas, 'building_tower', 80, 80, (c, x, y, w, h) => drawTowerSprite(c, x, y, w, h));
  const personPalettes = [
    { fill: '#dceee7' },
    { fill: '#e9eadf' },
    { fill: '#dbe9f0' },
  ];
  const legsByFrame = [[1, 0], [0, 1], [0, 0]];
  for (let variant = 0; variant < personPalettes.length; variant += 1) {
    for (let frame = 0; frame < 3; frame += 1) {
      packHiDpi(atlas, `person_${variant}_${frame}`, 8, 10, (ctx, x, y) => {
        const palette = personPalettes[variant];
        const [lLeg, rLeg] = legsByFrame[frame];
        pxRect(ctx, x + 2, y + 9, 4, 1, 'rgba(4,20,31,.18)');
        pxRect(ctx, x + 2, y + 0, 4, 3, '#1f3a46');
        pxRect(ctx, x + 3, y + 1, 2, 1, palette.fill);
        pxRect(ctx, x + 2, y + 3, 4, 4, '#1f3a46');
        pxRect(ctx, x + 3, y + 4, 2, 2, palette.fill);
        pxRect(ctx, x + 1, y + 4, 1, 2, '#1f3a46');
        pxRect(ctx, x + 6, y + 4, 1, 2, '#1f3a46');
        pxRect(ctx, x + 2, y + 7, 2, 2 + lLeg, '#1f3a46');
        pxRect(ctx, x + 4, y + 7 + rLeg, 2, 2, '#1f3a46');
      });
    }
  }
  packHiDpi(atlas, 'playfield', WORLD.w, WORLD.h, (ctx, x, y, w, h) => drawPlayfieldSprite(ctx, x, y, w, h));
};

const economy = createMedalEconomy();
const state = { mode: 'ready', fps: 0, fpsS: 0, fpsN: 0, currentBallCost: 0, currentBallPayout: 0, lastBallNet: 0, miningPower: 1, oreMultiplier: 1, cellsMined: 0, peopleCrushed: 0, depthLevel: 0, upgradeCost: 80, ballLostTimer: 0, scrollTextTimer: 0 };
const START_POS = { x: 250, y: 640 };
const ball = { x: START_POS.x, y: START_POS.y, vx: 0, vy: 0, r: BALL_RADIUS, rot: 0, spin: 0, active: false };
const input = { left: false, right: false, pointerSide: 0 };
const touchState = {
  leftPointerId: null,
  rightPointerId: null,
};
const uiButtons = {
  upgrade: { x: 338, y: 18, w: 134, h: 44 },
};
const floatingTexts=[]; const hitSparks=[]; const people=[]; const screenShake={time:0,duration:0,amount:0};
let materialClusters=new Map();
const TERRAIN_DEFS={
  road:{hp:0,value:0,color:'transparent',light:'transparent',dark:'transparent',bounce:0,solid:false},
  house:{hp:2,value:0,color:'#ffe6a7',light:'#fff6c8',dark:'#b93f36',bounce:0.12,people:1},
  shop:{hp:3,value:0,color:'#fff0b8',light:'#fff8d7',dark:'#1d8ec0',bounce:0.14,people:1},
  office:{hp:4,value:0,color:'#4fb5dc',light:'#d7f7ff',dark:'#2d7ca0',bounce:0.16,people:2},
  civic:{hp:5,value:0,color:'#d4e1cf',light:'#f4f8fb',dark:'#5a6870',bounce:0.18,people:2},
  tower:{hp:6,value:0,color:'#9fd8ec',light:'#ffffff',dark:'#214b68',bounce:0.2,people:3},
  empty:{hp:0,value:0,color:'transparent',light:'transparent',dark:'transparent',bounce:0,people:0}
};
const walls=[{x:25,y:PLAYFIELD_TOP_Y,w:10,h:765-PLAYFIELD_TOP_Y},{x:465,y:PLAYFIELD_TOP_Y,w:10,h:765-PLAYFIELD_TOP_Y},{x:25,y:PLAYFIELD_TOP_Y,w:450,h:10}];
const rails=[{ x1: 25, y1: 620, x2: 160, y2: 704, r: 11, restitution: PHYSICS.railBounce, friction: PHYSICS.railFriction }, { x1: 475, y1: 620, x2: 340, y2: 704, r: 11, restitution: PHYSICS.railBounce, friction: PHYSICS.railFriction }];
const flippers={left:{pivot:{x:160,y:704},length:84,radius:11,base:0.46,active:-0.50,angle:0.46,prev:0.46,upImpulse:680,fxCooldown:0},right:{pivot:{x:340,y:704},length:84,radius:11,base:Math.PI-0.46,active:Math.PI+0.50,angle:Math.PI-0.46,prev:Math.PI-0.46,upImpulse:680,fxCooldown:0}};
function resolveAABB(body, box, restitution = PHYSICS.wallBounce) {
  const px = clamp(body.x, box.x, box.x + box.w);
  const py = clamp(body.y, box.y, box.y + box.h);
  let nx = body.x - px;
  let ny = body.y - py;
  let d2 = nx * nx + ny * ny;
  if (d2 > body.r * body.r) return false;
  if (d2 < 1e-10) {
    const dl = Math.abs(body.x - box.x);
    const dr = Math.abs(box.x + box.w - body.x);
    const dt = Math.abs(body.y - box.y);
    const db = Math.abs(box.y + box.h - body.y);
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) { nx = -1; ny = 0; }
    else if (m === dr) { nx = 1; ny = 0; }
    else if (m === dt) { nx = 0; ny = -1; }
    else { nx = 0; ny = 1; }
    d2 = 1;
  } else {
    const d = Math.sqrt(d2);
    nx /= d; ny /= d;
  }
  const pen = body.r - Math.sqrt(Math.max(d2, 1e-10)) + 0.55;
  body.x += nx * pen;
  body.y += ny * pen;
  const vn = body.vx * nx + body.vy * ny;
  if (vn < 0) {
    body.vx -= (1 + restitution) * vn * nx;
    body.vy -= (1 + restitution) * vn * ny;
  }
  return true;
}

function segmentCapsuleHit(body, seg, rollingBias = 0) {
  const abx = seg.x2 - seg.x1;
  const aby = seg.y2 - seg.y1;
  const apx = body.x - seg.x1;
  const apy = body.y - seg.y1;
  const ab2 = abx * abx + aby * aby;
  const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
  const cx = seg.x1 + abx * t;
  const cy = seg.y1 + aby * t;
  const dx = body.x - cx;
  const dy = body.y - cy;
  const rr = body.r + seg.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return null;
  const d = Math.max(0.0001, Math.sqrt(d2));
  const nx = dx / d;
  const ny = dy / d;
  const pen = rr - d;
  body.x += nx * pen;
  body.y += ny * pen;
  const vn = body.vx * nx + body.vy * ny;
  if (vn < 0) {
    const rebound = (1 + seg.restitution) * vn;
    body.vx -= rebound * nx;
    body.vy -= rebound * ny;
  }
  const tx = -ny;
  const ty = nx;
  const vt = body.vx * tx + body.vy * ty;
  const grip = clamp(seg.friction + rollingBias * 0.08, 0, 0.999);
  const newVt = vt * grip;
  body.vx += (newVt - vt) * tx;
  body.vy += (newVt - vt) * ty;
  return { nx, ny, t, cx, cy };
}

function flipperSegment(f, angle = f.angle) {
  return {
    x1: f.pivot.x, y1: f.pivot.y,
    x2: f.pivot.x + Math.cos(angle) * f.length,
    y2: f.pivot.y + Math.sin(angle) * f.length,
    r: f.radius, restitution: PHYSICS.flipperBounce, friction: PHYSICS.flipperFriction,
  };
}

function applyFlipperImpulse(f, hit, sdt) {
  const omega = (f.angle - f.prev) / Math.max(sdt, 0.0001);
  const rx = hit.cx - f.pivot.x;
  const ry = hit.cy - f.pivot.y;
  const surfaceVx = -omega * ry;
  const surfaceVy = omega * rx;
  const relVx = ball.vx - surfaceVx;
  const relVy = ball.vy - surfaceVy;
  const relN = relVx * hit.nx + relVy * hit.ny;
  if (relN >= 0) return null;
  const tipPower = 0.54 + hit.t * 0.22;
  const boost = clamp(((-relN) * 0.74 + Math.abs(omega) * f.length * 0.13) * tipPower, 0, f.upImpulse);
  const side = f.pivot.x < WORLD.w * 0.5 ? 1 : -1;
  const sweet = hit.t >= 0.42 && hit.t <= 0.88;
  const tangentX = -ry;
  const tangentY = rx;
  const tangentLen = Math.hypot(tangentX, tangentY) || 1;
  const tx = tangentX / tangentLen;
  const ty = tangentY / tangentLen;
  ball.vx += hit.nx * boost * 0.54 + tx * boost * 0.16;
  ball.vy += hit.ny * boost * 0.54 + ty * boost * 0.16;
  ball.vy -= boost * 0.04;
  const targetVx = side * (220 + hit.t * 230);
  const targetVy = -(560 + hit.t * 360 + (sweet ? 90 : 0));
  const blend = sweet ? 0.32 : 0.20;
  ball.vx += (targetVx - ball.vx) * blend;
  ball.vy += (targetVy - ball.vy) * blend;
  ball.spin = clamp(ball.spin + (boost / Math.max(ball.r, 1)) * (hit.t > 0.5 ? 0.10 : 0.07), -7, 7);
  return { sweet, side, power: boost };
}

function clampBallSpeed() { const max = ball.vy < -20 ? PHYSICS.maxUpwardBallSpeed : PHYSICS.maxBallSpeed; const speed = Math.hypot(ball.vx, ball.vy); if (speed > max) { const k = max / speed; ball.vx *= k; ball.vy *= k; } }
function ensureMinBallSpeed(min = 360) { const speed = Math.hypot(ball.vx, ball.vy); if (speed > 0 && speed < min) { const k = min / speed; ball.vx *= k; ball.vy *= k; } }

function circleOverlapsBox(body, box) { const nearestX = clamp(body.x, box.x, box.x + box.w); const nearestY = clamp(body.y, box.y, box.y + box.h); const dx = body.x - nearestX; const dy = body.y - nearestY; return dx * dx + dy * dy <= body.r * body.r; }

function resolveFlipperHit(f, pressed, sdt) {
  const delta = f.angle - f.prev;
  const sweepSteps = clamp(Math.ceil(Math.abs(delta) / 0.08), 1, 8);
  for (let i = 0; i <= sweepSteps; i += 1) {
    const angle = f.prev + delta * (i / sweepSteps);
    const hit = segmentCapsuleHit(ball, flipperSegment(f, angle), 0.75);
    if (!hit) continue;
    let shot = null;
    if (pressed && Math.abs(delta) > 0.0005) {
      shot = applyFlipperImpulse(f, hit, sdt);
      clampBallSpeed();
      ensureMinBallSpeed(shot?.sweet ? PHYSICS.minFlipperBallSpeed + 80 : PHYSICS.minFlipperBallSpeed);
    }
    if (f.fxCooldown <= 0) {
      hitSparks.push({x:hit.cx,y:hit.cy,life:0.16,color:shot?.sweet?'#68e4ff':'#fff7bf'});
      playSfx(shot?.sweet ? 'sweet' : 'flipper', shot?.sweet ? 0.96 : pressed ? 0.72 : 0.48, worldPan(hit.cx));
      f.fxCooldown = pressed ? 0.08 : 0.12;
    }
    return true;
  }
  return false;
}

const drain = { x0: 228, x1: 272, y: 760 };
function addScreenShake(a=2,d=0.08){screenShake.amount=Math.max(screenShake.amount,a);screenShake.duration=Math.max(screenShake.duration,d);screenShake.time=Math.max(screenShake.time,d)}
function pickTerrainType(depth){
  const p=(depth*37)%100;
  if(p<34)return'house';
  if(p<54)return'shop';
  if(p<74)return'office';
  if(p<90)return'civic';
  return'tower';
}
function emptyTerrainCell(){
  return {type:'empty',hp:0,maxHp:0,value:0,solid:false,seed:0,clusterId:null};
}
function terrainMineBottomY(){
  return flippers.left.pivot.y-TERRAIN.digEndBuffer;
}
function isTerrainSafeCell(row,col){
  const worldY=TERRAIN.top+row*TERRAIN.cell;
  return worldY<TERRAIN.digStartY || worldY>terrainMineBottomY();
}
function makeTerrainCell(depth,row=0,col=0){
  if(isTerrainSafeCell(row,col)) return emptyTerrainCell();
  const localRow=row%9, localCol=col%10;
  if(localRow===0||localCol===0||localRow===8||localCol===9) return emptyTerrainCell();
  const lotRow=Math.floor(row/9);
  const lotCol=Math.floor(col/10);
  const selector=(lotRow*7+lotCol*11+Math.floor(depth))%100;
  const type=selector<32?'house':selector<52?'shop':selector<76?'office':selector<91?'civic':'tower';
  const def=TERRAIN_DEFS[type];
  const hp=def.hp+Math.floor((localRow+localCol)%3);
  return {type,hp,maxHp:hp,value:0,solid:true,seed:(selector+localRow*13+localCol*17)%100/100,clusterId:null};
}
function applyOreClusters(){
  // City lots are generated directly by makeTerrainCell; no ore pass is used.
}
function rebuildMaterialClusters(){
  materialClusters=new Map();
  let nextId=1;
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  for(let row=0;row<TERRAIN.rows;row++) for(let col=0;col<TERRAIN.cols;col++){
    const start=TERRAIN.pixels[row]?.[col];
    if(!start?.solid || start.clusterId) continue;
    const id=`cluster_${nextId++}`;
    const stack=[[row,col]];
    let totalHp=0,totalValue=0,count=0;
    start.clusterId=id;
    while(stack.length){
      const [r,c]=stack.pop();
      const cell=TERRAIN.pixels[r]?.[c];
      if(!cell?.solid || cell.type!==start.type || cell.clusterId!==id) continue;
      totalHp+=Math.max(1,cell.hp);
      totalValue+=Math.max(0,cell.value);
      count+=1;
      for(const [dr,dc] of dirs){
        const rr=r+dr,cc=c+dc;
        const n=TERRAIN.pixels[rr]?.[cc];
        if(!n?.solid || n.type!==start.type || n.clusterId) continue;
        n.clusterId=id;
        stack.push([rr,cc]);
      }
    }
    const clusterHp=Math.max(2,Math.ceil(Math.sqrt(count))*(TERRAIN_DEFS[start.type]?.hp||2));
    materialClusters.set(id,{id,type:start.type,hp:clusterHp,maxHp:clusterHp,value:totalValue,cells:count});
  }
}
function initTerrain(){
  TERRAIN.pixels=Array.from({length:TERRAIN.rows},(_,row)=>Array.from({length:TERRAIN.cols},(_,col)=>{
    const depth=state.depthLevel+(TERRAIN.rows-1-row);
    return makeTerrainCell(depth,row,col);
  }));
  applyOreClusters();
  rebuildMaterialClusters();
}
function terrainCellBox(row,col){
  return {x:TERRAIN.left+col*TERRAIN.cell,y:TERRAIN.top+row*TERRAIN.cell,w:TERRAIN.cell,h:TERRAIN.cell};
}
function circleIntersectsCell(cx,cy,radius,row,col){
  const box=terrainCellBox(row,col);
  const px=clamp(cx,box.x,box.x+box.w);
  const py=clamp(cy,box.y,box.y+box.h);
  const dx=cx-px,dy=cy-py;
  return dx*dx+dy*dy<=radius*radius;
}
function addTerrainSparks(x,y,color,count=4,force=1){
  const room=Math.max(0,120-hitSparks.length);
  const n=Math.min(room,count);
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2;
    const sp=randRange(24,92)*force;
    hitSparks.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-randRange(10,48),life:randRange(0.18,0.34),maxLife:0.34,color,size:randRange(2,4)});
  }
}
function isOreType(type){ return false; }
function formatOreGain(value){ return clamp(Math.floor(value),1,9); }
function awardMedals(amount, source, x, y, color) {
  const payout = economy.payout(amount, source);
  if (payout <= 0) return 0;
  state.currentBallPayout += payout;
  floatingTexts.push({x,y,text:`+${payout} MEDALS`,color,life:0.72});
  return payout;
}
function spawnPeople(x,y,type='house',count=1){
  const room=Math.max(0,60-people.length);
  const total=Math.min(room,count);
  for(let i=0;i<total;i++){
    people.push({
      x:x+randRange(-8,8),
      y:y+randRange(-8,8),
      vx:randRange(-34,34),
      vy:randRange(-18,18),
      r:6,
      type,
      life:999,
      squashed:false,
    });
  }
}
function crushPerson(person){
  if(person.squashed) return;
  person.squashed=true;
  state.peopleCrushed+=1;
  awardMedals(1,'person-crush',person.x,person.y,'#fff36b');
  floatingTexts.push({x:person.x,y:person.y-10,text:'+1 POINT',color:'#fff36b',life:0.7});
  addScreenShake(1.3,0.06);
  playSfx('collect',0.9,worldPan(person.x));
}
function damageTerrainCell(row,col,damage,hitX,hitY,impact=0){
  const cell=TERRAIN.pixels[row]?.[col];
  if(!cell?.solid) return {hit:false,broken:false};
  const def=TERRAIN_DEFS[cell.type];
  if(cell.clusterId){
    const cluster=materialClusters.get(cell.clusterId);
    if(!cluster || cluster.hp<=0) return {hit:false,broken:false};
    cluster.hp-=Math.max(1,damage);
    addTerrainSparks(hitX,hitY,def.light,cluster.hp<=0?6:2,cluster.hp<=0?1.2:0.75);
    if(cluster.hp>0) return {hit:true,broken:false};
    let destroyed=0;
    for(let r=0;r<TERRAIN.rows;r++) for(let c=0;c<TERRAIN.cols;c++){
      const target=TERRAIN.pixels[r]?.[c];
      if(!target?.solid || target.clusterId!==cluster.id) continue;
      target.solid=false; target.type='empty'; target.hp=0; target.clusterId=null;
      destroyed+=1;
    }
    state.cellsMined+=destroyed;
    spawnPeople(hitX,hitY,cluster.type,TERRAIN_DEFS[cluster.type]?.people||1);
    floatingTexts.push({x:hitX,y:hitY,text:'PEOPLE OUT!',color:'#fff6c8',life:0.7});
    materialClusters.delete(cluster.id);
    if(impact>220) addScreenShake(clamp(impact/220,1.2,4.2),0.08);
    return {hit:true,broken:true};
  }
  cell.hp-=Math.max(1,damage);
  addTerrainSparks(hitX,hitY,def.light,cell.hp<=0?5:2,cell.hp<=0?1.15:0.75);
  if(cell.hp>0) return {hit:true,broken:false};
  cell.solid=false; cell.type='empty'; cell.hp=0; state.cellsMined+=1;
  spawnPeople(hitX,hitY,cell.type,TERRAIN_DEFS[cell.type]?.people||1);
  if(impact>220) addScreenShake(clamp(impact/220,1.2,4.2),0.08);
  return {hit:true,broken:true};
}
function digTerrain(cx,cy,radius,power,impact=0){
  const minCol=Math.max(0,Math.floor((cx-radius-TERRAIN.left)/TERRAIN.cell));
  const maxCol=Math.min(TERRAIN.cols-1,Math.floor((cx+radius-TERRAIN.left)/TERRAIN.cell));
  const minRow=Math.max(0,Math.floor((cy-radius-TERRAIN.top)/TERRAIN.cell));
  const maxRow=Math.min(TERRAIN.rows-1,Math.floor((cy+radius-TERRAIN.top)/TERRAIN.cell));
  let touched=0,broken=0;
  for(let row=minRow;row<=maxRow;row++) for(let col=minCol;col<=maxCol;col++){
    const cell=TERRAIN.pixels[row]?.[col]; if(!cell?.solid) continue;
    if(!circleIntersectsCell(cx,cy,radius,row,col)) continue;
    const box=terrainCellBox(row,col);
    const ccx=box.x+box.w*0.5,ccy=box.y+box.h*0.5;
    const dist=Math.hypot(ccx-cx,ccy-cy);
    const falloff=clamp(1-dist/Math.max(1,radius+TERRAIN.cell),0.35,1);
    const result=damageTerrainCell(row,col,Math.floor(power*falloff),ccx,ccy,impact);
    if(result.hit)touched+=1;
    if(result.broken)broken+=1;
  }
  if(touched>0) playSfx(broken>0?'crush':'hit',clamp(0.45+broken*0.12+impact/900,0.45,1.15),worldPan(cx));
  return {touched,broken};
}
function updatePeople(dt){
  for(let i=people.length-1;i>=0;i--){
    const person=people[i];
    if(person.squashed){people.splice(i,1);continue;}
    person.x+=person.vx*dt;
    person.y+=person.vy*dt;
    person.vx*=0.985;
    person.vy*=0.985;
    const minX=TERRAIN.left+12, maxX=TERRAIN.left+TERRAIN.cols*TERRAIN.cell-12;
    const minY=TERRAIN.top+18, maxY=terrainMineBottomY()-10;
    if(person.x<minX||person.x>maxX){person.x=clamp(person.x,minX,maxX);person.vx*=-0.75;}
    if(person.y<minY||person.y>maxY){person.y=clamp(person.y,minY,maxY);person.vy*=-0.75;}
    if(ball.active&&Math.hypot(ball.x-person.x,ball.y-person.y)<ball.r+person.r){
      crushPerson(person);
      people.splice(i,1);
    }
  }
}
function resolveTerrainCollision(body){
  const rad=body.r+2;
  const minCol=Math.max(0,Math.floor((body.x-rad-TERRAIN.left)/TERRAIN.cell));
  const maxCol=Math.min(TERRAIN.cols-1,Math.floor((body.x+rad-TERRAIN.left)/TERRAIN.cell));
  const minRow=Math.max(0,Math.floor((body.y-rad-TERRAIN.top)/TERRAIN.cell));
  const maxRow=Math.min(TERRAIN.rows-1,Math.floor((body.y+rad-TERRAIN.top)/TERRAIN.cell));
  let nx=0,ny=0,hits=0,b=0.1,maxPen=0,contactX=body.x,contactY=body.y;
  for(let row=minRow;row<=maxRow;row++) for(let col=minCol;col<=maxCol;col++){
    const cell=TERRAIN.pixels[row]?.[col]; if(!cell?.solid) continue;
    const box=terrainCellBox(row,col);
    let px=clamp(body.x,box.x,box.x+box.w);
    let py=clamp(body.y,box.y,box.y+box.h);
    let dx=body.x-px,dy=body.y-py;
    let d2=dx*dx+dy*dy;
    if(d2>body.r*body.r) continue;
    let d=Math.sqrt(Math.max(d2,1e-8));
    let cnx=dx/d,cny=dy/d;
    if(d2<1e-8){
      const dl=Math.abs(body.x-box.x),dr=Math.abs(box.x+box.w-body.x),dt=Math.abs(body.y-box.y),db=Math.abs(box.y+box.h-body.y);
      const m=Math.min(dl,dr,dt,db);
      if(m===dl){cnx=-1;cny=0;px=box.x;py=body.y;}
      else if(m===dr){cnx=1;cny=0;px=box.x+box.w;py=body.y;}
      else if(m===dt){cnx=0;cny=-1;px=body.x;py=box.y;}
      else{cnx=0;cny=1;px=body.x;py=box.y+box.h;}
      d=0;
    }
    const pen=body.r-d;
    nx+=cnx*Math.max(0.2,pen);
    ny+=cny*Math.max(0.2,pen);
    hits+=1;
    if(pen>maxPen){maxPen=pen;contactX=px;contactY=py;}
    b=Math.max(b,TERRAIN_DEFS[cell.type].bounce);
  }
  if(!hits) return false;
  const len=Math.hypot(nx,ny)||1; nx/=len; ny/=len;
  const impact=Math.max(0,-(body.vx*nx+body.vy*ny));
  const impactPower=Math.max(1,Math.floor(impact/190));
  const digRadius=clamp(body.r*(1.08+state.miningPower*0.08)+impact*0.012,body.r*1.05,body.r*1.85);
  const dig=digTerrain(contactX,contactY,digRadius,state.miningPower+impactPower,impact);
  body.x+=nx*(maxPen+0.65); body.y+=ny*(maxPen+0.65);
  const vn=body.vx*nx+body.vy*ny;
  const rebound=dig.broken>0?b*0.55:b;
  if(vn<0){body.vx-=(1+rebound)*vn*nx; body.vy-=(1+rebound)*vn*ny;}
  const drag=dig.broken>0?0.952:0.982;
  body.vx*=drag; body.vy*=drag;
  return true;
}
function launchBall(){
  if(state.mode!=='ready') return;
  if(!economy.spend(BALL_COST, 'medal-pin-ball')){
    floatingTexts.push({x:WORLD.w*0.5,y:150,text:'NEED 10 MEDALS',color:'#ffb36b',life:0.9});
    playSfx('drain',0.5,0);
    return;
  }
  state.currentBallCost=BALL_COST;
  state.currentBallPayout=0;
  ball.x=START_POS.x; ball.y=START_POS.y; ball.active=true; ball.vx=randRange(-120,120); ball.vy=-980; ball.spin=0; state.mode='playing'; playSfx('launch',1,worldPan(ball.x));
}
function resetBall(){ball.x=START_POS.x;ball.y=START_POS.y;ball.vx=0;ball.vy=0;ball.rot=0;ball.spin=0;ball.active=false;state.mode='ready'}
function restartRun(){economy.reset();state.currentBallCost=0;state.currentBallPayout=0;state.lastBallNet=0;state.miningPower=1;state.oreMultiplier=1;state.cellsMined=0;state.peopleCrushed=0;state.depthLevel=0;state.upgradeCost=80;state.scrollTextTimer=0;floatingTexts.length=0;hitSparks.length=0;people.length=0;initTerrain();resetBall();}
function shouldScrollTerrain(){
  return false;
}
function scrollTerrainForward(rows=8){state.scrollTextTimer=0; void rows;}
function tryUpgrade(){if(!economy.spend(state.upgradeCost, 'pin-upgrade')) return; state.miningPower+=1; state.upgradeCost=Math.floor(state.upgradeCost*1.6); floatingTexts.push({x:WORLD.w*0.5,y:140,text:`POWER ${state.miningPower}!`,color:'#fff36b',life:0.8}); playSfx('upgrade',1,0)}
function startFromFlipper(side){
  if(state.mode==='ready') launchBall();
  playSfx('flipper',0.6,side);
}
addEventListener('keydown',(e)=>{unlockAudio(); if((e.code==='ArrowLeft'||e.code==='KeyA')&&!input.left){input.left=true;startFromFlipper(-0.45);} if((e.code==='ArrowRight'||e.code==='KeyD')&&!input.right){input.right=true;startFromFlipper(0.45);} if(e.code==='Space'){e.preventDefault(); launchBall();} if(e.code==='KeyU') tryUpgrade(); if(e.code==='KeyR') restartRun();});
addEventListener('keyup',(e)=>{if(e.code==='ArrowLeft'||e.code==='KeyA') input.left=false; if(e.code==='ArrowRight'||e.code==='KeyD') input.right=false;});
function pointerToWorld(clientX, clientY) {
  const rect = uiCanvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (WORLD.w / rect.width);
  const y = (clientY - rect.top) * (WORLD.h / rect.height);
  return { x, y };
}
function pointInRect(pt, rect) {
  return pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
}
function handlePointerDown(e) {
  unlockAudio();
  const pt = pointerToWorld(e.clientX, e.clientY);
  if (pointInRect(pt, uiButtons.upgrade)) {
    tryUpgrade();
    uiCanvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    return;
  }
  const isBottomHalf = pt.y > WORLD.h * 0.52;
  if (isBottomHalf) {
    if (pt.x < WORLD.w * 0.5 && touchState.leftPointerId === null) {
      touchState.leftPointerId = e.pointerId;
      if (!input.left) startFromFlipper(-0.45);
      input.left = true;
    } else if (pt.x >= WORLD.w * 0.5 && touchState.rightPointerId === null) {
      touchState.rightPointerId = e.pointerId;
      if (!input.right) startFromFlipper(0.45);
      input.right = true;
    }
  }
  uiCanvas.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}
function releasePointer(pointerId) {
  if (touchState.leftPointerId === pointerId) {
    touchState.leftPointerId = null;
    input.left = false;
  }
  if (touchState.rightPointerId === pointerId) {
    touchState.rightPointerId = null;
    input.right = false;
  }
}
function handlePointerUp(e) {
  releasePointer(e.pointerId);
  e.preventDefault();
}
uiCanvas.style.touchAction = 'none';
uiCanvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
uiCanvas.addEventListener('pointerup', handlePointerUp, { passive: false });
uiCanvas.addEventListener('pointercancel', handlePointerUp, { passive: false });
addEventListener('blur',()=>{input.left=false;input.right=false;touchState.leftPointerId=null;touchState.rightPointerId=null;});
function updateFlipper(f, pressed, dt){const target=pressed?f.active:f.base; const maxStep=(pressed?13:8)*dt; f.prev=f.angle; f.angle+=clamp(target-f.angle,-maxStep,maxStep); f.fxCooldown=Math.max(0,f.fxCooldown-dt);}
function isFiniteBallState(){return Number.isFinite(ball.x)&&Number.isFinite(ball.y)&&Number.isFinite(ball.vx)&&Number.isFinite(ball.vy)&&Number.isFinite(ball.spin)&&Number.isFinite(ball.rot);}
function recoverFromBrokenPhysics(){floatingTexts.push({x:WORLD.w*0.5,y:150,text:'PHYSICS RESET',color:'#ffd38f',life:0.8}); playSfx('levelReady',0.8,0); resetBall();}
function drainBall(){
  const net=economy.completePlay({cost:state.currentBallCost,payout:state.currentBallPayout,source:'medal-pin'});
  state.lastBallNet=net;
  floatingTexts.push({x:WORLD.w*0.5,y:650,text:`BALL NET ${net>=0?'+':''}${net}`,color:net>=0?'#fff36b':'#ffb36b',life:1});
  ball.active=false; state.mode='ball_lost'; state.ballLostTimer=0.7;
}
function update(dt){if(!isFiniteBallState()){recoverFromBrokenPhysics();return;} state.fpsS+=dt;state.fpsN+=1;if(state.fpsS>0.3){state.fps=Math.round(state.fpsN/state.fpsS);state.fpsS=0;state.fpsN=0;} if(screenShake.time>0){screenShake.time=Math.max(0,screenShake.time-dt); if(screenShake.time<=0)screenShake.amount=0;}
for(let i=floatingTexts.length-1;i>=0;i--){const t=floatingTexts[i];t.life-=dt;t.y-=28*dt;if(t.life<=0)floatingTexts.splice(i,1);} for(let i=hitSparks.length-1;i>=0;i--){const s=hitSparks[i];s.life-=dt;s.x+=(s.vx||0)*dt;s.y+=(s.vy||0)*dt;s.vy=(s.vy||0)+180*dt;if(s.life<=0)hitSparks.splice(i,1);} updatePeople(dt); updateFlipper(flippers.left,input.left,dt);updateFlipper(flippers.right,input.right,dt);
if(state.mode==='ready'){ball.x=START_POS.x;ball.y=START_POS.y;return;} if(state.mode==='ball_lost'){state.ballLostTimer-=dt; if(state.ballLostTimer<=0) resetBall(); return;}
const speed=len2(ball.vx,ball.vy); const substeps=clamp(Math.ceil((speed*dt)/(ball.r*0.32)),1,8); const sdt=dt/substeps;
for(let s=0;s<substeps;s++){ball.vy+=PHYSICS.gravity*sdt; ball.vx*=PHYSICS.airDrag; ball.vy*=PHYSICS.airDrag; ball.x+=ball.vx*sdt; ball.y+=ball.vy*sdt; for (const w of walls) resolveAABB(ball, w, PHYSICS.wallBounce); for (const seg of rails) segmentCapsuleHit(ball, seg); for(const key of ['left','right']) resolveFlipperHit(flippers[key],key==='left'?input.left:input.right,sdt);
resolveTerrainCollision(ball);
ball.vx *= PHYSICS.rollingFriction;
ball.vy *= PHYSICS.rollingFriction;
ball.spin *= PHYSICS.spinDamping;
ball.rot += ball.spin * sdt;
const speedNow = Math.hypot(ball.vx, ball.vy);
if (speedNow > PHYSICS.maxBallSpeed) {
  const scale = PHYSICS.maxBallSpeed / speedNow;
  ball.vx *= scale;
  ball.vy *= scale;
}
if (ball.vy < -PHYSICS.maxUpwardBallSpeed) ball.vy = -PHYSICS.maxUpwardBallSpeed;
if(ball.y>WORLD.h+30||(ball.y>drain.y&&ball.x>drain.x0&&ball.x<drain.x1)){playSfx('drain',0.9,worldPan(ball.x)); drainBall(); break;}}
if(shouldScrollTerrain()) scrollTerrainForward(8);
}
let dpr=1; function resize(){dpr=Math.min(window.devicePixelRatio||1,DPR_MAX); const rect=wrap.getBoundingClientRect(); const w=Math.floor(rect.width*dpr); const h=Math.floor(rect.height*dpr); glCanvas.width=w; glCanvas.height=h; uiCanvas.width=w; uiCanvas.height=h; gl.viewport(0,0,w,h);} addEventListener('resize',resize);
const atlas = new RuntimeAtlas(gl, 2048); registerAtlasSprites(atlas); atlas.upload(); const renderer = new SpriteRenderer(gl, atlas);
function getShakeOffset(){if(screenShake.time<=0||screenShake.duration<=0) return {x:0,y:0}; const r=screenShake.time/screenShake.duration; const p=screenShake.amount*r*r; return {x:Math.sin(screenShake.time*117)*p,y:Math.cos(screenShake.time*151)*p};}
function renderLegacy(){const sx=glCanvas.width/WORLD.w, sy=glCanvas.height/WORLD.h, shake=getShakeOffset(); glCanvas.style.transform=shake.x||shake.y?`translate(${shake.x}px, ${shake.y}px)`:''; renderer.begin(); const fieldSpr=atlas.entries.get('playfield'); const wallSpr=atlas.entries.get('wall'); const flipSpr=atlas.entries.get('flipper'); const ballSpr=atlas.entries.get('ball'); renderer.pushSprite(fieldSpr,0,0,glCanvas.width,glCanvas.height); for(const w of walls) renderer.pushSprite(wallSpr,w.x*sx,w.y*sy,w.w*sx,w.h*sy); for(const seg of rails){const dx=seg.x2-seg.x1,dy=seg.y2-seg.y1,len=Math.hypot(dx,dy),ang=Math.atan2(dy,dx); renderer.pushSprite(wallSpr,seg.x1*sx,(seg.y1-seg.r)*sy,len*sx,seg.r*2*sy,ang,0,0.5);} for(const key of ['left','right']){const f=flippers[key]; const seg=flipperSegment(f); const ang=Math.atan2(seg.y2-seg.y1,seg.x2-seg.x1); renderer.pushSprite(flipSpr,seg.x1*sx,(seg.y1-f.radius)*sy,f.length*sx,f.radius*2*sy,ang,0,0.5);} if(ball.active||state.mode==='ready') renderer.pushSprite(ballSpr,(ball.x-ball.r)*sx,(ball.y-ball.r)*sy,ball.r*2*sx,ball.r*2*sy,ball.rot); renderer.flush(glCanvas.width,glCanvas.height);
uiCtx.clearRect(0,0,uiCanvas.width,uiCanvas.height); uiCtx.save(); uiCtx.scale(dpr,dpr); const vw=uiCanvas.width/dpr,vh=uiCanvas.height/dpr;
for(let row=0;row<TERRAIN.rows;row++)for(let col=0;col<TERRAIN.cols;col++){const cell=TERRAIN.pixels[row][col]; if(!cell?.solid) continue; const x=(TERRAIN.left+col*TERRAIN.cell)*(vw/WORLD.w), y=(TERRAIN.top+row*TERRAIN.cell)*(vh/WORLD.h), cs=TERRAIN.cell*(vw/WORLD.w); uiCtx.fillStyle=TERRAIN_DEFS[cell.type].color; uiCtx.fillRect(x,y,cs,cs); if(cell.hp<cell.maxHp && cell.type!=='bedrock'){uiCtx.strokeStyle='rgba(0,0,0,0.25)'; uiCtx.beginPath(); uiCtx.moveTo(x+1,y+1); uiCtx.lineTo(x+cs-1,y+cs-1); uiCtx.stroke();}}
for(const s of hitSparks){uiCtx.globalAlpha=s.life/0.2; uiCtx.fillStyle=s.color; uiCtx.fillRect(s.x*(vw/WORLD.w)-2,s.y*(vh/WORLD.h)-2,4,4);} uiCtx.globalAlpha=1;
const econ=economy.state;
uiCtx.fillStyle='rgba(10,22,34,0.8)'; uiCtx.fillRect(10,8,420,108); uiCtx.fillStyle='#fff'; uiCtx.font='700 18px monospace'; uiCtx.fillText(`MEDALS ${econ.medals.toLocaleString()}`,20,30); uiCtx.fillText(`BALL ${BALL_COST}`,20,50); uiCtx.fillText(`NET ${econ.sessionNet>=0?'+':''}${econ.sessionNet}`,20,70); uiCtx.fillText(`MINED ${state.cellsMined}`,180,50); uiCtx.fillText(`UPGRADE U: ${state.upgradeCost}`,180,70); uiCtx.fillText(`LAST ${state.lastBallNet>=0?'+':''}${state.lastBallNet}`,180,90); uiCtx.font='600 14px monospace'; uiCtx.fillText('KEY: ←/A →/D SPACE U R  |  TOUCH: 下半分左右タップで操作',20,106);
for(const t of floatingTexts){uiCtx.globalAlpha=clamp(t.life,0,1); uiCtx.fillStyle=t.color; uiCtx.font='700 20px monospace'; uiCtx.fillText(t.text,t.x*(vw/WORLD.w),t.y*(vh/WORLD.h));} uiCtx.globalAlpha=1; uiCtx.restore();}
function drawTerrainLayer(vw,vh){
  const sx=vw/WORLD.w, sy=vh/WORLD.h;
  uiCtx.fillStyle='rgba(88,95,98,.38)';
  for(let row=0;row<TERRAIN.rows;row+=9){
    const y=(TERRAIN.top+row*TERRAIN.cell)*sy;
    uiCtx.fillRect(TERRAIN.left*sx,y,TERRAIN.cols*TERRAIN.cell*sx,TERRAIN.cell*sy);
  }
  for(let col=0;col<TERRAIN.cols;col+=10){
    const x=(TERRAIN.left+col*TERRAIN.cell)*sx;
    uiCtx.fillRect(x,TERRAIN.digStartY*sy,TERRAIN.cell*sx,(terrainMineBottomY()-TERRAIN.digStartY)*sy);
  }
  for(let row=0;row<TERRAIN.rows;row++)for(let col=0;col<TERRAIN.cols;col++){
    const cell=TERRAIN.pixels[row][col]; if(!cell?.solid) continue;
    const def=TERRAIN_DEFS[cell.type];
    const x=(TERRAIN.left+col*TERRAIN.cell)*sx, y=(TERRAIN.top+row*TERRAIN.cell)*sy, cw=TERRAIN.cell*sx, ch=TERRAIN.cell*sy;
    uiCtx.fillStyle=def.color; uiCtx.fillRect(x,y,cw+0.5,ch+0.5);
    uiCtx.fillStyle=def.light; uiCtx.globalAlpha=0.22+(cell.seed||0)*0.16; uiCtx.fillRect(x+1,y+1,Math.max(1,cw-2),1);
    uiCtx.fillStyle=def.dark; uiCtx.globalAlpha=0.22; uiCtx.fillRect(x+1,y+ch-2,Math.max(1,cw-2),1);
    if((row+col)%3===0){
      uiCtx.globalAlpha=0.55;
      uiCtx.fillStyle='#dffaff';
      uiCtx.fillRect(x+cw*0.28,y+ch*0.25,Math.max(1,cw*0.22),Math.max(1,ch*0.22));
    }
    uiCtx.globalAlpha=1;
    const cluster=cell.clusterId?materialClusters.get(cell.clusterId):null;
    const hpBase=cluster?cluster.maxHp:cell.maxHp;
    const hpNow=cluster?cluster.hp:cell.hp;
    if(hpNow<hpBase && cell.type!=='bedrock'){
      const hurt=1-hpNow/hpBase;
      uiCtx.strokeStyle=`rgba(28,20,15,${0.28+hurt*0.42})`;
      uiCtx.lineWidth=Math.max(1,sx);
      uiCtx.beginPath();
      uiCtx.moveTo(x+cw*0.18,y+ch*0.22);
      uiCtx.lineTo(x+cw*0.72,y+ch*0.78);
      if(hurt>0.55){uiCtx.moveTo(x+cw*0.78,y+ch*0.24);uiCtx.lineTo(x+cw*0.38,y+ch*0.58);}
      uiCtx.stroke();
    }
  }
}
function drawPeople(vw,vh){
  const sx=vw/WORLD.w, sy=vh/WORLD.h;
  for(const person of people){
    const x=person.x*sx, y=person.y*sy, r=person.r*sx;
    uiCtx.fillStyle='rgba(0,0,0,.18)';
    uiCtx.beginPath(); uiCtx.ellipse(x+2,y+4,r*0.75,r*0.38,0,0,Math.PI*2); uiCtx.fill();
    uiCtx.fillStyle='#26343d';
    uiCtx.fillRect(x-r*0.45,y-r*0.1,r*0.9,r*1.15);
    uiCtx.fillStyle='#ffe0b6';
    uiCtx.beginPath(); uiCtx.arc(x,y-r*0.52,r*0.58,0,Math.PI*2); uiCtx.fill();
    uiCtx.fillStyle='#68e4ff';
    uiCtx.fillRect(x-r*0.52,y+r*0.12,r*1.04,r*0.38);
  }
}
function drawUiBall(vw,vh){
  if(!ball.active&&state.mode!=='ready') return;
  const sx=vw/WORLD.w, sy=vh/WORLD.h, x=ball.x*sx, y=ball.y*sy, r=ball.r*sx;
  uiCtx.save();
  uiCtx.translate(x,y);
  uiCtx.rotate(ball.rot);
  const g=uiCtx.createRadialGradient(-r*0.35,-r*0.35,r*0.08,0,0,r);
  g.addColorStop(0,'#ffffff'); g.addColorStop(0.45,'#cdd6dc'); g.addColorStop(1,'#56616b');
  uiCtx.fillStyle='rgba(8,13,18,.25)'; uiCtx.beginPath(); uiCtx.ellipse(r*0.14,r*0.22,r*0.92,r*0.82,0,0,Math.PI*2); uiCtx.fill();
  uiCtx.fillStyle=g; uiCtx.beginPath(); uiCtx.arc(0,0,r,0,Math.PI*2); uiCtx.fill();
  uiCtx.strokeStyle='#34404a'; uiCtx.lineWidth=Math.max(2,r*0.12); uiCtx.beginPath(); uiCtx.arc(0,0,r*0.76,-0.15,1.75); uiCtx.stroke();
  uiCtx.fillStyle='rgba(255,255,255,.72)'; uiCtx.fillRect(-r*0.34,-r*0.42,r*0.44,r*0.12);
  uiCtx.restore();
}
function drawHud(vw,vh){
  const sx=vw/WORLD.w, sy=vh/WORLD.h;
  const econ=economy.state;
  uiCtx.fillStyle='rgba(18,34,42,0.82)'; uiCtx.fillRect(10,8,318,94);
  uiCtx.strokeStyle='#9fd8ec'; uiCtx.lineWidth=2; uiCtx.strokeRect(10.5,8.5,317,93);
  uiCtx.fillStyle='#fff7cf'; uiCtx.font='900 19px ui-monospace, SFMono-Regular, Consolas, monospace'; uiCtx.fillText(`${econ.medals.toLocaleString()} MEDALS`,22,33);
  uiCtx.fillStyle='#bfeeff'; uiCtx.font='700 13px ui-monospace, SFMono-Regular, Consolas, monospace';
  uiCtx.fillText(`BALL ${BALL_COST}`,22,57); uiCtx.fillText(`LAST ${state.lastBallNet>=0?'+':''}${state.lastBallNet}`,100,57); uiCtx.fillText(`SESSION ${econ.sessionNet>=0?'+':''}${econ.sessionNet}`,202,57);
  uiCtx.fillText(`PWR ${state.miningPower}`,22,80); uiCtx.fillText(`BLD ${state.cellsMined}`,100,80); uiCtx.fillText(`PEOPLE ${state.peopleCrushed}`,202,80);
  const b=uiButtons.upgrade, bx=b.x*sx, by=b.y*sy, bw=b.w*sx, bh=b.h*sy;
  const can=economy.canSpend(state.upgradeCost);
  uiCtx.fillStyle=can?'#fff06a':'rgba(255,255,255,.22)'; uiCtx.fillRect(bx,by,bw,bh);
  uiCtx.strokeStyle=can?'#26343d':'rgba(255,255,255,.35)'; uiCtx.lineWidth=2; uiCtx.strokeRect(bx+0.5,by+0.5,bw-1,bh-1);
  uiCtx.fillStyle=can?'#20313c':'rgba(255,255,255,.7)'; uiCtx.font='900 13px ui-monospace, SFMono-Regular, Consolas, monospace'; uiCtx.textAlign='center';
  uiCtx.fillText('UPGRADE',bx+bw*0.5,by+bh*0.42);
  uiCtx.font='700 11px ui-monospace, SFMono-Regular, Consolas, monospace'; uiCtx.fillText(`${state.upgradeCost} MED`,bx+bw*0.5,by+bh*0.72);
  uiCtx.textAlign='left';
  if(state.mode==='ready'){
    uiCtx.fillStyle='rgba(255,255,255,.88)'; uiCtx.font='900 18px ui-monospace, SFMono-Regular, Consolas, monospace'; uiCtx.textAlign='center';
    uiCtx.fillText('FLIPPER START',vw*0.5,vh*0.18); uiCtx.textAlign='left';
  }
}
function drawTouchPads(vw,vh){
  const coarse=matchMedia('(pointer: coarse)').matches||vw<430;
  if(!coarse) return;
  const y=vh*0.70,h=vh*0.28,w=vw*0.5;
  uiCtx.globalAlpha=0.22;
  uiCtx.fillStyle=input.left?'#fff06a':'#ffffff'; uiCtx.fillRect(0,y,w,h);
  uiCtx.fillStyle=input.right?'#fff06a':'#ffffff'; uiCtx.fillRect(w,y,w,h);
  uiCtx.globalAlpha=0.48; uiCtx.fillStyle='#182c36'; uiCtx.font='900 34px ui-monospace, SFMono-Regular, Consolas, monospace'; uiCtx.textAlign='center';
  uiCtx.fillText('<',w*0.5,y+h*0.56); uiCtx.fillText('>',w+w*0.5,y+h*0.56);
  uiCtx.textAlign='left'; uiCtx.globalAlpha=1;
}
function render(){
  const sx=glCanvas.width/WORLD.w, sy=glCanvas.height/WORLD.h, shake=getShakeOffset();
  glCanvas.style.transform=shake.x||shake.y?`translate(${shake.x}px, ${shake.y}px)`:'';
  renderer.begin();
  const fieldSpr=atlas.entries.get('playfield'); const wallSpr=atlas.entries.get('wall'); const flipSpr=atlas.entries.get('flipper');
  renderer.pushSprite(fieldSpr,0,0,glCanvas.width,glCanvas.height);
  for(const w of walls) renderer.pushSprite(wallSpr,w.x*sx,w.y*sy,w.w*sx,w.h*sy);
  for(const seg of rails){const dx=seg.x2-seg.x1,dy=seg.y2-seg.y1,len=Math.hypot(dx,dy),ang=Math.atan2(dy,dx); renderer.pushSprite(wallSpr,seg.x1*sx,(seg.y1-seg.r)*sy,len*sx,seg.r*2*sy,ang,0,0.5);}
  for(const key of ['left','right']){const f=flippers[key]; const seg=flipperSegment(f); const ang=Math.atan2(seg.y2-seg.y1,seg.x2-seg.x1); renderer.pushSprite(flipSpr,seg.x1*sx,(seg.y1-f.radius)*sy,f.length*sx,f.radius*2*sy,ang,0,0.5);}
  renderer.flush(glCanvas.width,glCanvas.height);
  uiCtx.clearRect(0,0,uiCanvas.width,uiCanvas.height); uiCtx.save(); uiCtx.scale(dpr,dpr); const vw=uiCanvas.width/dpr,vh=uiCanvas.height/dpr;
  drawTerrainLayer(vw,vh);
  for(const s of hitSparks){uiCtx.globalAlpha=clamp(s.life/(s.maxLife||0.2),0,1); uiCtx.fillStyle=s.color; const size=s.size||4; uiCtx.fillRect(s.x*(vw/WORLD.w)-size*0.5,s.y*(vh/WORLD.h)-size*0.5,size,size);}
  uiCtx.globalAlpha=1;
  drawPeople(vw,vh);
  drawUiBall(vw,vh);
  drawTouchPads(vw,vh);
  drawHud(vw,vh);
  for(const t of floatingTexts){uiCtx.globalAlpha=clamp(t.life,0,1); uiCtx.fillStyle=t.color; uiCtx.font='900 19px ui-monospace, SFMono-Regular, Consolas, monospace'; uiCtx.fillText(t.text,t.x*(vw/WORLD.w),t.y*(vh/WORLD.h));}
  uiCtx.globalAlpha=1; uiCtx.restore();
}
let last=performance.now();
function loop(now){
  const dt=clamp((now-last)/1000,0,1/30);
  last=now;
  try {
    update(dt);
    render();
  } catch (err) {
    console.error('Frame error recovered', err);
    recoverFromBrokenPhysics();
  }
  requestAnimationFrame(loop);
}
restartRun(); resize(); requestAnimationFrame(loop);
