const DPR = Math.min(window.devicePixelRatio || 1, 2);
const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const uiCtx = uiCanvas.getContext('2d', { alpha: true });
const gl = glCanvas.getContext('webgl', { antialias: true, alpha: false });

if (!gl) throw new Error('WebGLが利用できません');

/** ---------------- WebGL runtime atlas ---------------- */
function createProgram(gl, vsSource, fsSource) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

class RuntimeAtlas {
  constructor(gl, size = 1024) {
    this.gl = gl;
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.x = 0; this.y = 0; this.row = 0;
    this.entries = new Map();

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  pack(key, drawFn, w, h) {
    if (this.entries.has(key)) return this.entries.get(key);
    const pad = 2;
    const pw = w + pad * 2, ph = h + pad * 2;
    if (this.x + pw > this.size) { this.x = 0; this.y += this.row; this.row = 0; }
    if (this.y + ph > this.size) throw new Error('atlas overflow');

    const ox = this.x + pad, oy = this.y + pad;
    drawFn(this.ctx, ox, oy);

    const uv = {
      u0: ox / this.size,
      v0: oy / this.size,
      u1: (ox + w) / this.size,
      v1: (oy + h) / this.size,
      w, h,
    };
    this.entries.set(key, uv);
    this.x += pw;
    this.row = Math.max(this.row, ph);
    return uv;
  }

  upload() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
  }
}

const atlas = new RuntimeAtlas(gl, 1024);
atlas.pack('ball', (ctx, x, y) => {
  const r = 14;
  const g = ctx.createRadialGradient(x + 6, y + 6, 3, x + r, y + r, r);
  g.addColorStop(0, '#fff'); g.addColorStop(1, '#9fb3ff');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + r, y + r, r, 0, Math.PI * 2); ctx.fill();
}, 28, 28);
atlas.pack('bumper', (ctx, x, y) => {
  ctx.fillStyle = '#f48'; ctx.beginPath(); ctx.arc(x + 24, y + 24, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd1e3'; ctx.beginPath(); ctx.arc(x + 24, y + 24, 10, 0, Math.PI * 2); ctx.fill();
}, 48, 48);
atlas.pack('flipper', (ctx, x, y) => {
  ctx.fillStyle = '#57d6ff';
  ctx.beginPath();
  ctx.roundRect(x, y + 6, 88, 16, 8);
  ctx.fill();
}, 88, 28);
atlas.upload();

/** ---------------- renderer ---------------- */
const program = createProgram(gl, `
attribute vec2 a_pos;
attribute vec2 a_uv;
uniform vec2 u_res;
varying vec2 v_uv;
void main(){
  vec2 p = (a_pos / u_res) * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  v_uv = a_uv;
}`, `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main(){ gl_FragColor = texture2D(u_tex, v_uv); }
`);

const buf = gl.createBuffer();
const aPos = gl.getAttribLocation(program, 'a_pos');
const aUv = gl.getAttribLocation(program, 'a_uv');
const uRes = gl.getUniformLocation(program, 'u_res');

function pushSprite(arr, x, y, w, h, uv, rot = 0, px = 0.5, py = 0.5) {
  const cx = x + w * px, cy = y + h * py;
  const c = Math.cos(rot), s = Math.sin(rot);
  const pts = [[0,0,uv.u0,uv.v0],[w,0,uv.u1,uv.v0],[w,h,uv.u1,uv.v1],[0,h,uv.u0,uv.v1]];
  const out = pts.map(([lx,ly,u,v]) => {
    const dx = lx - w * px, dy = ly - h * py;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c, u, v];
  });
  const tri = [out[0], out[1], out[2], out[0], out[2], out[3]];
  tri.forEach(v => arr.push(...v));
}

/** ---------------- game state ---------------- */
const world = { w: 500, h: 800 };
const ball = { x: 250, y: 700, vx: 0, vy: 0, r: 14, active: false };
const bumpers = [{x:160,y:220,r:24},{x:260,y:180,r:24},{x:340,y:260,r:24}];
const flippers = {
  left: { x: 145, y: 700, w: 88, h: 28, base: -0.45, max: 0.2, angle: -0.45 },
  right:{ x: 265, y: 700, w: 88, h: 28, base: 0.45, max: -0.2, angle: 0.45 },
};
let score = 0;
const keys = new Set();

