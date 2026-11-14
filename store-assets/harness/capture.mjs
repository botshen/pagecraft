#!/usr/bin/env node
/**
 * PageCraft store-asset generator.
 *
 *   node store-assets/harness/capture.mjs            # render every image
 *   node store-assets/harness/capture.mjs --build    # run `pnpm build` first
 *   node store-assets/harness/capture.mjs --only zh/screenshot-1,promo-small-440x280
 *   node store-assets/harness/capture.mjs --serve    # just serve the harness for manual preview
 *
 * How it works
 *   1. A tiny static server maps
 *        /harness/*   -> store-assets/harness/*
 *        /panel.html  -> .output/chrome-mv3/sidepanel.html with mock-chrome.js injected
 *                        as a classic <script> before the real module bundle
 *        /*           -> .output/chrome-mv3/* (the REAL production build)
 *   2. Headless Google Chrome is driven over the DevTools protocol (Node's built-in
 *      WebSocket, no npm deps). Each job loads a composition page, waits for every embedded
 *      side-panel iframe to finish its scripted scenario (window.__ready), then captures.
 *   3. PNGs are re-encoded as 24-bit RGB (alpha composited onto white) so the store never
 *      sees an alpha channel.
 */
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HARNESS = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = resolve(HARNESS, '..');
const REPO = resolve(OUT_ROOT, '..');
const BUILD = join(REPO, '.output', 'chrome-mv3');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const optVal = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const CHROME =
  process.env.CHROME_PATH ||
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p));

// ─── Jobs ──────────────────────────────────────────────────────────────────

const JOBS = [
  ...[1, 2, 3, 4, 5].map((n) => ({
    out: `zh/screenshot-${n}.png`,
    url: `/harness/frame.html?scene=${n}&lang=zh`,
    w: 1280,
    h: 800,
  })),
  ...[1, 2, 3, 4, 5].map((n) => ({
    out: `en/screenshot-${n}.png`,
    url: `/harness/frame.html?scene=${n}&lang=en`,
    w: 1280,
    h: 800,
  })),
  { out: 'promo-small-440x280.png', url: '/harness/promo.html?kind=small', w: 440, h: 280 },
  { out: 'promo-marquee-1400x560.png', url: '/harness/promo.html?kind=marquee', w: 1400, h: 560 },
];

// ─── Static server ─────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function safeJoin(root, urlPath) {
  const p = normalize(join(root, decodeURIComponent(urlPath)));
  return p.startsWith(root) ? p : null;
}

