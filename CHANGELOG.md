# Changelog

All notable changes to Cyberine DevGuard. Versions follow `version` in `.claude-plugin/plugin.json`; each release is tagged `cyberine-devguard--v<version>`.

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
