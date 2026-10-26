# Constraints: Muellim

The binding rules for agents working in this repository.

## Law

- No agent co-author trailer and no "generated with" line in any commit message.
- The owner reviews and merges every pull request.
- Dependency versions are exact, as `package.json` lists them.
- `.muellim/` and `.usta/` are never committed.
- Every user-facing string lives in `src/strings/en.ts`; every AI call goes through `LlmClient`; unit tests never call a real AI provider.

## Bootstrap

`npm ci`

## Gate

`npm run gate` (Biome check, `tsc --noEmit`, Vitest). There is no e2e suite.

## Baseline

- Gate at 94151ee: Biome 72 files, tsc clean, Vitest 17 files / 173 tests.
