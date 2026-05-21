const DPR_MAX = 2;
const WORLD = { w: 500, h: 800 };

const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const wrap = document.getElementById('wrap');
const uiCtx = uiCanvas.getContext('2d', { alpha: true });
const gl = glCanvas.getContext('webgl', { antialias: true, alpha: false });
if (!gl) throw new Error('WebGL unavailable');

function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function len2(x, y) { return Math.hypot(x, y); }

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
    if (this.x + pw > this.size) {
      this.x = 0;
      this.y += this.row;
      this.row = 0;
    }
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
    if (!glRef.getShaderParameter(shader, glRef.COMPILE_STATUS)) {
      throw new Error(glRef.getShaderInfoLog(shader));
    }
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
    this.program = createProgram(glRef, `
      attribute vec2 a_pos;
      attribute vec2 a_uv;
      uniform vec2 u_res;
      varying vec2 v_uv;
      void main() {
        vec2 p = (a_pos / u_res) * 2.0 - 1.0;
        gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
        v_uv = a_uv;
      }
    `, `
      precision mediump float;
      uniform sampler2D u_tex;
      varying vec2 v_uv;
      void main() {
        gl_FragColor = texture2D(u_tex, v_uv);
      }
    `);
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
    const quad = [
      [0, 0, entry.u0, entry.v0], [w, 0, entry.u1, entry.v0], [w, h, entry.u1, entry.v1], [0, h, entry.u0, entry.v1],
    ];
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

function registerAtlasSprites(atlas) {
  atlas.pack('ball', 30, 30, (ctx, x, y, w) => {
    const r = w * 0.5;
    const g = ctx.createRadialGradient(x + r * 0.7, y + r * 0.7, 2, x + r, y + r, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#7da8ff');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + r, y + r, r, 0, Math.PI * 2); ctx.fill();
  });
  atlas.pack('flipper', 108, 22, (ctx, x, y) => {
    ctx.fillStyle = '#54d9ff'; ctx.beginPath(); ctx.roundRect(x, y, 108, 22, 11); ctx.fill();
  });
  atlas.pack('wall', 20, 20, (ctx, x, y) => {
    ctx.fillStyle = '#5476cb'; ctx.fillRect(x, y, 20, 20);
  });
}

const state = { mode: 'ready', balls: 3, ballLostTimer: 0, fps: 0, fpsS: 0, fpsN: 0 };
const ball = { x: 450, y: 718, vx: 0, vy: 0, r: 13, active: false };

const walls = [
  { x: 25, y: 25, w: 10, h: 740 },
  { x: 465, y: 25, w: 10, h: 740 },
  { x: 25, y: 25, w: 450, h: 10 },
];

const rails = [
  { x1: 25, y1: 620, x2: 170, y2: 700, r: 10, restitution: 0.45, friction: 0.985 },
  { x1: 475, y1: 620, x2: 330, y2: 700, r: 10, restitution: 0.45, friction: 0.985 },
];

const flippers = {
  left: { pivot: { x: 180, y: 715 }, length: 105, radius: 9, base: 0.22, active: -0.45, angle: 0.22, prev: 0.22, upImpulse: 250 },
  right: { pivot: { x: 320, y: 715 }, length: 105, radius: 9, base: Math.PI - 0.22, active: Math.PI + 0.45, angle: Math.PI - 0.22, prev: Math.PI - 0.22, upImpulse: 250 },
};

const drain = { x0: 220, x1: 280, y: 760 };
const input = { left: false, right: false, launchTap: false, pointerSide: 0 };

function resetToReady() { ball.x = 450; ball.y = 718; ball.vx = 0; ball.vy = 0; ball.active = false; state.mode = 'ready'; }
function launchBall() { ball.active = true; ball.vx = -70; ball.vy = -760; state.mode = 'playing'; }
function restartGame() { state.balls = 3; state.mode = 'ready'; state.ballLostTimer = 0; resetToReady(); }

addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true;
  if (e.code === 'Space' || e.code === 'KeyW') input.launchTap = true;
  if (e.code === 'KeyR') restartGame();
});
addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
});

function pointerDown(clientX) {
  const rect = wrap.getBoundingClientRect();
  const x = clientX - rect.left;
  if (state.mode === 'game_over') { restartGame(); return; }
  if (state.mode === 'ready') { input.launchTap = true; return; }
  if (x < rect.width * 0.5) { input.left = true; input.pointerSide = 1; } else { input.right = true; input.pointerSide = 2; }
}
function pointerUp() {
  if (input.pointerSide === 1) input.left = false;
  if (input.pointerSide === 2) input.right = false;
  input.pointerSide = 0;
}
addEventListener('pointerdown', (e) => pointerDown(e.clientX));
addEventListener('pointerup', pointerUp);
addEventListener('pointercancel', pointerUp);

function resolveAABB(b, w) {
  const nx = clamp(b.x, w.x, w.x + w.w);
  const ny = clamp(b.y, w.y, w.y + w.h);
  const dx = b.x - nx;
  const dy = b.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= b.r * b.r) return;
  const d = Math.max(0.0001, Math.sqrt(d2));
  const nxn = dx / d;
  const nyn = dy / d;
  const pen = b.r - d;
  b.x += nxn * pen;
  b.y += nyn * pen;
  const vn = b.vx * nxn + b.vy * nyn;
  if (vn < 0) {
    b.vx -= 1.1 * vn * nxn;
    b.vy -= 1.1 * vn * nyn;
    b.vx *= 0.99;
    b.vy *= 0.99;
  }
}

function segmentCapsuleHit(b, seg, impulse = 0) {
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
  if (d2 >= rr * rr) return;
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
  if (impulse > 0) {
    b.vx += nx * impulse;
    b.vy += ny * impulse;
  }
}

