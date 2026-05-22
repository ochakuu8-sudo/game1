const DPR_MAX = 2;
const WORLD = { w: 500, h: 800 };

const PHYSICS = {
  gravity: 980,
  airDrag: 0.999,
  rollingFriction: 0.9985,
  wallBounce: 0.78,
  railBounce: 0.72,
  buildingBounce: 0.45,
  flipperBounce: 0.88,
  flipperFriction: 0.995,
  maxBallSpeed: 1100,
  minFlipperBallSpeed: 420,
};

const GRID = {
  cols: 8,
  rows: 8,
  cellSize: 52,
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
GRID.top = 88;
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
      refLot(ctx, gx + col * 40 + 4, gy + row * 40 + 4, 32, 32, ZONE_TEMPLATE[row][col], row, col);
    }
  }
  for (let i = 0; i <= GRID.cols; i += 1) {
    const xx = gx + i * 40;
    pxRect(ctx, xx - 2, gy - 12, 4, gh + 24, '#95a3aa');
    if (i > 0 && i < GRID.cols) for (let yy = gy + 10; yy < gy + gh - 8; yy += 34) pxRect(ctx, xx - 1, yy, 2, 5, '#d9e2e7');
  }
  for (let i = 0; i <= GRID.rows; i += 1) {
    const yy = gy + i * 40;
    pxRect(ctx, gx - 12, yy - 2, gw + 24, 4, '#95a3aa');
    if (i > 0 && i < GRID.rows) for (let xx = gx + 10; xx < gx + gw - 8; xx += 34) pxRect(ctx, xx, yy - 1, 5, 2, '#d9e2e7');
  }
};
drawPlayfieldSprite = function drawPlayfieldSpriteRef(ctx, x, y, w, h) {
  pxRect(ctx, x, y, w, h, '#cfd8dd');
  pxFrame(ctx, x + 8, y + 6, w - 16, h - 10, '#d8dfdb', '#42515a', '#edf2ee');
  pxFrame(ctx, x + 22, y + 80, w - 44, h - 110, '#c7cfd2', '#55646c', '#ecf0f1');
  pxRect(ctx, x + 34, y + 95, w - 68, h - 142, '#dde3e4');
  drawMiniDistrict(ctx, x, y);
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
  packHiDpi(atlas, 'ball', 30, 30, (ctx, x, y, w) => {
    pxDisk(ctx, x + w * 0.5, y + w * 0.5, w * 0.47, '#cfd9e6', REF_PIXEL.ink, '#ffffff');
    pxRect(ctx, x + 8, y + 7, 8, 4, '#ffffff');
    pxRect(ctx, x + 18, y + 21, 5, 3, '#6f7f8b');
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
    { head: '#ffe0be', body: '#4a8fd6', legs: '#1d3557' },
    { head: '#ffd2a6', body: '#53b37b', legs: '#2f4858' },
    { head: '#ffcc9d', body: '#d97f4a', legs: '#425066' },
  ];
  const legsByFrame = [[2, 0], [1, 1], [0, 2]];
  for (let variant = 0; variant < personPalettes.length; variant += 1) {
    for (let frame = 0; frame < 3; frame += 1) {
      packHiDpi(atlas, `person_${variant}_${frame}`, 10, 10, (ctx, x, y) => {
        const palette = personPalettes[variant];
        const [lLeg, rLeg] = legsByFrame[frame];
        pxRect(ctx, x + 3, y + 1, 4, 1, '#00000066');
        pxRect(ctx, x + 4, y + 0, 2, 2, palette.head);
        pxRect(ctx, x + 3, y + 2, 4, 3, palette.body);
        pxRect(ctx, x + 3, y + 5, 1, 2 + lLeg, palette.legs);
        pxRect(ctx, x + 6, y + 5 + rLeg, 1, 2, palette.legs);
      });
    }
  }
  packHiDpi(atlas, 'playfield', WORLD.w, WORLD.h, (ctx, x, y, w, h) => drawPlayfieldSprite(ctx, x, y, w, h));
};

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

const grid = []; let nextBuildingId = 1; const buildings = []; const people = []; let levelUpChoices = [];
const MAX_PEOPLE = 80;
for (let r = 0; r < GRID.rows; r += 1) { const row = []; for (let c = 0; c < GRID.cols; c += 1) row.push({ tags: [ZONE_TEMPLATE[r][c]], occupiedBy: null }); grid.push(row); }

const walls = [{ x: 25, y: 25, w: 10, h: 740 }, { x: 465, y: 25, w: 10, h: 740 }, { x: 25, y: 25, w: 450, h: 10 }];
const rails = [{ x1: 25, y1: 620, x2: 160, y2: 704, r: 10, restitution: PHYSICS.railBounce, friction: PHYSICS.flipperFriction }, { x1: 475, y1: 620, x2: 340, y2: 704, r: 10, restitution: PHYSICS.railBounce, friction: PHYSICS.flipperFriction }];
const flippers = {
  left: { pivot: { x: 160, y: 704 }, length: 82, radius: 9, base: 0.52, active: -0.92, angle: 0.52, prev: 0.52, upImpulse: 980 },
  right: { pivot: { x: 340, y: 704 }, length: 82, radius: 9, base: Math.PI - 0.52, active: Math.PI + 0.92, angle: Math.PI - 0.52, prev: Math.PI - 0.52, upImpulse: 980 },
};
const drain = { x0: 228, x1: 272, y: 760 };
const maxBuildings = 8;

function getNextExp() { return 5 + state.level * 3; }
function updateQuota() { state.quota = Math.floor(3000 * Math.pow(1.75, state.round - 1)); }
function resetGridOccupancy() { for (const row of grid) for (const cell of row) cell.occupiedBy = null; buildings.length = 0; people.length = 0; }
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
function spawnPeople(building, amount) {
  const cx = building.x + building.w * 0.5;
  const cy = building.y + building.h * 0.5;
  const spawnCount = Math.max(1, Math.floor(amount));
  for (let i = 0; i < spawnCount; i += 1) {
    let person = people.find((p) => !p.active);
    if (!person) {
      if (people.length >= MAX_PEOPLE) break;
      person = {};
      people.push(person);
    }
    const angle = randRange(0, Math.PI * 2);
    const speed = randRange(50, 90);
    const life = randRange(3, 8);
    person.x = cx + randRange(-6, 6);
    person.y = cy + randRange(-6, 6);
    person.vx = Math.cos(angle) * speed;
    person.vy = Math.sin(angle) * speed;
    person.r = randRange(6, 9);
    person.value = 1;
    person.life = life;
    person.active = true;
    person.anim = Math.floor(randRange(0, 3));
    person.animTimer = randRange(0, 0.24);
    person.seed = Math.random() * 1000;
    person.spriteVariant = Math.floor(randRange(0, 3));
  }
}
function gainExp(v) { state.exp += v; while (state.exp >= getNextExp()) { state.exp -= getNextExp(); state.level += 1; state.levelUpsPending += 1; } }
function destroyBuilding(building, allowExplosion = true) { if (!building.active) return; building.active = false; for (let dy = 0; dy < building.footprint.h; dy += 1) for (let dx = 0; dx < building.footprint.w; dx += 1) if (grid[building.row + dy]?.[building.col + dx]?.occupiedBy === building.instanceId) grid[building.row + dy][building.col + dx].occupiedBy = null; state.roundScore += building.score; state.totalScore += building.score; spawnPeople(building, Math.max(1, building.exp)); if (allowExplosion && building.effectId === 'explode') { const cx = building.x + building.w * 0.5; const cy = building.y + building.h * 0.5; for (const other of buildings) { if (!other.active || other.instanceId === building.instanceId) continue; const ox = other.x + other.w * 0.5; const oy = other.y + other.h * 0.5; if (len2(cx - ox, cy - oy) <= 60) { other.hp -= 1; if (other.hp <= 0) destroyBuilding(other, false); } } } }

function resolveAABB(b, w, restitution = 0.1) {
  const nx = clamp(b.x, w.x, w.x + w.w);
  const ny = clamp(b.y, w.y, w.y + w.h);
  const dx = b.x - nx;
  const dy = b.y - ny;
  const d2 = dx * dx + dy * dy;
  let nxn;
  let nyn;
  let pen;

  if (d2 > 0) {
    if (d2 >= b.r * b.r) return false;
    const d = Math.sqrt(d2);
    nxn = dx / d;
    nyn = dy / d;
    pen = b.r - d;
  } else {
    const left = Math.abs(b.x - w.x);
    const right = Math.abs(w.x + w.w - b.x);
    const top = Math.abs(b.y - w.y);
    const bottom = Math.abs(w.y + w.h - b.y);
    const edge = Math.min(left, right, top, bottom);
    if (edge === left) { nxn = -1; nyn = 0; }
    else if (edge === right) { nxn = 1; nyn = 0; }
    else if (edge === top) { nxn = 0; nyn = -1; }
    else { nxn = 0; nyn = 1; }
    pen = b.r + edge;
  }

  b.x += nxn * pen;
  b.y += nyn * pen;
  const vn = b.vx * nxn + b.vy * nyn;
  if (vn < 0) {
    b.vx -= (1 + restitution) * vn * nxn;
    b.vy -= (1 + restitution) * vn * nyn;
  }
  return true;
}
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
function flipperSegment(f, angle = f.angle) { return { x1: f.pivot.x, y1: f.pivot.y, x2: f.pivot.x + Math.cos(angle) * f.length, y2: f.pivot.y + Math.sin(angle) * f.length, r: f.radius, restitution: PHYSICS.flipperBounce, friction: PHYSICS.flipperFriction }; }
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
  const tangentX = -ry;
  const tangentY = rx;
  const tangentLen = Math.hypot(tangentX, tangentY) || 1;
  const tx = tangentX / tangentLen;
  const ty = tangentY / tangentLen;
  ball.vx += hit.nx * boost * 0.75 + tx * boost * 0.28;
  ball.vy += hit.ny * boost * 0.75 + ty * boost * 0.28;
  ball.vy -= boost * 0.22;
}
function clampBallSpeed() { const max = PHYSICS.maxBallSpeed; const speed = Math.hypot(ball.vx, ball.vy); if (speed > max) { const k = max / speed; ball.vx *= k; ball.vy *= k; } }
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

