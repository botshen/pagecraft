-- PageCraft Cloud — performance index for /admin overview funnel queries at scale.
CREATE INDEX IF NOT EXISTS idx_install_quotas_used ON install_quotas(used_count);
