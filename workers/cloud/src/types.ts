export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;

  ADMIN_TOKEN?: string;

  /** Optional env fallback for the daily global cloud generation cap (default: 2000). */
  DAILY_GLOBAL_GEN_LIMIT?: string;

  PRIMARY_LLM_BASE_URL?: string;
  PRIMARY_LLM_API_KEY?: string;
  PRIMARY_LLM_MODEL?: string;

  /** Test seam: when set, outbound LLM calls go through this instead of global fetch. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}
