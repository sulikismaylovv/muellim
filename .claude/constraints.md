# Constraints: Muellim

The binding law for every seat. The plan in force adds its own `## Global Constraints`.

## Law

- The repository has no `CLAUDE.md`. The owner's rules below and the plan's Global Constraints are the law.
- No agent co-author trailer and no "generated with" line in any commit message.
- `docs/specs/` is local only (owner ruling, 2026-10-26: "let's not push the spec, and keep them local"). The spec and plan reach this branch through the local branch `local/specs`. No task adds, edits or deletes anything under `docs/specs/`.
- The owner merges every pull request. Nothing is pushed before verify passes; before the push, the controller drops the `local/specs` commit from the program branch (owner ruling, 2026-10-26: "commit the spec and plan on a local-only branch, run spec-to-merge from it, and rebase the specs commit away before anything is pushed").
- Dependency versions are exact, as Task 1's `package.json` lists them. No task adds, removes or upgrades one.
- `.muellim/` and `.usta/` are never committed.

## Bootstrap

From a clean checkout, at the repository root:

`if [ -f package-lock.json ]; then npm ci; fi`

## Gate

`if [ -f package.json ]; then npm run gate; else echo "gate: no package.json yet (before Task 1)"; fi`

`npm run gate` runs `biome check .`, `tsc --noEmit` and `vitest run --passWithNoTests`. There is no e2e suite and no release step.

## Baseline

- Gate (baseline, before Task 1): exit 0, no package.json, 0 tests.
- Gate (phase-1, after Task 18): exit 0, Biome 55 files, tsc clean, Vitest 17 files / 148 tests.
