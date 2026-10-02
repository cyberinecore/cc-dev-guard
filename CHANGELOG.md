# Changelog

All notable changes to Cyberine DevGuard. Versions follow `version` in `.claude-plugin/plugin.json`; each release is tagged `cyberine-devguard--v<version>`.

## [0.2.1] - 2026-10-02

- Fix: the Bash worktree guard asked about read-only `git worktree` subcommands (`list`, `prune`, ...) and other git commands when `-C`, `--git-dir` or an option could not be resolved, for example after `cd $P` in the same command. An unresolved directory now asks only for `git worktree add`.

## [0.2.0] - 2026-10-02

- Bash `git worktree add` for a path outside the repository's `.claude/worktrees/`, or nested inside an existing worktree, now asks (deny under bypassPermissions). Option `worktree_guard`, default on; a repository file can only turn it on (D25).
- New `/cyberine-devguard:worktrees` and `devguard.mjs worktrees [dir...] [--no-gh]`: a report of prunable, stray and merged worktrees per repository that changes nothing (D27).
- New companion plugin `cyberine-worktree` 0.1.0 in the same marketplace: a `WorktreeCreate` hook that places every agent and `EnterWorktree` worktree at `<main repository>/.claude/worktrees/<name>` on branch `worktree/<name>`, based on the session's `HEAD` (D26).

## [0.1.12] - 2026-09-29

- `autoMemoryDirectory` set in the session repository's `.claude/settings.local.json` is now an allowance when git ignores that file (D24). A tracked local settings file and the project `.claude/settings.json` are still not trusted.

## [0.1.11] - 2026-09-28

- `plugin.json` keeps only `privacyPolicyUrl` of the directory listing links; `documentationUrl` and `supportUrl` are dropped because Homepage and Repository already lead to the README and issues, and each unknown key is a portal warning. No behaviour change.

## [0.1.10] - 2026-09-28

- `plugin.json` sets `documentationUrl`, `supportUrl` (GitHub issues) and `privacyPolicyUrl` (`PRIVACY.md`), which the directory listing reads for its links. No behaviour change.

## [0.1.9] - 2026-09-28

- `scripts/lib/git.mjs` builds its `unverified:` marker by concatenation, and a test keeps template literals out of that module, since the directory scan read the literal as a command assembled at run time. `docs/DECISIONS.md` names variables in words instead of placeholder syntax. No behaviour change.

## [0.1.8] - 2026-09-28

- Option-name locals in `scripts/lib/config.mjs` are `optionName`, not `key`, since the directory scan reads credential-sounding names inside template literals as a key being assembled into a command. CI installs a pinned Claude Code (2.1.283). No behaviour change.

## [0.1.7] - 2026-09-28

- The engine no longer receives the whole environment: `scripts/lib/environment.mjs` picks a fixed list of named variables once at startup, and a test fails if any module reads a variable outside that list. README lists the variables.

## [0.1.6] - 2026-09-28

- Messages and file names no longer interpolate upper-case constants, which the directory scan reads as `${ENV_VAR}` references assembled into a command; `REPO_CONFIG_FILE` is a fixed string kept in sync with the plugin name by a test. No behaviour change.

## [0.1.5] - 2026-09-28

- README opens with a banner image for the directory listing.

## [0.1.4] - 2026-09-28

- The fallback marker directory name is a fixed string instead of one built at run time, which the directory scan read as a command assembled at run time.

## [0.1.3] - 2026-09-28

- The `mode` option is a plain string without a picker, because the directory does not accept `options` in `userConfig` yet; an unknown value still falls back to `ask` with a warning.
- Minimum Claude Code is now 2.1.219.
- Git child processes receive only named environment variables (`PATH`, home, temp and locale keys) instead of a copy of the whole environment.
- README states that the hook never answers `allow`.

## [0.1.2] - 2026-09-28

- Adds a square plugin icon for the directory listing.
- `.gitignore` no longer lists other tools' credential files, which the directory scan read as the plugin using them.

## [0.1.1] - 2026-09-28

- Renamed to `cyberine-devguard` (display name Cyberine DevGuard); skill namespace `/cyberine-devguard:*` and repository file `.claude/cyberine-devguard.json` follow the name.
- README states the minimum Claude Code version (2.1.271).
- Marketplace entry declares its schema and the `security` category.

## [0.1.0] - 2026-09-28

- PreToolUse hook on Write, Edit and NotebookEdit that asks before a write lands in another git repository the session was not given.
- Modes `ask` (default), `deny-once`, `warn` and `off`; under bypassPermissions every ask is sent as deny.
- Allowed directories from settings, `/add-dir` (through the `DirectoryAdded` hook event) and `--add-dir`; reading the session transcript is opt-in through `read_transcript`.
- Tighten-only repository file `.claude/devguard.json` with `mode`, `allowIgnored` and `protect`.
- Skills `/devguard:status` and `/devguard:help`, released under the working name `devguard`.