function flipperSegment(f) {
  return {
    x1: f.pivot.x,
    y1: f.pivot.y,
    x2: f.pivot.x + Math.cos(f.angle) * f.length,
    y2: f.pivot.y + Math.sin(f.angle) * f.length,
    r: f.radius,
    restitution: 0.5,
    friction: 0.985,
  };
}

function update(dt) {
  state.fpsS += dt; state.fpsN += 1; if (state.fpsS > 0.3) { state.fps = Math.round(state.fpsN / state.fpsS); state.fpsS = 0; state.fpsN = 0; }

  flippers.left.prev = flippers.left.angle;
  flippers.right.prev = flippers.right.angle;
  flippers.left.angle += ((input.left ? flippers.left.active : flippers.left.base) - flippers.left.angle) * 0.4;
  flippers.right.angle += ((input.right ? flippers.right.active : flippers.right.base) - flippers.right.angle) * 0.4;

  if (state.mode === 'ready') {
    ball.x = 450; ball.y = 718;
    if (input.launchTap) launchBall();
  } else if (state.mode === 'playing' && ball.active) {
    const speed = len2(ball.vx, ball.vy);
    const substeps = clamp(Math.ceil((speed * dt) / (ball.r * 0.45)), 1, 6);
    const sdt = dt / substeps;
    for (let s = 0; s < substeps; s += 1) {
      ball.vy += 840 * sdt;
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      for (const w of walls) resolveAABB(ball, w);
      for (const seg of rails) segmentCapsuleHit(ball, seg, 0);

      for (const key of ['left', 'right']) {
        const f = flippers[key];
        const seg = flipperSegment(f);
        const rise = Math.max(0, Math.abs(f.prev - f.angle) - 0.04);
        segmentCapsuleHit(ball, seg, rise > 0 ? f.upImpulse * rise : 0);
      }

      if (ball.y > WORLD.h + 30 || (ball.y > drain.y && ball.x > drain.x0 && ball.x < drain.x1)) {
        ball.active = false;
        state.mode = 'ball_lost';
        state.ballLostTimer = 0.8;
        break;
      }
    }
  } else if (state.mode === 'ball_lost') {
    state.ballLostTimer -= dt;
    if (state.ballLostTimer <= 0) {
      state.balls -= 1;
      if (state.balls <= 0) state.mode = 'game_over'; else resetToReady();
    }
  }

  input.launchTap = false;
}

let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
  const rect = wrap.getBoundingClientRect();
  const w = Math.floor(rect.width * dpr);
  const h = Math.floor(rect.height * dpr);
  glCanvas.width = w; glCanvas.height = h; uiCanvas.width = w; uiCanvas.height = h;
  gl.viewport(0, 0, w, h);
}
addEventListener('resize', resize);

const atlas = new RuntimeAtlas(gl, 1024);
registerAtlasSprites(atlas);
atlas.upload();
const renderer = new SpriteRenderer(gl, atlas);

function drawSegmentSprite(entry, x1, y1, x2, y2, thickness, sx, sy) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  renderer.pushSprite(entry, x1 * sx, (y1 - thickness) * sy, len * sx, thickness * 2 * sy, ang, 0, 0.5);
}

function render() {
  const sx = glCanvas.width / WORLD.w;
  const sy = glCanvas.height / WORLD.h;
  renderer.begin();

  const wallSpr = atlas.entries.get('wall');
  const flipSpr = atlas.entries.get('flipper');
  const ballSpr = atlas.entries.get('ball');

  for (const w of walls) renderer.pushSprite(wallSpr, w.x * sx, w.y * sy, w.w * sx, w.h * sy);
  for (const seg of rails) drawSegmentSprite(wallSpr, seg.x1, seg.y1, seg.x2, seg.y2, seg.r, sx, sy);

  for (const key of ['left', 'right']) {
    const f = flippers[key];
    const seg = flipperSegment(f);
    const ang = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
    renderer.pushSprite(flipSpr, seg.x1 * sx, (seg.y1 - f.radius) * sy, f.length * sx, f.radius * 2 * sy, ang, 0, 0.5);
  }
  if (ball.active || state.mode === 'ready') renderer.pushSprite(ballSpr, (ball.x - ball.r) * sx, (ball.y - ball.r) * sy, ball.r * 2 * sx, ball.r * 2 * sy);

  renderer.flush(glCanvas.width, glCanvas.height);

  uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
  uiCtx.save();
  uiCtx.scale(dpr, dpr);
  const vw = uiCanvas.width / dpr;
  const vh = uiCanvas.height / dpr;
  uiCtx.fillStyle = '#dfecff'; uiCtx.font = '700 20px system-ui';
  uiCtx.fillText(`BALLS ${state.balls}`, vw - 130, 32);
  uiCtx.font = '500 13px system-ui'; uiCtx.fillStyle = '#a9bbff'; uiCtx.fillText('A/← 左  D/→ 右  SPACE 打ち出し  R リスタート / タップ操作可', 18, vh - 16);
  if (state.mode === 'ready') { uiCtx.fillStyle = '#fff'; uiCtx.font = '700 24px system-ui'; uiCtx.fillText('READY', 210, 410); }
  if (state.mode === 'game_over') { uiCtx.fillStyle = '#ff9cb7'; uiCtx.font = '700 34px system-ui'; uiCtx.fillText('GAME OVER', 145, 380); }
  uiCtx.restore();
}

let prev = performance.now();
function loop(t) {
  const dt = Math.min((t - prev) / 1000, 1 / 30);
  prev = t;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

resize();
restartGame();
requestAnimationFrame(loop);
