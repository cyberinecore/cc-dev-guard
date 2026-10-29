# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this repo is

`cyberine-devguard` (display name Cyberine DevGuard): a Claude Code plugin whose PreToolUse hook asks before Write, Edit or NotebookEdit touch a file in another git repository that the session was not given. It is a port of a personal Go hook (`crossrepo.go`). Design record and every settled decision: `docs/DECISIONS.md`. Read it before changing behaviour.

## Commands

- Tests: none in the tree since 0.14.0 (D49, owner choice: the directory scans every shipped file and flagged test fixtures). The last suite, unit and live probes, is at tag `cyberine-devguard--v0.13.1`; restore it with `git checkout cyberine-devguard--v0.13.1 -- tests` and run `node tests/run.mjs`.
- Validate the plugin: `claude plugin validate . --strict` and `claude plugin validate .claude-plugin/plugin.json --strict`. This file sits in `.claude/` because a root `CLAUDE.md` makes strict validation fail.
- Explain a verdict: `node scripts/devguard.mjs explain <path> [--cwd <dir>] [--root <dir>] [--transcript <file>]`.

## Layout

- `scripts/devguard.mjs`: entry, subcommands `hook`, `directory-added`, `session-start`, `explain`, `status`, `worktrees`. It only imports the engine, so an engine that fails to load still answers ask.
- `scripts/lib/`: `decide.mjs` (pure decision), `transcript.mjs` (bounded tail reader), `config.mjs` (userConfig plus tightening-only repo file), `git.mjs` (git without a shell), `allowances.mjs` (Claude Code's own folders), `sources.mjs` (allowed dirs from settings, `/add-dir` records and `--add-dir`; the transcript is opt-in), `paths.mjs`, `output.mjs` (mode to hook JSON; under bypassPermissions a cross-repo write is deny-once and every other ask is deny), `constants.mjs`.
- `scripts/lib/dangerguard.mjs` (data-destroying Bash commands, denied in every mode, D34; a port of the Go `bash-guard`, cases in `tests/fixtures/bashguard-cases.mjs` at tag `cyberine-devguard--v0.13.1`), `scripts/lib/cachedir.mjs` (the `CACHEDIR.TAG` probe danger_guard uses to let a tagged cache directory be deleted, D41).
- `scripts/lib/bashguard.mjs` (Bash parsing: `git worktree add` D25, obvious write shapes D28), `scripts/lib/mcpfs.mjs` (filesystem MCP schemas, D29), `scripts/lib/worktrees.mjs` (the report-only `worktrees` command, D27).
- `plugins/cyberine-worktree/`: the second, self-contained plugin (WorktreeCreate hook, D26). It may import only node builtins; it has its own version.
- `hooks/hooks.json`: exec-form `node ${CLAUDE_PLUGIN_ROOT}/scripts/devguard.mjs hook`, matchers `Write|Edit|NotebookEdit`, `Bash` and the filesystem MCP write tools, plus SessionStart `session-start` (surfaces a missing or old node, prunes records) and DirectoryAdded `directory-added` (records `/add-dir` per session).
- `docs/`: `DECISIONS.md`, `LIVE-MATRIX.md`, `FAILURE-MODES.md`, `SECURITY-REVIEW.md`, `PARITY.md`. README claims trace to these or to tests.

## Constraints

- Zero dependencies, Node >= 18, readable ESM, every file under 256 KiB (directory rule). No top-level `bin/`, no lockfile, no binaries.
- The hook never emits `allow`; same-repo and allowed writes emit nothing. Internal errors emit `ask`. Under bypassPermissions, where Claude Code lets some asks through (measured, `docs/LIVE-MATRIX.md`), a cross-repository or other-worktree write in `ask` mode is deny-once: the first write per session and repository is denied and a retry within 10 minutes passes (D35; `bypass_strict` keeps it denied). Every other ask there is sent as deny: guard and settings files, transcripts, `protect` paths, misplaced worktrees and internal errors. danger_guard denies in every mode (D34).
- Every git call goes through `scripts/lib/git.mjs` (no shell, `GIT_*` stripped, fsmonitor off).
- Never read the session transcript unless `read_transcript` is on (directory policy: no reading chat history).
- `.claude/cyberine-devguard.json` may only tighten. Never add a code path that lets a repository widen its own scope.
- Bump `version` in `.claude-plugin/plugin.json`, `package.json` and `VERSION` in `scripts/lib/constants.mjs` together; nothing checks this automatically since D49, so compare all three before a release.
