/**
 * Minimal ESM resolve hook for node:test — appends `.ts` (or `/index.ts`) to
 * extensionless relative specifiers so the repo's bundler-style imports run
 * under plain `node --experimental-strip-types` without touching source.
 *
 * Used by `pnpm test` via `tests/register-loader.mjs` (`--import ./tests/register-loader.mjs`).
 */

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.')) {
    try {
      const base = path.dirname(fileURLToPath(context.parentURL));
      const cand = path.resolve(base, specifier + '.ts');
      if (existsSync(cand)) {
        return { url: pathToFileURL(cand).href, shortCircuit: true };
      }
      const candIndex = path.resolve(base, specifier, 'index.ts');
      if (existsSync(candIndex)) {
        return { url: pathToFileURL(candIndex).href, shortCircuit: true };
      }
    } catch {
      /* fall through to default resolution */
    }
  }
  return nextResolve(specifier, context);
}
