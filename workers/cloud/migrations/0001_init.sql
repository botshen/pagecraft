-- PageCraft Cloud — consolidated schema (fresh database, pre-launch).
--
-- Privacy contract: no table stores prompts, page content, URLs, hostnames,
-- or browsing history. Rows are keyed only by a random anonymous installId
-- (or a SHA-256 hashed IP for abuse throttling).

-- Per-install HMAC signing secret, issued by POST /api/register.
CREATE TABLE IF NOT EXISTS install_secrets (
  install_id   TEXT PRIMARY KEY,
  secret       TEXT NOT NULL,               -- 64-hex HMAC key
  created_at   INTEGER NOT NULL,
  last_used    INTEGER
);

-- Free cloud trial usage (10 generations per install).
CREATE TABLE IF NOT EXISTS install_quotas (
  install_id   TEXT PRIMARY KEY,
  used_count   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- Daily per-key counters for abuse throttling. `install_id` is either a real
-- installId or 'ip:<sha256(ip)>' for IP-scoped limits.
CREATE TABLE IF NOT EXISTS rate_limits (
  install_id  TEXT NOT NULL,
  action      TEXT NOT NULL,
  date        TEXT NOT NULL,                -- YYYY-MM-DD (UTC)
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (install_id, action, date)
);

-- Per-call ledger of upstream LLM spend (token counts only, never content).
CREATE TABLE IF NOT EXISTS llm_calls (
  id                TEXT PRIMARY KEY,         -- uuid
  ts                INTEGER NOT NULL,          -- ms epoch when the call finished
  model             TEXT NOT NULL,
  kind              TEXT NOT NULL,             -- 'pagecraft_gen'
  install_id        TEXT,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  duration_ms       INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL,             -- 'ok' | 'error'
  error             TEXT
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_ts ON llm_calls (ts);

-- Aggregate "did it work?" votes on generated mods. Deliberately NOT keyed
-- by install — only daily counters per coarse bucket, so a vote can never be
-- tied back to a person, site, or prompt.
CREATE TABLE IF NOT EXISTS feedback_daily (
  date      TEXT NOT NULL,                   -- YYYY-MM-DD (UTC)
  verdict   TEXT NOT NULL CHECK (verdict IN ('up', 'down')),
  engine    TEXT NOT NULL CHECK (engine IN ('css', 'js')),
  ai_source TEXT NOT NULL CHECK (ai_source IN ('cloud', 'byok')),
  refined   INTEGER NOT NULL CHECK (refined IN (0, 1)),
  selector  TEXT NOT NULL CHECK (selector IN ('hit', 'miss', 'na')),
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, verdict, engine, ai_source, refined, selector)
);