addEventListener('keydown', e => keys.add(e.code));
addEventListener('keyup', e => keys.delete(e.code));

function resetBall() { ball.x = 450; ball.y = 740; ball.vx = -30; ball.vy = -380; ball.active = true; }

function resize() {
  const rect = glCanvas.parentElement.getBoundingClientRect();
  for (const c of [glCanvas, uiCanvas]) {
    c.width = Math.floor(rect.width * DPR);
    c.height = Math.floor(rect.height * DPR);
  }
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
}
addEventListener('resize', resize); resize();

let last = performance.now();
function tick(t) {
  const dt = Math.min((t - last) / 1000, 0.033);
  last = t;

  if ((keys.has('Space') || keys.has('KeyW')) && !ball.active) resetBall();

  const lOn = keys.has('ArrowLeft') || keys.has('KeyA');
  const rOn = keys.has('ArrowRight') || keys.has('KeyD');
  flippers.left.angle += ((lOn ? flippers.left.max : flippers.left.base) - flippers.left.angle) * 0.22;
  flippers.right.angle += ((rOn ? flippers.right.max : flippers.right.base) - flippers.right.angle) * 0.22;

  if (ball.active) {
    ball.vy += 720 * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x < ball.r || ball.x > world.w - ball.r) { ball.vx *= -0.96; ball.x = Math.max(ball.r, Math.min(world.w - ball.r, ball.x)); }
    if (ball.y < ball.r) { ball.vy = Math.abs(ball.vy) * 0.96; ball.y = ball.r; }
    if (ball.y > world.h + 40) ball.active = false;

    for (const b of bumpers) {
      const dx = ball.x - b.x, dy = ball.y - b.y;
      const d2 = dx*dx + dy*dy; const rr = (ball.r + b.r) ** 2;
      if (d2 < rr) {
        const d = Math.sqrt(d2) || 1; const nx = dx / d, ny = dy / d;
        ball.x = b.x + nx * (ball.r + b.r + 0.2);
        const vn = ball.vx * nx + ball.vy * ny;
        ball.vx -= 2 * vn * nx; ball.vy -= 2 * vn * ny;
        ball.vx *= 1.04; ball.vy *= 1.04;
        score += 100;
      }
    }
  }

  draw();
  requestAnimationFrame(tick);
}

function draw() {
  const sx = glCanvas.width / world.w, sy = glCanvas.height / world.h;
  const verts = [];
  const sBall = atlas.entries.get('ball');
  const sBump = atlas.entries.get('bumper');
  const sFlip = atlas.entries.get('flipper');

  for (const b of bumpers) pushSprite(verts, (b.x - b.r)*sx, (b.y - b.r)*sy, sBump.w*sx/2, sBump.h*sy/2, sBump);
  pushSprite(verts, (flippers.left.x)*sx, (flippers.left.y)*sy, sFlip.w*sx, sFlip.h*sy, sFlip, flippers.left.angle, 0.1, 0.5);
  pushSprite(verts, (flippers.right.x)*sx, (flippers.right.y)*sy, sFlip.w*sx, sFlip.h*sy, sFlip, flippers.right.angle, 0.9, 0.5);
  if (ball.active) pushSprite(verts, (ball.x - ball.r)*sx, (ball.y - ball.r)*sy, sBall.w*sx, sBall.h*sy, sBall);

  gl.clearColor(0.04, 0.07, 0.14, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
  gl.uniform2f(uRes, glCanvas.width, glCanvas.height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
  gl.drawArrays(gl.TRIANGLES, 0, verts.length / 4);

  uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
  uiCtx.save();
  uiCtx.scale(DPR, DPR);
  const vw = uiCanvas.width / DPR;
  uiCtx.strokeStyle = '#6381ff'; uiCtx.lineWidth = 4;
  uiCtx.strokeRect(6, 6, vw - 12, uiCanvas.height / DPR - 12);
  uiCtx.fillStyle = '#dce4ff'; uiCtx.font = 'bold 20px system-ui';
  uiCtx.fillText(`SCORE ${score}`, 20, 34);
  if (!ball.active) {
    uiCtx.fillStyle = '#fff'; uiCtx.font = 'bold 22px system-ui';
    uiCtx.fillText('SPACEで打ち出し', 160, 400);
  }
  uiCtx.restore();
}

requestAnimationFrame(tick);
