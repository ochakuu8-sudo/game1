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

  pushSprite(entry, x, y, w, h, rot = 0, pivotX = 0.5, pivotY = 0.5, alpha = 1) {
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
      return [cx + dx * c - dy * s, cy + dx * s + dy * c, u, v, alpha];
    });
    const tri = [out[0], out[1], out[2], out[0], out[2], out[3]];
    for (const v of tri) this.verts.push(...v);
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
  atlas.pack('bumper', 56, 56, (ctx, x, y) => {
    ctx.fillStyle = '#ff4c8f'; ctx.beginPath(); ctx.arc(x + 28, y + 28, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd3e9'; ctx.beginPath(); ctx.arc(x + 28, y + 28, 12, 0, Math.PI * 2); ctx.fill();
  });
  atlas.pack('flipper', 96, 28, (ctx, x, y) => {
    ctx.fillStyle = '#54d9ff'; ctx.beginPath(); ctx.roundRect(x, y + 4, 94, 20, 10); ctx.fill();
  });
  atlas.pack('wall', 36, 36, (ctx, x, y) => {
    ctx.fillStyle = '#5476cb'; ctx.fillRect(x, y + 10, 36, 16);
  });
  atlas.pack('post', 24, 24, (ctx, x, y) => { ctx.fillStyle = '#ffe082'; ctx.beginPath(); ctx.arc(x + 12, y + 12, 10, 0, Math.PI * 2); ctx.fill(); });
  atlas.pack('spark', 18, 18, (ctx, x, y) => { ctx.fillStyle = '#fff3a9'; ctx.beginPath(); ctx.moveTo(x + 9, y); ctx.lineTo(x + 12, y + 6); ctx.lineTo(x + 18, y + 9); ctx.lineTo(x + 12, y + 12); ctx.lineTo(x + 9, y + 18); ctx.lineTo(x + 6, y + 12); ctx.lineTo(x, y + 9); ctx.lineTo(x + 6, y + 6); ctx.fill(); });
}

const state = {
  mode: 'ready',
  score: 0,
  best: Number(localStorage.getItem('pin_best') || '0'),
  balls: 3,
  ballLostTimer: 0,
  launchCharge: 0,
  fps: 0,
  fpsS: 0,
  fpsN: 0,
};

const ball = { x: 450, y: 718, vx: 0, vy: 0, r: 13, active: false };
const walls = [
  { x: 16, y: 16, w: 20, h: 740 }, { x: 464, y: 16, w: 20, h: 740 }, { x: 16, y: 16, w: 468, h: 20 },
  { x: 190, y: 740, w: 120, h: 20 }, { x: 36, y: 620, w: 90, h: 20 }, { x: 374, y: 620, w: 90, h: 20 },
];
const drain = { x0: 200, x1: 300, y: 760 };
const bumpers = [{ x: 170, y: 220, r: 28 }, { x: 250, y: 170, r: 28 }, { x: 330, y: 230, r: 28 }, { x: 250, y: 320, r: 24 }];
const posts = [{ x: 110, y: 520, r: 12 }, { x: 390, y: 520, r: 12 }, { x: 145, y: 640, r: 12 }, { x: 355, y: 640, r: 12 }];

const flippers = {
  left: { x: 150, y: 698, w: 96, h: 28, base: -0.48, active: 0.22, angle: -0.48, prev: -0.48, pivot: 0.08 },
  right: { x: 254, y: 698, w: 96, h: 28, base: 0.48, active: -0.22, angle: 0.48, prev: 0.48, pivot: 0.92 },
};

const input = { left: false, right: false, launchHeld: false, launchJustReleased: false, launchTap: false, pointerSide: 0 };
const particles = Array.from({ length: 120 }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 8 }));

function spawnParticles(x, y, n, speed) {
  for (let i = 0; i < particles.length && n > 0; i += 1) {
    const p = particles[i];
    if (p.active) continue;
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.5 + Math.random());
    p.active = true; p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s; p.life = 0.22 + Math.random() * 0.3; p.maxLife = p.life; p.size = 9 + Math.random() * 5;
    n -= 1;
  }
}

function resetToReady() { ball.x = 450; ball.y = 718; ball.vx = 0; ball.vy = 0; ball.active = false; state.mode = 'ready'; state.launchCharge = 0; }
function launchBall(force) { ball.active = true; ball.vx = -70; ball.vy = -(650 + force * 300); state.mode = 'playing'; spawnParticles(ball.x, ball.y, 10, 120); }
function restartGame() { state.score = 0; state.balls = 3; state.mode = 'ready'; state.ballLostTimer = 0; resetToReady(); }

addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true;
  if (e.code === 'Space' || e.code === 'KeyW') { input.launchHeld = true; input.launchTap = true; }
  if (e.code === 'KeyR') restartGame();
});
addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
  if (e.code === 'Space' || e.code === 'KeyW') { input.launchHeld = false; input.launchJustReleased = true; }
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
  if (d2 >= b.r * b.r) return false;
  let d = Math.sqrt(d2);
  let nxn = 0; let nyn = -1;
  if (d > 0.0001) { nxn = dx / d; nyn = dy / d; } else if (Math.abs(dx) > Math.abs(dy)) { nxn = Math.sign(dx || 1); nyn = 0; d = 0; }
  const pen = b.r - d;
  b.x += nxn * pen; b.y += nyn * pen;
  const vn = b.vx * nxn + b.vy * nyn;
  if (vn < 0) { b.vx -= 2 * vn * nxn; b.vy -= 2 * vn * nyn; b.vx *= 0.96; b.vy *= 0.96; }
  return true;
}

function circleHit(cx, cy, r, power, scoreGain) {
  const dx = ball.x - cx; const dy = ball.y - cy; const rr = ball.r + r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return false;
  const d = Math.max(0.0001, Math.sqrt(d2));
  const nx = dx / d; const ny = dy / d;
  ball.x = cx + nx * (rr + 0.3); ball.y = cy + ny * (rr + 0.3);
  const vn = ball.vx * nx + ball.vy * ny;
  ball.vx -= 2 * vn * nx; ball.vy -= 2 * vn * ny;
  ball.vx += nx * power; ball.vy += ny * power;
  state.score += scoreGain;
  if (state.score > state.best) { state.best = state.score; localStorage.setItem('pin_best', String(state.best)); }
  spawnParticles(cx, cy, 8, 170);
  return true;
}

