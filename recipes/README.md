# PageCraft Community Recipe Packs (`recipes/packs/`)

This folder is the **GitOps source of truth** for PageCraft's official curated Community Recipe Packs.

Every `.json` file in `recipes/packs/*.json` is statically validated in CI by `scripts/build-recipes.mjs` (and verified by `pnpm test`), then compiled into:
- `lib/userscripts/community-catalog.generated.ts` — bundled inside the PageCraft MV3 extension for **100% offline discovery** (zero runtime remote code fetches).
- `site/recipes/catalog.json` & `site/recipes/index.html` — published to `https://pagecraft.shenxin.space/recipes/` as the public bilingual **Community Recipe Hub**.

---

## Contributing a New Pack

### Option 1 — 1-Click Submit from PageCraft
1. Select your saved rules in PageCraft **My mods -> Pack & Share**.
2. Click **Submit to GitHub Hub** (opens the pre-filled `community_pack.yml` issue template).

### Option 2 — Direct Pull Request
1. Add a `<pack-id>.json` file in `recipes/packs/` using lowercase kebab-case naming (e.g. `notion-calm-reader.json`).
2. Populate required fields (`id`, `author`, `category`, `tags`, `siteHints`, `updatedAt`, `zh`, `en`), keeping `zh.mods` and `en.mods` aligned by `id`, `engine`, and `matches`.
3. Verify your pack locally:
   ```bash
   node scripts/build-recipes.mjs
   pnpm test
   ```
4. Open a Pull Request on `https://github.com/botshen/pagecraft`.

---

## MV3 Safety & Policy Rules

To protect users and keep PageCraft 100% compliant with Chrome Web Store Manifest V3 policies, official curated packs **must pass zero-warning static checks**:
- **Prefer CSS first** (`"engine": "css"`) whenever layout cleanup, ad hiding, typography, or dark reading mode can be achieved cleanly in stylesheets.
- **No dynamic code execution**: `eval()`, `new Function()`, string-based `setTimeout`/`setInterval`, `document.write()`, or dynamic `<script>` creation are blocked.
- **No external network requests or remote scripts**: no `@require`, no `url(https://...)`, no `fetch()`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, or `document.cookie` access.
- **Scoped `@match` patterns**: avoid `<all_urls>` or `*://*/*` in official packs; always target explicit domains.
