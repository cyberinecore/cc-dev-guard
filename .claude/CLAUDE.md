# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this repo is

`devguard`: a Claude Code plugin whose PreToolUse hook asks before Write, Edit or NotebookEdit touch a file in another git repository that the session was not given. It is a port of a personal Go hook (`crossrepo.go`). Design record and every settled decision: `docs/DECISIONS.md`. Read it before changing behaviour.

## Commands

- All tests: `npm test` (runs `tests/run.mjs`, which passes every `tests/*.test.mjs` to `node --test`; Node 18 and 20 do not expand the glob themselves on Windows).
- One test: `node --test --test-name-pattern "<name>" tests/<file>.test.mjs`
- Validate the plugin: `claude plugin validate . --strict` and `claude plugin validate .claude-plugin/plugin.json --strict`. This file sits in `.claude/` because a root `CLAUDE.md` makes strict validation fail.
- Explain a verdict: `node scripts/devguard.mjs explain <path> [--cwd <dir>] [--root <dir>] [--transcript <file>]`.
- Live probes against the installed Claude Code: `tests/live/matrix.sh`, `tests/live/failures.sh` (spend model quota), `node tests/live/latency.mjs`, `node tests/live/parity.mjs <nf-hooks binary>`. Not part of `npm test`.

## Layout

- `scripts/devguard.mjs`: entry, subcommands `hook`, `session-start`, `explain`, `status`. It only imports the engine, so an engine that fails to load still answers ask.
- `scripts/lib/`: `decide.mjs` (pure decision), `transcript.mjs` (bounded tail reader), `config.mjs` (userConfig plus tightening-only repo file), `git.mjs` (git without a shell), `allowances.mjs` (Claude Code's own folders), `paths.mjs`, `output.mjs` (mode to hook JSON, ask becomes deny under bypassPermissions), `constants.mjs`.
- `hooks/hooks.json`: exec-form `node ${CLAUDE_PLUGIN_ROOT}/scripts/devguard.mjs hook`, matcher `Write|Edit|NotebookEdit`, plus a SessionStart `session-start` call that surfaces a missing or old node.
- `docs/`: `DECISIONS.md`, `LIVE-MATRIX.md`, `FAILURE-MODES.md`, `SECURITY-REVIEW.md`, `PARITY.md`. README claims trace to these or to tests.

## Constraints

- Zero dependencies, Node >= 18, readable ESM, every file under 256 KiB (directory rule). No top-level `bin/`, no lockfile, no binaries.
- The hook never emits `allow`; same-repo and allowed writes emit nothing. Internal errors emit `ask`. Under bypassPermissions every ask is sent as deny (measured harness behaviour, `docs/LIVE-MATRIX.md`).
- Every git call goes through `scripts/lib/git.mjs` (no shell, `GIT_*` stripped, fsmonitor off).
- `.claude/devguard.json` may only tighten. Never add a code path that lets a repository widen its own scope.
- Bump `version` in `.claude-plugin/plugin.json`, `package.json` and `VERSION` in `scripts/lib/constants.mjs` together; CI checks they match.
