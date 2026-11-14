#!/usr/bin/env node
/**
 * PageCraft deterministic brand icon pipeline.
 *
 * Reads high-resolution `assets/brand-logo-master.png` and generates:
 *   - public/icon/{16,32,48,96,128}.png  (32-bit RGBA with 8x8 supersampled squircle transparent corners)
 *   - store-assets/edge-logo-300x300.png (24-bit solid RGB, `hasAlpha: no` for Edge Partner Center)
 *
 * Zero external npm dependencies:
 *   1. Uses headless Google Chrome HTML5 Canvas over DevTools Protocol (built-in WebSocket) to perform
 *      high-quality multi-step <=2x progressive downsampling (`imageSmoothingQuality = 'high'`) from
 *      each target's optical crop box — completely free of Lanczos negative-lobe color ringing.
 *   2. Applies an 8x8 subpixel-supersampled continuous-squircle (~22.4% corner radius) alpha mask
 *      for extension icons (16, 32, 48, 96, 128), with a ~6.5% tighter optical crop on 16px & 32px
 *      so the window + 4-point spark silhouette fills Chrome/Edge toolbars boldly.
 *   3. Encodes deterministic RGBA (colorType 6) and 24-bit solid RGB (colorType 2, `hasAlpha: no`) PNGs.
 *
 * Usage:
 *   node scripts/build-icons.mjs
 *   node scripts/build-icons.mjs --crop 0.06
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DEFAULT_MASTER = join(REPO, 'assets', 'brand-logo-master.png');
const ICON_DIR = join(REPO, 'public', 'icon');
const EDGE_LOGO_OUT = join(REPO, 'store-assets', 'edge-logo-300x300.png');
const ICON_SIZES = [16, 32, 48, 96, 128];

const args = process.argv.slice(2);
function optVal(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const CHROME =
  process.env.CHROME_PATH ||
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Headless Chrome Multi-Step HTML5 Canvas Downsampler ───────────────────

async function launchChrome() {
  if (!CHROME) {
    throw new Error('Google Chrome binary not found. Set CHROME_PATH environment variable.');
  }
  const profile = mkdtempSync(join(tmpdir(), 'pc-icons-chrome-'));
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--force-color-profile=srgb',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let wsUrl;
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !wsUrl; i++) {
    await sleep(80);
    if (existsSync(portFile)) {
      const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
      if (port && path) wsUrl = `ws://127.0.0.1:${port}${path}`;
    }
  }
  if (!wsUrl) {
    proc.kill('SIGTERM');
    throw new Error('Headless Chrome did not expose DevToolsActivePort');
  }
  return { proc, profile, wsUrl };
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject: rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return new Promise((res, rej) => {
    ws.onopen = () => res({ send, close: () => ws.close() });
    ws.onerror = (err) => rej(err);
  });
}

/**
 * Renders multiple target resolutions from the master PNG inside Chrome's Skia HTML5 Canvas
 * using progressive <=2x halving steps (`imageSmoothingQuality = 'high'`) plus per-target
 * crop boxes, returning raw RGBA buffers with zero color-ringing artifacts.
 */
