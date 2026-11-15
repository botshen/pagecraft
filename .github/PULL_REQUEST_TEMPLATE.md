## Summary

<!-- Briefly describe what this PR changes and why. Link any related issue (e.g., Closes #123). -->

## Type of Change

- [ ] Built-in Website Recipe (`lib/userscripts/templates.ts`)
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (Element Picker, Side Panel UI, CSS/JS runtime, AI provider)
- [ ] Local Coding Agent Bridge (`packages/mcp/` / `lib/mcp/`)
- [ ] Static Site & Sandbox Playground (`site/` / `scripts/build-site.mjs`)
- [ ] Documentation / CI / Governance

## Verification

- [ ] `pnpm compile` passes with 0 TypeScript errors
- [ ] `pnpm test` passes all unit tests
- [ ] `pnpm build` produces `.output/chrome-mv3` cleanly
- [ ] *(If touching `packages/mcp/` or `lib/mcp/`)* `pnpm --dir packages/mcp typecheck` passes
- [ ] *(If touching `site/` or `scripts/build-site.mjs`)* `node scripts/build-site.mjs && node scripts/build-site.mjs --check` passes

## Security & Privacy Checklist

- [ ] Zero remote code execution (no `@require`, remote `<script>`, or `eval`)
- [ ] Outbound AI context fields remain scrubbed by `lib/shared/privacy.ts`
- [ ] No API keys, tokens, personal emails, or local machine paths committed

## Screenshots / Demo (if UI or Website Recipe)

<!-- Attach before/after screenshots or a short screen recording if applicable. -->
