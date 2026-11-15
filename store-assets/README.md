# PageCraft store assets

Chrome Web Store / Edge Add-ons listing images. Every screenshot embeds the **real production side panel**
(`.output/chrome-mv3/sidepanel.html` + its built JS/CSS) inside an iframe, with a mocked `window.chrome`
and a scripted scenario — nothing in the panel is redrawn by hand.

## Regenerate everything

```bash
node store-assets/harness/capture.mjs           # add --build to run `pnpm build` first
```

Requirements: Node ≥ 22 (built-in `WebSocket`), Google Chrome installed (override with `CHROME_PATH=...`).
No npm dependencies. The script builds automatically if `.output/chrome-mv3` is missing.

Other options:

```bash
node store-assets/harness/capture.mjs --only zh/screenshot-1,promo-small-440x280   # subset
node store-assets/harness/capture.mjs --serve --port 4173                          # manual preview in a browser
```

## Output

| File | Size | Content |
| --- | --- | --- |
| `zh/screenshot-1.png` | 1280×800 | Hero: picked element + instruction + CSS draft, “已在当前页命中 2 个目标元素” |
| `zh/screenshot-2.png` | 1280×800 | Table “导出 CSV” JS userscript, applied, with feedback row |
| `zh/screenshot-3.png` | 1280×800 | One-click recipes list (site-specific recipe active) |
| `zh/screenshot-4.png` | 1280×800 | Applied mod + live DOM check row + toast, inset of the real 规则库 page |
| `zh/screenshot-5.png` | 1280×800 | 100% Serverless & 4 AI modes: Built-in Gemini Nano + local MCP and Direct BYOK / Ollama |
| `en/screenshot-1..5.png` | 1280×800 | English versions of scenes 1–5 (panel in English via `?lang=en`) |
| `promo-small-440x280.png` | 440×280 | Small promo tile |
| `promo-marquee-1400x560.png` | 1400×560 | Marquee promo tile (with real panel) |
| `edge-logo-300x300.png` | 300×300 | Edge store logo (full-bleed 24-bit RGB via `scripts/build-icons.mjs`) |

All PNGs are re-encoded as 24-bit RGB (no alpha channel).

## Harness layout

- `harness/capture.mjs` — static server + headless Chrome (DevTools protocol) + RGB PNG encoder.
  `/panel.html` serves the built `sidepanel.html` with `mock-chrome.js` injected before the module bundle.
- `harness/mock-chrome.js` — mocks `chrome.runtime` (`GET_ACTIVE_TAB`, `USERSCRIPTS_STATUS`,
  `GENERATE_USERSCRIPT`, `USERSCRIPTS_TEST`, `TEST_CONNECTION`, …), `chrome.storage.local` (settings with
  quota, saved mods, `onboardingDone: true`) and drives the real UI per `?mock=` scenario
  (`hero`, `table`, `recipes`, `applied`, `mods`, `settings-cloud`, `settings-byok`).
- `harness/frame.html` + `frame.css` + `scenes.js` — 1280×800 compositions (`?scene=1..5&lang=zh|en`):
  caption band, mock browser window with a hand-written mock webpage, real panel iframe on the right.
- `harness/promo.html` — promo tiles and Edge logo (`?kind=small|marquee|logo`).

Mock pages are generic look-alikes (no real brand logos); hostnames such as `www.zhihu.com` only appear in
the address bar / panel site pill because the built-in recipes target those sites.