function update(dt) {
  state.fpsS += dt; state.fpsN += 1; if (state.fpsS > 0.3) { state.fps = Math.round(state.fpsN / state.fpsS); state.fpsS = 0; state.fpsN = 0; }

  flippers.left.prev = flippers.left.angle;
  flippers.right.prev = flippers.right.angle;
  flippers.left.angle += ((input.left ? flippers.left.active : flippers.left.base) - flippers.left.angle) * 0.35;
  flippers.right.angle += ((input.right ? flippers.right.active : flippers.right.base) - flippers.right.angle) * 0.35;

  if (state.mode === 'ready') {
    ball.x = 450; ball.y = 718;
    if (input.launchHeld) state.launchCharge = clamp(state.launchCharge + dt * 1.4, 0, 1);
    if (input.launchTap || input.launchJustReleased) { launchBall(Math.max(0.2, state.launchCharge)); state.launchCharge = 0; }
  } else if (state.mode === 'playing' && ball.active) {
    const speed = len2(ball.vx, ball.vy);
    const substeps = clamp(Math.ceil((speed * dt) / (ball.r * 0.5)), 1, 6);
    const sdt = dt / substeps;
    for (let s = 0; s < substeps; s += 1) {
      ball.vy += 800 * sdt;
      const vmax = 1050;
      const vNow = len2(ball.vx, ball.vy);
      if (vNow > vmax) { const f = vmax / vNow; ball.vx *= f; ball.vy *= f; }
      ball.x += ball.vx * sdt; ball.y += ball.vy * sdt;
      for (const w of walls) resolveAABB(ball, w);
      for (const b of bumpers) circleHit(b.x, b.y, b.r, 640, 100);
      for (const p of posts) circleHit(p.x, p.y, p.r, 280, 75);

      for (const key of ['left', 'right']) {
        const f = flippers[key];
        const px = f.x + f.w * f.pivot;
        const py = f.y + f.h * 0.5;
        circleHit(px + (key === 'left' ? 35 : -35), py, 24, Math.abs(f.angle - f.prev) * 5200 + 120, 0);
      }

      if (ball.y > WORLD.h + 30 || (ball.y > drain.y && ball.x > drain.x0 && ball.x < drain.x1)) {
        ball.active = false;
        state.mode = 'ball_lost';
        state.ballLostTimer = 0.8;
        spawnParticles(ball.x, WORLD.h - 20, 16, 190);
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

  for (const p of particles) {
    if (!p.active) continue;
    p.life -= dt; if (p.life <= 0) { p.active = false; continue; }
    p.vy += 330 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
  }
  input.launchTap = false;
  input.launchJustReleased = false;
}

let dpr = 1;
function worldToScreen(x, y) { return { x: x * (glCanvas.width / WORLD.w), y: y * (glCanvas.height / WORLD.h) }; }
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

function render() {
  const sx = glCanvas.width / WORLD.w;
  const sy = glCanvas.height / WORLD.h;
  renderer.begin();

  const wallSpr = atlas.entries.get('wall');
  const bumpSpr = atlas.entries.get('bumper');
  const flipSpr = atlas.entries.get('flipper');
  const ballSpr = atlas.entries.get('ball');
  const postSpr = atlas.entries.get('post');
  const sparkSpr = atlas.entries.get('spark');

  for (const w of walls) renderer.pushSprite(wallSpr, w.x * sx, w.y * sy, w.w * sx, w.h * sy);
  for (const b of bumpers) renderer.pushSprite(bumpSpr, (b.x - b.r) * sx, (b.y - b.r) * sy, b.r * 2 * sx, b.r * 2 * sy);
  for (const p of posts) renderer.pushSprite(postSpr, (p.x - p.r) * sx, (p.y - p.r) * sy, p.r * 2 * sx, p.r * 2 * sy);

  renderer.pushSprite(flipSpr, flippers.left.x * sx, flippers.left.y * sy, flippers.left.w * sx, flippers.left.h * sy, flippers.left.angle, flippers.left.pivot, 0.5);
  renderer.pushSprite(flipSpr, flippers.right.x * sx, flippers.right.y * sy, flippers.right.w * sx, flippers.right.h * sy, flippers.right.angle, flippers.right.pivot, 0.5);
  if (ball.active || state.mode === 'ready') renderer.pushSprite(ballSpr, (ball.x - ball.r) * sx, (ball.y - ball.r) * sy, ball.r * 2 * sx, ball.r * 2 * sy);

  for (const p of particles) {
    if (!p.active) continue;
    renderer.pushSprite(sparkSpr, (p.x - p.size * 0.5) * sx, (p.y - p.size * 0.5) * sy, p.size * sx, p.size * sy, p.vx * 0.001);
  }

  renderer.flush(glCanvas.width, glCanvas.height);

  uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
  uiCtx.save();
  uiCtx.scale(dpr, dpr);
  const vw = uiCanvas.width / dpr;
  const vh = uiCanvas.height / dpr;
  uiCtx.strokeStyle = '#4e68b2'; uiCtx.lineWidth = 3; uiCtx.strokeRect(8, 8, vw - 16, vh - 16);
  uiCtx.fillStyle = '#dfecff'; uiCtx.font = '700 20px system-ui'; uiCtx.fillText(`SCORE ${state.score}`, 18, 32);
  uiCtx.fillText(`BEST ${state.best}`, 18, 56);
  uiCtx.fillText(`BALLS ${state.balls}`, vw - 130, 32);
  uiCtx.font = '500 13px system-ui'; uiCtx.fillStyle = '#a9bbff'; uiCtx.fillText(`A/← 左  D/→ 右  SPACE 打ち出し  R リスタート`, 18, vh - 16);
  if (state.mode === 'ready') { uiCtx.fillStyle = '#fff'; uiCtx.font = '700 24px system-ui'; uiCtx.fillText('READY / SPACE TO LAUNCH', 90, 410); }
  if (state.mode === 'ball_lost') { uiCtx.fillStyle = '#ffc8d8'; uiCtx.font = '700 28px system-ui'; uiCtx.fillText('BALL LOST', 170, 390); }
  if (state.mode === 'game_over') { uiCtx.fillStyle = '#ff9cb7'; uiCtx.font = '700 34px system-ui'; uiCtx.fillText('GAME OVER', 145, 380); uiCtx.font = '700 20px system-ui'; uiCtx.fillText('Press R or Tap to Restart', 132, 420); }
  uiCtx.font = '12px monospace'; uiCtx.fillStyle = '#9fb4ff';
  const activeParticles = particles.reduce((n, p) => n + (p.active ? 1 : 0), 0);
  uiCtx.fillText(`FPS ${state.fps}  sprites ${(renderer.verts.length / 5 / 6) | 0}  particles ${activeParticles}`, 18, 76);
  uiCtx.restore();

  const _origin = worldToScreen(0, 0); void _origin;
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
