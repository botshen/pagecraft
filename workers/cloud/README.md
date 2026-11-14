# PageCraft Cloud Worker (`workers/cloud`)

Self-hostable **Cloudflare Worker + D1** backend powering PageCraft's optional **10-credit Cloud AI Trial**, **bilingual landing & sandbox pages**, **static privacy policy**, **anonymous aggregate feedback**, and **`ADMIN_TOKEN`-gated operator console**.

- **Zero Prompt Telemetry**: Prompts, URLs, DOM snippets, and generated CSS/JS rules are **never** stored in D1. Only anonymous installation quota counters, hashed IP rate-limit buckets, aggregate token/latency metrics, and coarse daily feedback totals are persisted.
- **Note for Extension Users**: You do **not** need to deploy this Worker to use PageCraft! The extension supports **100% Offline Local AI** (Ollama / LM Studio) and direct **Bring-Your-Own-Key (BYOK)** connections straight from the browser. Self-host this Worker only if you want to run your own managed trial/team proxy, landing site, and cost circuit-breaker.

Support & inquiries: [botzgbj@gmail.com](mailto:botzgbj@gmail.com) · [GitHub Issues](https://github.com/botshen/plugin-radar/issues)

---

## Self-Hosting & Deployment Guide

### Prerequisites

- **Node.js** `>= 22.6.0` and **pnpm** (`corepack enable`)
- A **Cloudflare account** (Free or Paid plan — Workers + D1 are included on the Cloudflare Free tier)
- An OpenAI-compatible LLM API key (e.g., DeepSeek, OpenAI, OpenRouter, or SiliconFlow)

### 1. Install Dependencies & Run Locally

```bash
cd workers/cloud
pnpm install

# 1. Create your local secrets file (git-ignored)
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and set:
- `PRIMARY_LLM_API_KEY` — Your upstream OpenAI-compatible API key
- `ADMIN_TOKEN` — Any random secret string of **at least 16 characters** (e.g. `openssl rand -hex 24`)

Apply D1 migrations to Wrangler's local SQLite state and start the local Worker on `http://localhost:8787`:

```bash
pnpm d1:migrate:local
pnpm dev
```

Verify locally:
- Health check: `curl http://localhost:8787/api/health`
- Interactive sandbox: `http://localhost:8787/playground`
- Operator console: `http://localhost:8787/admin` (sign in with your `ADMIN_TOKEN`)

---

### 2. Provision Remote Cloudflare D1 & Configure `wrangler.toml`

Log in to Cloudflare Wrangler if you haven't already:

```bash
npx wrangler login
```

Create your D1 database:

```bash
pnpm d1:create
# Equivalent to: npx wrangler d1 create pagecraft-cloud
```

Wrangler will print a `database_id` UUID. Open [`wrangler.toml`](./wrangler.toml) and update two places:

1. **D1 `database_id`**: Replace `"00000000-0000-0000-0000-000000000000"` with the UUID printed by `pnpm d1:create`:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "pagecraft-cloud"
   database_id = "<YOUR_D1_DATABASE_UUID>"
   migrations_dir = "migrations"
   ```
2. **Domain routing (`routes`)**:
   - **Custom domain**: Replace `pagecraft.shenxin.space` in `routes` with your own Cloudflare zone domain (e.g. `pagecraft.example.com`).
   - **`workers.dev` subdomain only**: Comment out or remove the `routes = [...]` block; `workers_dev = true` will publish the Worker to `https://pagecraft-cloud.<your-subdomain>.workers.dev`.
3. **(Optional) Default upstream LLM `[vars]`**: Adjust `PRIMARY_LLM_BASE_URL` and `PRIMARY_LLM_MODEL` if you use a provider other than DeepSeek (can also be changed live in `/admin`).

---

### 3. Apply Remote Migrations & Set Production Secrets

Initialize the remote D1 schema:

```bash
pnpm d1:migrate:remote
```

Upload your production secrets (encrypted at rest by Cloudflare; never put secrets in `wrangler.toml`):

```bash
# Required (>= 16 chars): gates /admin and derives the AES-256-GCM key for runtime D1 overrides
npx wrangler secret put ADMIN_TOKEN

# Optional fallback key if you prefer CLI secrets over setting the key online in /admin
npx wrangler secret put PRIMARY_LLM_API_KEY
```

---

### 4. Deploy & Connect Your Extension Build

Deploy the Worker (`predeploy` automatically compiles `../../PRIVACY.md` into `src/routes/privacy-page.generated.ts`):

```bash
pnpm deploy
```

Post-deploy checklist:
1. Open `https://<your-worker-domain>/admin`, sign in with `ADMIN_TOKEN`, click **Test Connection** to verify upstream LLM connectivity, and set your desired **Global Daily Circuit-Breaker** (`daily_global_limit`, default `2000` calls/UTC day) to cap worst-case API spend.
2. To point a custom build of the PageCraft browser extension at your self-hosted Worker, update `DEFAULT_CLOUD_ENDPOINT` in `lib/shared/constants.ts` (and `host_permissions` if needed) before running `pnpm build` in the repository root.

---

## Endpoints Reference

### Public Pages & Extension APIs
- `GET /` (`/?lang=en`) — Bilingual (`zh-CN` / `en`) PageCraft homepage with OpenGraph/Twitter metadata and `SoftwareApplication` + `FAQPage` JSON-LD.
- `GET /playground` (`/playground?lang=en`) — Zero-credit interactive sandbox page for testing element picking, CSS tweaks, and table CSV export.
- `GET /privacy` — Static HTML privacy policy compiled at build time from [`PRIVACY.md`](../../PRIVACY.md).
- `GET /icon.svg` & `GET /og.svg` — Vector brand mark and `1200x630` OpenGraph card.
- `GET /robots.txt` & `GET /sitemap.xml` — Crawler directives (`Disallow: /admin`) and XML sitemap.
- `POST /api/register` — Mints a per-install HMAC-SHA256 signing secret (IP rate-limited).
- `GET /api/quota` — Returns `{ used, limit: 10, remaining }` for a signed installation.
- `POST /api/generate` — Verifies HMAC signature + PageCraft prompt guard prefix, atomically reserves 1 install credit (`install_quotas`) and 1 global daily slot (`daily_global_limit`), proxies to the upstream OpenAI-compatible `/chat/completions` endpoint (`26s` timeout), refunds both counters on upstream failure, and records token/latency metrics (`llm_calls`) without storing prompt text.
- `POST /api/feedback` — Signed 👍/👎 vote with coarse enums only (`verdict`, `engine`, `aiSource`, `refined`, `selector`), folded into `feedback_daily`.
- `GET /api/health` — Liveness probe (`{ ok: true }`).

### Operator Web Console (`/admin`)
Protected by `ADMIN_TOKEN` (`>= 16` chars), `HttpOnly; Secure; SameSite=Strict` session cookies, failed-login IP rate-limiting, and `Origin` CSRF checks (API routes also accept `Authorization: Bearer <ADMIN_TOKEN>`):
- `GET /admin` — Web dashboard for live LLM key rotation, daily global cap tuning, DeepSeek balance lookup, and `7d` / `28d` / `90d` funnel & feedback analytics.
- `POST /admin/login` & `POST /admin/logout` — Session cookie login/logout.
- `GET /admin/api/overview?days=28` — Aggregated install funnel, daily cap usage, LLM latency/token rollups, feedback rates, and masked LLM config status.
- `POST /admin/api/daily-limit` — Update or reset live `daily_global_limit` in D1 `runtime_config` without redeploying.
- `POST /admin/api/llm-config` — Save or clear runtime `baseUrl`, `model`, and AES-256-GCM-encrypted `apiKey` in D1 `runtime_config`.
- `POST /admin/api/llm-test` — Run a live upstream connectivity and latency check.
- `GET /admin/api/llm-balance` — Query upstream account balance (supports DeepSeek `/user/balance`).

---

## Development & Verification Commands

```bash
pnpm build:privacy     # Regenerate src/routes/privacy-page.generated.ts from ../../PRIVACY.md
pnpm typecheck         # TypeScript strict check (tsc --noEmit)
pnpm test              # Bundle & run Worker unit/integration suite (D1 mock + route + security tests)
pnpm stats [days]      # Query remote D1 aggregate metrics from the terminal (default: 28 days)
```
