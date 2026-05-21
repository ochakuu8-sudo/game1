import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';

function waitForServer(url, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await fetch(url, { method: 'GET' });
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // noop: server may still be starting up
      }

      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Server did not start within ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

const server = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'serve'], {
  stdio: 'pipe',
  env: { ...process.env },
});

let browser;
try {
  await waitForServer(baseUrl);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.addInitScript(() => {
    window.__smoke = { drawCalls: 0, rafCalls: 0 };
    const originalDrawArrays = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function patchedDrawArrays(...args) {
      window.__smoke.drawCalls += 1;
      return originalDrawArrays.apply(this, args);
    };

    const originalRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = function patchedRAF(cb) {
      return originalRAF.call(this, (t) => {
        window.__smoke.rafCalls += 1;
        return cb(t);
      });
    };
  });

  const response = await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load' });
  assert.ok(response?.ok(), 'index.html should load');

  await page.waitForTimeout(800);

  const smoke = await page.evaluate(() => {
    const glCanvas = document.getElementById('gl');
    const uiCanvas = document.getElementById('ui');
    const gl = glCanvas?.getContext('webgl');
    return {
      hasGlCanvas: !!glCanvas,
      hasUiCanvas: !!uiCanvas,
      hasWebGLContext: !!gl,
      drawCalls: window.__smoke?.drawCalls ?? 0,
      rafCalls: window.__smoke?.rafCalls ?? 0,
    };
  });

  assert.equal(pageErrors.length, 0, `No page errors expected, got: ${pageErrors.map((e) => e.message).join(', ')}`);
  assert.equal(smoke.hasGlCanvas, true, 'GL canvas must exist');
  assert.equal(smoke.hasUiCanvas, true, 'UI canvas must exist');
  assert.equal(smoke.hasWebGLContext, true, 'WebGL context must be initialized');
  assert.ok(smoke.rafCalls >= 2, `Animation loop should start. rafCalls=${smoke.rafCalls}`);
  assert.ok(smoke.drawCalls >= 1, `WebGL drawArrays should be called. drawCalls=${smoke.drawCalls}`);

  console.log('WebGL smoke test passed', smoke);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
