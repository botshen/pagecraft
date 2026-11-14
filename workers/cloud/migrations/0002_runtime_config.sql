-- PageCraft Cloud — operator runtime configuration (online LLM key & model overrides).
--
-- API keys stored here (`llm_api_key_enc`) are encrypted at rest using AES-256-GCM
-- with a key derived from SHA-256(ADMIN_TOKEN); raw secrets are never stored in plaintext.

CREATE TABLE IF NOT EXISTS runtime_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