function startServer() {
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    let file = null;
    let body = null;
    if (pathname === '/panel.html') {
      const html = readFileSync(join(BUILD, 'sidepanel.html'), 'utf8');
      body = html.replace(/<head>/i, '<head>\n    <script src="/harness/mock-chrome.js"></script>');
      file = 'panel.html';
    } else if (pathname.startsWith('/harness/')) {
      file = safeJoin(HARNESS, pathname.slice('/harness/'.length));
    } else {
      file = safeJoin(BUILD, pathname === '/' ? 'sidepanel.html' : pathname);
    }
    try {
      if (body == null) body = readFileSync(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((r) => server.listen(Number(optVal('--port') || 0), '127.0.0.1', () => r(server)));
}

// ─── PNG: force 24-bit RGB ─────────────────────────────────────────────────

function crc32(buf) {
  return zlib.crc32 ? zlib.crc32(buf) >>> 0 : crc32Fallback(buf);
}
let CRC_TABLE;
function crc32Fallback(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function toRgbPng(png) {
  let off = 8;
  let w, h, depth, ctype, interlace;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (ctype !== 6 && ctype !== 2)) {
    throw new Error(`Unsupported PNG layout (depth ${depth}, color ${ctype}, interlace ${interlace})`);
  }
  const bpp = ctype === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const cur = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  const out = Buffer.alloc((w * 3 + 1) * h);
  let alphaSeen = false;
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    const o = y * (w * 3 + 1);
    out[o] = 0;
    for (let x = 0; x < w; x++) {
      const s = x * bpp;
      const al = bpp === 4 ? cur[s + 3] : 255;
      if (al !== 255) alphaSeen = true;
      for (let k = 0; k < 3; k++) {
        out[o + 1 + x * 3 + k] = Math.round((cur[s + k] * al + 255 * (255 - al)) / 255);
      }
    }
    cur.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return {
    buf: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(out, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
    w,
    h,
    alphaSeen,
  };
}

// ─── Minimal CDP client ────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome() {
  if (!CHROME) throw new Error('Google Chrome not found; set CHROME_PATH.');
  const profile = mkdtempSync(join(tmpdir(), 'pc-store-chrome-'));
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      '--lang=zh-CN',
      '--window-size=1400,900',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let wsUrl;
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !wsUrl; i++) {
    await sleep(100);
    if (existsSync(portFile)) {
      const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
      if (port && path) wsUrl = `ws://127.0.0.1:${port}${path}`;
    }
  }
  if (!wsUrl) throw new Error('Chrome did not expose a DevTools port');
  return { proc, profile, wsUrl };
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : res(msg.result);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve: res, reject });
      ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return new Promise((r, j) => {
    ws.onopen = () => r({ send, close: () => ws.close() });
    ws.onerror = (e) => j(e);
  });
}

async function capture(cdp, base, job) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', {
    width: job.w,
    height: job.h,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await s('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  await s('Page.navigate', { url: base + job.url });
  const t0 = Date.now();
  let ready = false;
  let errInfo = null;
  while (Date.now() - t0 < 25000) {
    await sleep(150);
    try {
      const { result } = await s('Runtime.evaluate', {
        expression: 'JSON.stringify({r: window.__ready === true, e: window.__errors || null})',
        returnByValue: true,
      });
      const v = JSON.parse(result.value);
      if (v.r) {
        ready = true;
        errInfo = v.e;
        break;
      }
    } catch {
      /* page still loading */
    }
  }
  if (!ready) console.warn(`  ! ${job.out}: timed out waiting for __ready, capturing anyway`);
  if (errInfo && errInfo.length) console.warn(`  ! ${job.out}: scenario errors: ${JSON.stringify(errInfo)}`);
  await sleep(300);
  const { data } = await s('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: job.w, height: job.h, scale: 1 },
    captureBeyondViewport: false,
  });
  await cdp.send('Target.closeTarget', { targetId });
  return Buffer.from(data, 'base64');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (flag('--build') || !existsSync(join(BUILD, 'sidepanel.html'))) {
    console.log('• Building extension (pnpm build)…');
    execSync('pnpm build', { cwd: REPO, stdio: 'inherit' });
  }

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;

  if (flag('--serve')) {
    console.log(`Harness served at ${base}/harness/frame.html?scene=1&lang=zh  (Ctrl-C to stop)`);
    console.log(`Raw panel: ${base}/panel.html?mock=hero&lang=zh&theme=light`);
    return;
  }

  const only = optVal('--only')?.split(',').map((s) => s.trim().replace(/\.png$/, ''));
  const jobs = only ? JOBS.filter((j) => only.includes(j.out.replace(/\.png$/, ''))) : JOBS;

  const chrome = await launchChrome();
  const cdp = await connect(chrome.wsUrl);
  try {
    for (const job of jobs) {
      const png = await capture(cdp, base, job);
      const { buf, w, h } = toRgbPng(png);
      const dest = join(OUT_ROOT, job.out);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      console.log(`✓ ${job.out.padEnd(30)} ${w}x${h}  ${(buf.length / 1024).toFixed(0)} KB`);
    }
  } finally {
    cdp.close();
    chrome.proc.kill('SIGTERM');
    await sleep(300);
    try {
      rmSync(chrome.profile, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
