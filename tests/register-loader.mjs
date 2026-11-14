/**
 * Registers the extensionless `.ts` ESM resolve hook via `module.register`
 * so `pnpm test` runs cleanly without `--experimental-loader` deprecation warnings.
 */
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