async function renderMultiStepTargets(masterPath, targetSpecs) {
  const pngBase64 = readFileSync(masterPath).toString('base64');
  const chrome = await launchChrome();
  const cdp = await connectCdp(chrome.wsUrl);
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);

    const specsJson = JSON.stringify(targetSpecs);
    const expression = `(async () => {
      const specs = ${specsJson};
      const img = new Image();
      img.src = 'data:image/png;base64,${pngBase64}';
      await img.decode();
      const W = img.naturalWidth;
      const H = img.naturalHeight;

      function toBase64(bytes) {
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(bin);
      }

      const outputs = {};
      for (const spec of specs) {
        const { key, size, inset, shiftX, shiftY } = spec;
        const spanW = W * (1 - 2 * inset);
        const spanH = H * (1 - 2 * inset);
        const sx = Math.max(0, Math.min(W - spanW, (W - spanW) / 2 + W * (shiftX || 0)));
        const sy = Math.max(0, Math.min(H - spanH, (H - spanH) / 2 + H * (shiftY || 0)));

        // First extract cropped square at power-of-two friendly high resolution
        let curSize = Math.max(size, Math.min(1024, Math.round(spanW)));
        let curCanvas = document.createElement('canvas');
        curCanvas.width = curSize;
        curCanvas.height = curSize;
        let curCtx = curCanvas.getContext('2d', { colorSpace: 'srgb' });
        curCtx.imageSmoothingEnabled = true;
        curCtx.imageSmoothingQuality = 'high';
        curCtx.drawImage(img, sx, sy, spanW, spanH, 0, 0, curSize, curSize);

        // Progressive <=2x halving pyramid down to final target size
        while (curSize > size * 2) {
          const nextSize = Math.max(size, Math.ceil(curSize / 2));
          const step = document.createElement('canvas');
          step.width = nextSize;
          step.height = nextSize;
          const sctx = step.getContext('2d', { colorSpace: 'srgb' });
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = 'high';
          sctx.drawImage(curCanvas, 0, 0, curSize, curSize, 0, 0, nextSize, nextSize);
          curCanvas = step;
          curSize = nextSize;
        }

        if (curSize !== size) {
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = size;
          finalCanvas.height = size;
          const fctx = finalCanvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
          fctx.imageSmoothingEnabled = true;
          fctx.imageSmoothingQuality = 'high';
          fctx.drawImage(curCanvas, 0, 0, curSize, curSize, 0, 0, size, size);
          curCanvas = finalCanvas;
        }

        const readCtx = curCanvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
        const { data } = readCtx.getImageData(0, 0, size, size);
        outputs[key] = {
          size,
          crop: { sx, sy, spanW, spanH },
          rgbaBase64: toBase64(new Uint8Array(data.buffer)),
        };
      }

      return { naturalWidth: W, naturalHeight: H, outputs };
    })()`;

    const { result, exceptionDetails } = await cdp.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    await cdp.send('Target.closeTarget', { targetId });
    if (exceptionDetails) {
      throw new Error(`Canvas pipeline failed: ${exceptionDetails.text}`);
    }
    const { naturalWidth, naturalHeight, outputs } = result.value;
    const decoded = {};
    for (const [k, v] of Object.entries(outputs)) {
      decoded[k] = {
        size: v.size,
        crop: v.crop,
        rgba: new Uint8Array(Buffer.from(v.rgbaBase64, 'base64')),
      };
    }
    return { naturalWidth, naturalHeight, outputs: decoded };
  } finally {
    cdp.close();
    chrome.proc.kill('SIGTERM');
    await sleep(150);
    try {
      rmSync(chrome.profile, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// ─── 8x8 Supersampled Continuous-Squircle Mask ─────────────────────────────

/**
 * Continuous superellipse-blended rounded square (~22.4% corner radius):
 * Straight edges lie flush on [0, size] across the middle ~55% of each side so
 * 16x16 and 32x32 horizontal/vertical borders have zero pixel stair-stepping,
 * while corners curve smoothly with transparent outer corners (`hasAlpha: yes`).
 */
function insideSquircle(px, py, size, radiusRatio = 0.224, exponent = 2.35) {
  const half = size / 2;
  const r = size * radiusRatio;
  const inner = half - r;
  const dx = Math.max(0, Math.abs(px - half) - inner);
  const dy = Math.max(0, Math.abs(py - half) - inner);
  if (dx === 0 && dy === 0) return true;
  if (dx > r || dy > r) return false;
  return Math.pow(dx / r, exponent) + Math.pow(dy / r, exponent) <= 1;
}

function applySquircleMask(rgba, size) {
  const out = new Uint8Array(rgba.length);
  const SUB = 8; // 8x8 = 64 subpixel samples per pixel
  const invTotal = 1 / (SUB * SUB);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0;
      for (let sy = 0; sy < SUB; sy++) {
        const py = y + (sy + 0.5) / SUB;
        for (let sx = 0; sx < SUB; sx++) {
          const px = x + (sx + 0.5) / SUB;
          if (insideSquircle(px, py, size)) inside++;
        }
      }
      const p = (y * size + x) * 4;
      const cov = inside * invTotal;
      const alpha = Math.round(rgba[p + 3] * cov);
      if (alpha === 0) {
        out[p] = 0;
        out[p + 1] = 0;
        out[p + 2] = 0;
        out[p + 3] = 0;
      } else {
        out[p] = rgba[p];
        out[p + 1] = rgba[p + 1];
        out[p + 2] = rgba[p + 2];
        out[p + 3] = alpha;
      }
    }
  }
  return out;
}

// ─── Deterministic PNG Encoders (RGBA colorType=6 & 24-bit RGB colorType=2) ─

function crc32(buf) {
  return zlib.crc32(buf) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA (hasAlpha: yes)
  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Encodes strictly 24-bit Truecolor RGB PNG (colorType = 2, NO alpha channel, `hasAlpha: no`).
 */
function encodeSolidRgbPng(width, height, rgba, matteRgb = [0xc9, 0x55, 0x33]) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = rowStart + 1 + x * 3;
      const a = rgba[s + 3] / 255;
      raw[d] = Math.round(rgba[s] * a + matteRgb[0] * (1 - a));
      raw[d + 1] = Math.round(rgba[s + 1] * a + matteRgb[1] * (1 - a));
      raw[d + 2] = Math.round(rgba[s + 2] * a + matteRgb[2] * (1 - a));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 2; // Truecolor 24-bit RGB (hasAlpha: no)
  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Main Pipeline ─────────────────────────────────────────────────────────

async function main() {
  const masterPath = optVal('--master') ? resolve(optVal('--master')) : DEFAULT_MASTER;
  if (!existsSync(masterPath)) {
    throw new Error(`Master icon not found at ${masterPath}`);
  }

  const cropArg = optVal('--crop');
  const explicitInset = cropArg !== undefined ? Number(cropArg) : undefined;

  // Build target specifications:
  // - 16px & 32px get ~6.2% tighter inset optically balanced (+1.5% X, -1.2% Y) around the
  //   browser window + top-right 4-point spark so toolbar silhouettes read boldly.
  // - 48, 96, 128 use clean full composition with subtle optical balance.
  // - edge-300 uses full-bleed 24-bit solid RGB (hasAlpha: no).
  const targetSpecs = [
    ...ICON_SIZES.map((size) => ({
      key: `icon-${size}`,
      size,
      inset: explicitInset !== undefined ? explicitInset : size <= 32 ? 0.062 : 0.0,
      shiftX: explicitInset !== undefined ? 0 : size <= 32 ? 0.015 : 0.0,
      shiftY: explicitInset !== undefined ? 0 : size <= 32 ? -0.012 : 0.0,
    })),
    {
      key: 'edge-300',
      size: 300,
      inset: explicitInset ?? 0.0,
      shiftX: 0,
      shiftY: 0,
    },
  ];

  console.log(`• Rendering icon suite from master: ${masterPath}`);
  const { naturalWidth, naturalHeight, outputs } = await renderMultiStepTargets(
    masterPath,
    targetSpecs,
  );
  console.log(`  Master dimensions: ${naturalWidth}x${naturalHeight}`);

  mkdirSync(ICON_DIR, { recursive: true });
  mkdirSync(dirname(EDGE_LOGO_OUT), { recursive: true });

  for (const size of ICON_SIZES) {
    const { rgba } = outputs[`icon-${size}`];
    const masked = applySquircleMask(rgba, size);
    const png = encodeRgbaPng(size, size, masked);
    const outPath = join(ICON_DIR, `${size}.png`);
    writeFileSync(outPath, png);
    console.log(`✓ public/icon/${size}.png`.padEnd(36) + `${size}x${size} RGBA (${png.length} B)`);
  }

  const edgeRgba = outputs['edge-300'].rgba;
  const edgePng = encodeSolidRgbPng(300, 300, edgeRgba);
  writeFileSync(EDGE_LOGO_OUT, edgePng);
  console.log(
    `✓ store-assets/edge-logo-300x300.png`.padEnd(36) + `300x300 24-bit RGB (${edgePng.length} B)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
