/**
 * Minimal D1Database shim over node:sqlite's DatabaseSync — real SQL, real
 * migrations, real UNIQUE/CHECK enforcement, zero external deps. Only the
 * surface the worker actually uses is implemented:
 *   prepare(sql).bind(...).first<T>() / .all<T>() / .run()
 *   DB.batch([stmt, ...])  — executed inside one SQLite transaction, matching
 *                            D1's atomic batch semantics.
 *
 * `queryCount` instruments the 50-queries-per-invocation free-tier limit:
 * every executed statement increments it, including each statement inside a
 * batch(). Tests reset it before an operation and assert the worst-case
 * invocation stayed within budget.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export class SqliteD1Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = [],
    private onQuery?: () => void,
  ) {}

  bind(...params: unknown[]): this {
    this.params = params;
    return this;
  }

  private coerced(): (string | number | null)[] {
    return this.params.map((p) => {
      if (p === undefined || p === null) return null;
      if (typeof p === 'number' || typeof p === 'string') return p;
      if (typeof p === 'boolean') return p ? 1 : 0;
      return String(p);
    });
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.onQuery?.();
    this.assertBindCount();
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.coerced()) as T | undefined;
    return row ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    this.onQuery?.();
    this.assertBindCount();
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...this.coerced()) as T[];
    return { results: rows };
  }

  private assertBindCount(): void {
    // D1 rejects a statement whose bind count doesn't match its `?`
    // placeholders; node:sqlite silently binds missing params as NULL, hiding
    // the bug the live runtime catches. Count anonymous placeholders (naive —
    // our SQL has no literals containing '?').
    const placeholders = (this.sql.match(/\?/g) ?? []).length;
    if (placeholders !== this.params.length) {
      throw new Error(
        `bind count mismatch: SQL has ${placeholders} placeholders but ${this.params.length} binds`,
      );
    }
  }

  async run(): Promise<{ meta: { changes: number; last_row_id: number } }> {
    this.onQuery?.();
    this.assertBindCount();
    const stmt = this.db.prepare(this.sql);
    const info = stmt.run(...this.coerced());
    return {
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid),
      },
    };
  }
}

export class SqliteD1 {
  /** Individual statements executed — mirrors D1's per-invocation accounting. */
  public queryCount = 0;

  constructor(public db: DatabaseSync) {}

  resetQueryCount(): void {
    this.queryCount = 0;
  }

  private countQuery(): void {
    this.queryCount++;
  }

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.db, sql, [], () => this.countQuery());
  }

  /** Atomic batch: all statements run inside one SQLite transaction. */
  async batch(statements: SqliteD1Statement[]): Promise<Array<{ meta: { changes: number } }>> {
    this.db.exec('BEGIN');
    try {
      const out: Array<{ meta: { changes: number } }> = [];
      for (const s of statements) {
        // s.run() already increments queryCount via onQuery — each statement
        // in the batch counts once toward the per-invocation budget.
        out.push(await s.run());
      }
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }
}

/** Apply every migration file in order to a fresh in-memory database. */
export function migratedD1(migrationsDir: string): SqliteD1 {
  const db = new DatabaseSync(':memory:');
  const d1 = new SqliteD1(db);
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  return d1;
}
