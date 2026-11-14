import type { Env } from '../../src/types';
import { SqliteD1, migratedD1 } from './d1';
import path from 'node:path';
import fs from 'node:fs';

function migrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), '../migrations'),
    path.resolve(__dirname, '../../migrations'),
    path.resolve(__dirname, '../migrations'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0]!;
}

const MIGRATIONS = migrationsDir();
export const INSTALL = 'install-' + 'a'.repeat(24);
export const TEST_SECRET = 'a'.repeat(64);

export interface FakeLLM {
  status?: number;
  body?: unknown;
  rawText?: string;
  delayMs?: number;
  throw?: Error;
}

export interface TestHarness {
  env: Env;
  d1: SqliteD1;
  llm: {
    calls: Array<{ url: string; body: string; hasSignal: boolean }>;
    queue: FakeLLM[];
    fallback: FakeLLM | null;
  };
}

export function makeHarness(): TestHarness {
  const d1 = migratedD1(MIGRATIONS);
  const llm = {
    calls: [] as Array<{ url: string; body: string; hasSignal: boolean }>,
    queue: [] as FakeLLM[],
    fallback: null as FakeLLM | null,
  };

  const env: Env = {
    DB: d1 as unknown as D1Database,
    ENVIRONMENT: 'test',
    PRIMARY_LLM_BASE_URL: 'https://llm.test/v1',
    PRIMARY_LLM_API_KEY: 'test-key',
    PRIMARY_LLM_MODEL: 'deepseek-chat',
    fetchImpl: async (url: string, init: RequestInit) => {
      llm.calls.push({
        url,
        body: String(init.body ?? ''),
        hasSignal: Boolean(init.signal),
      });
      const next =
        llm.queue.shift() ??
        llm.fallback ?? {
          status: 200,
          body: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    name: 'Clean Sidebar',
                    engine: 'css',
                    css: '.sidebar { display: none !important; }',
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
          },
        };
      if (next.throw) throw next.throw;
      if (next.delayMs) await new Promise((r) => setTimeout(r, next.delayMs));
      const body = next.rawText ?? JSON.stringify(next.body ?? {});
      return new Response(body, {
        status: next.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };

  return { env, d1, llm };
}

export function req(
  path: string,
  opts: {
    method?: string;
    installId?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
  };
  if (opts.installId) headers['X-Install-Id'] = opts.installId;
  return new Request(`https://worker.test${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
}

const encoder = new TextEncoder();

async function hmacHex(secretHex: string, message: string): Promise<string> {
  const bytes = new Uint8Array(secretHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(secretHex.slice(i * 2, i * 2 + 2), 16);
  }
  const key = await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function seedSecret(
  d1: { prepare: (q: string) => { bind: (...args: unknown[]) => { run: () => Promise<unknown> } } },
  installId: string,
  secret = TEST_SECRET,
): Promise<void> {
  await d1
    .prepare(`INSERT INTO install_secrets (install_id, secret, created_at) VALUES (?, ?, ?)`)
    .bind(installId, secret, Date.now())
    .run();
}

export async function signedReq(
  path: string,
  opts: {
    method?: string;
    installId: string;
    secret?: string;
    ts?: number;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  },
): Promise<Request> {
  const ts = String(opts.ts ?? Date.now());
  const method = (opts.method ?? 'GET').toUpperCase();
  const fullUrl = `https://worker.test${path}`;
  const pathname = new URL(fullUrl).pathname;
  const sig = await hmacHex(
    opts.secret ?? TEST_SECRET,
    `${opts.installId}\n${ts}\n${method}\n${pathname}`,
  );
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Install-Id': opts.installId,
    'X-Install-Ts': ts,
    'X-Install-Sig': sig,
    ...(opts.headers ?? {}),
  };
  return new Request(fullUrl, {
    method,
    headers,
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
}