function updateFlipper(f, pressed, dt) {
  const target = pressed ? f.active : f.base;
  const maxStep = (pressed ? 15 : 9) * dt;
  f.prev = f.angle;
  f.angle += clamp(target - f.angle, -maxStep, maxStep);
}
function updateFlippers(dt) {
  updateFlipper(flippers.left, input.left, dt);
  updateFlipper(flippers.right, input.right, dt);
}
function resolveFlipperHit(f, pressed, sdt) {
  const delta = f.angle - f.prev;
  const sweepSteps = clamp(Math.ceil(Math.abs(delta) / 0.08), 1, 8);
  for (let i = 0; i <= sweepSteps; i += 1) {
    const angle = f.prev + delta * (i / sweepSteps);
    const hit = segmentCapsuleHit(ball, flipperSegment(f, angle));
    if (!hit) continue;
    if (pressed && Math.abs(delta) > 0.0005) {
      applyFlipperImpulse(f, hit, sdt);
      clampBallSpeed();
      ensureMinBallSpeed(PHYSICS.minFlipperBallSpeed);
    }
    return true;
  }
  return false;
}

function update(dt) {
  state.fpsS += dt; state.fpsN += 1; if (state.fpsS > 0.3) { state.fps = Math.round(state.fpsN / state.fpsS); state.fpsS = 0; state.fpsN = 0; }
  if (state.mode !== 'playing' || !ball.active) updateFlippers(dt);

  if (state.mode === 'playing') {
    for (const card of ownedCards) { card.cooldownTimer -= dt; if (card.cooldownTimer <= 0) { trySpawnFromCard(card); card.cooldownTimer += card.cooldownSec; } }
  }

  for (const b of buildings) if (b.active && b.hitCooldown > 0) b.hitCooldown -= dt;
  for (const person of people) if (person.active) {
    person.life -= dt;
    if (person.life <= 0) { person.active = false; continue; }
    person.animTimer += dt;
    if (person.animTimer > 0.1) { person.animTimer = 0; person.anim = (person.anim + 1) % 3; }
    const wobble = person.seed + person.life * 3;
    person.vx += Math.cos(wobble * 1.7) * 25 * dt + randRange(-10, 10) * dt;
    person.vy += Math.sin(wobble * 1.3) * 25 * dt + randRange(-10, 10) * dt;
    const speed = Math.hypot(person.vx, person.vy) || 1;
    const targetSpeed = 76;
    person.vx = (person.vx / speed) * targetSpeed;
    person.vy = (person.vy / speed) * targetSpeed;
    person.x += person.vx * dt;
    person.y += person.vy * dt;
    const minX = 28; const maxX = WORLD.w - 28; const minY = 28; const maxY = WORLD.h - 28;
    if (person.x < minX || person.x > maxX) { person.x = clamp(person.x, minX, maxX); person.vx *= -1; }
    if (person.y < minY || person.y > maxY) { person.y = clamp(person.y, minY, maxY); person.vy *= -1; }
  }

  if (state.mode === 'ready') { ball.x = START_POS.x; ball.y = START_POS.y; if (input.launchTap) launchBall(); }
  else if (state.mode === 'playing' && ball.active) {
    const speed = len2(ball.vx, ball.vy); const substeps = clamp(Math.ceil((speed * dt) / (ball.r * 0.4)), 1, 8); const sdt = dt / substeps;
    for (let s = 0; s < substeps; s += 1) {
      updateFlippers(sdt);
      ball.vy += PHYSICS.gravity * sdt; ball.vx *= PHYSICS.airDrag * PHYSICS.rollingFriction; ball.vy *= PHYSICS.airDrag; ball.x += ball.vx * sdt; ball.y += ball.vy * sdt; clampBallSpeed();
      for (const w of walls) resolveAABB(ball, w, PHYSICS.wallBounce);
      for (const seg of rails) segmentCapsuleHit(ball, seg);
      for (const key of ['left', 'right']) {
        const f = flippers[key];
        const pressed = key === 'left' ? input.left : input.right;
        resolveFlipperHit(f, pressed, sdt);
      }
      for (const b of buildings) if (b.active && b.hitCooldown <= 0 && resolveAABB(ball, { x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }, PHYSICS.buildingBounce)) { b.hp -= 1; b.hitCooldown = 0.08; if (b.hp <= 0) { destroyBuilding(b); ball.vx *= 1.03; ball.vy *= 1.03; clampBallSpeed(); } }
      for (const person of people) if (person.active && len2(ball.x - person.x, ball.y - person.y) <= ball.r + person.r) { person.active = false; gainExp(person.value); }
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

const atlas = new RuntimeAtlas(gl, 2048); registerAtlasSprites(atlas); atlas.upload(); const renderer = new SpriteRenderer(gl, atlas);
function drawSegmentSprite(entry, x1, y1, x2, y2, thickness, sx, sy) { const dx = x2 - x1; const dy = y2 - y1; const len = Math.hypot(dx, dy); const ang = Math.atan2(dy, dx); renderer.pushSprite(entry, x1 * sx, (y1 - thickness) * sy, len * sx, thickness * 2 * sy, ang, 0, 0.5); }
function zoneSprite(cell) { return atlas.entries.get(`zone_${cell.tags[0]}`) || atlas.entries.get('zone_small'); }
function render() {
  const sx = glCanvas.width / WORLD.w; const sy = glCanvas.height / WORLD.h; renderer.begin();
  const fieldSpr = atlas.entries.get('playfield'); const wallSpr = atlas.entries.get('wall'); const flipSpr = atlas.entries.get('flipper'); const ballSpr = atlas.entries.get('ball'); const baseSpr = atlas.entries.get('building_base'); const hitBaseSpr = atlas.entries.get('building_hit_base');
  renderer.pushSprite(fieldSpr, 0, 0, glCanvas.width, glCanvas.height);
  for (const w of walls) renderer.pushSprite(wallSpr, w.x * sx, w.y * sy, w.w * sx, w.h * sy);
  for (const seg of rails) drawSegmentSprite(wallSpr, seg.x1, seg.y1, seg.x2, seg.y2, seg.r, sx, sy);
  for (const b of buildings) if (b.active) {
    renderer.pushSprite(b.hitCooldown > 0 ? hitBaseSpr : baseSpr, (b.x - 4) * sx, (b.y - 4) * sy, (b.w + 8) * sx, (b.h + 8) * sy);
    renderer.pushSprite(atlas.entries.get(b.spriteKey), b.x * sx, b.y * sy, b.w * sx, b.h * sy);
  }
  for (const person of people) if (person.active) { const spr = atlas.entries.get(`person_${person.spriteVariant}_${person.anim}`); if (spr) renderer.pushSprite(spr, (person.x - 5) * sx, (person.y - 5) * sy, 10 * sx, 10 * sy); }
  for (const key of ['left', 'right']) { const f = flippers[key]; const seg = flipperSegment(f); const ang = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1); renderer.pushSprite(flipSpr, seg.x1 * sx, (seg.y1 - f.radius) * sy, f.length * sx, f.radius * 2 * sy, ang, 0, 0.5); }
  if (ball.active || state.mode === 'ready') renderer.pushSprite(ballSpr, (ball.x - ball.r) * sx, (ball.y - ball.r) * sy, ball.r * 2 * sx, ball.r * 2 * sy);
  renderer.flush(glCanvas.width, glCanvas.height);

  uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);

  uiCtx.save(); uiCtx.scale(dpr, dpr); const vw = uiCanvas.width / dpr; const vh = uiCanvas.height / dpr;
  const cardLabel = (card) => ({ house: 'HOME', convenience: 'SHOP', apartment: 'APT', gas_station: 'GAS', tower: 'TOWER' }[card?.id] || 'CARD');
  const hudW = Math.min(500, vw);
  const hudX = (vw - hudW) * 0.5;
  const hudY = 0;
  const hudH = 82;
  pxRect(uiCtx, hudX, hudY, hudW, hudH, '#f5d8a7');
  pxRect(uiCtx, hudX + 4, hudY + 4, hudW - 8, hudH - 8, '#102a44');
  pxCutPanel(uiCtx, hudX + 8, hudY + 8, hudW - 16, hudH - 15, '#176aa3', '#0a223a', '#68e4ff');
  let hx = hudX + 16;
  pxFrame(uiCtx, hx, hudY + 18, 34, 42, '#154f82', '#071c31', '#68e4ff', false);
  refDecorBuilding(uiCtx, hx + 7, hudY + 26, 20, 26, 'tower');
  hx += 40;
  pxFrame(uiCtx, hx, hudY + 18, 126, 42, '#124f82', '#071c31', '#68e4ff', false);
  refStar(uiCtx, hx + 22, hudY + 39, 16, '#ffd33f', '#8a4d10');
  uiCtx.fillStyle = '#fff3bd';
  uiCtx.font = '900 15px ui-monospace, SFMono-Regular, Consolas, monospace';
  uiCtx.fillText(String(state.totalScore).padStart(6, '0'), hx + 47, hudY + 45);
  hx += 136;
  pxFrame(uiCtx, hx, hudY + 15, 142, 46, '#124f82', '#071c31', '#68e4ff', false);
  pxDisk(uiCtx, hx + 19, hudY + 38, 14, '#ffd33f', '#8a4d10', '#fff7bf');
  uiCtx.fillStyle = '#102a44';
  uiCtx.font = '900 13px ui-monospace, SFMono-Regular, Consolas, monospace';
  uiCtx.fillText(`${state.round}`, hx + 15, hudY + 43);
  pxRect(uiCtx, hx + 39, hudY + 27, 76, 13, '#08213b');
  pxRect(uiCtx, hx + 43, hudY + 30, Math.min(68, 68 * state.roundScore / Math.max(1, state.quota)), 7, '#25c8ff');
  pxRect(uiCtx, hx + 118, hudY + 24, 16, 20, '#ffffff');
  pxRect(uiCtx, hx + 126, hudY + 28, 4, 24, '#071c31');
  hx += 152;
  pxFrame(uiCtx, hx, hudY + 18, 64, 42, '#124f82', '#071c31', '#68e4ff', false);
  pxDisk(uiCtx, hx + 19, hudY + 39, 13, '#ffd33f', '#8a4d10', '#fff7bf');
  uiCtx.fillStyle = '#fff3bd';
  uiCtx.font = '900 14px ui-monospace, SFMono-Regular, Consolas, monospace';
  uiCtx.fillText(`${state.balls}`, hx + 39, hudY + 45);
  hx += 74;
  pxFrame(uiCtx, hx, hudY + 18, 58, 42, '#124f82', '#071c31', '#68e4ff', false);
  pxRect(uiCtx, hx + 12, hudY + 28, 18, 18, '#68e4ff');
  pxRect(uiCtx, hx + 16, hudY + 24, 10, 5, '#c9fbff');
  uiCtx.fillStyle = '#fff3bd';
  uiCtx.fillText(`${state.level}`, hx + 36, hudY + 45);
  hx += 68;
  pxFrame(uiCtx, hx, hudY + 18, 31, 42, '#124f82', '#071c31', '#68e4ff', false);
  pxRect(uiCtx, hx + 9, hudY + 27, 5, 22, '#fff3bd');
  pxRect(uiCtx, hx + 18, hudY + 27, 5, 22, '#fff3bd');
  uiCtx.fillStyle = '#bce9ff';
  uiCtx.font = '900 8px ui-monospace, SFMono-Regular, Consolas, monospace';
  const cardStatus = ownedCards.slice(0, 3).map((card) => `${cardLabel(card)} ${Math.max(0, card.cooldownTimer).toFixed(1)}`).join('  ');
  uiCtx.fillText(cardStatus, hudX + 24, hudY + 72);
  if (state.mode === 'ready') {
    pxRect(uiCtx, vw * 0.5 - 24, vh - 42, 48, 4, '#ffd13a');
  }
  if (state.mode === 'game_over') {
    pxCutPanel(uiCtx, vw * 0.5 - 132, vh * 0.48 - 36, 264, 70, '#23364f', '#0a1828', '#ff5b47');
    uiCtx.fillStyle = '#ffdf6b';
    uiCtx.font = '900 27px ui-monospace, SFMono-Regular, Consolas, monospace';
    uiCtx.textAlign = 'center';
    uiCtx.fillText('GAME OVER', vw * 0.5, vh * 0.48 + 8);
    uiCtx.textAlign = 'start';
  }
  if (state.mode === 'level_up') {
    const panelX = 30;
    const panelY = 150;
    const panelW = vw - 60;
    const panelH = 282;
    pxCutPanel(uiCtx, panelX, panelY, panelW, panelH, '#176aa3', '#0a223a', '#68e4ff');
    uiCtx.fillStyle = '#fff3bd';
    uiCtx.font = '900 28px ui-monospace, SFMono-Regular, Consolas, monospace';
    uiCtx.fillText('LEVEL UP', panelX + 24, panelY + 42);
    pxRect(uiCtx, panelX + 24, panelY + 52, 118, 5, '#ffd13a');
    uiCtx.font = '900 16px ui-monospace, SFMono-Regular, Consolas, monospace';
    for (let i = 0; i < levelUpChoices.length; i += 1) {
      const ch = levelUpChoices[i];
      const card = cardPool.get(ch.cardId) || ownedCards.find((c) => c.id === ch.cardId);
      const txt = ch.type === 'new' ? `${i + 1}. NEW ${cardLabel(card)}` : `${i + 1}. UP ${cardLabel(card)}`;
      const cy = panelY + 72 + i * 66;
      pxFrame(uiCtx, panelX + 34, cy, panelW - 68, 48, i === 0 ? '#ffd13a' : '#124f82', '#09243f', i === 0 ? '#fff7bf' : '#68e4ff', false);
      uiCtx.fillStyle = i === 0 ? '#123452' : '#fff3bd';
      uiCtx.fillText(txt, panelX + 52, cy + 30);
    }
  }
  uiCtx.restore();
}

let prev = performance.now();
function loop(t) { const dt = Math.min((t - prev) / 1000, 1 / 30); prev = t; update(dt); render(); requestAnimationFrame(loop); }
resize(); restartRun(); requestAnimationFrame(loop);
