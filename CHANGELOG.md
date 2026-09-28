# Changelog

All notable changes to Cyberine DevGuard. Versions follow `version` in `.claude-plugin/plugin.json`; each release is tagged `cyberine-devguard--v<version>`.

## [0.1.0] - 2026-09-28

- PreToolUse hook on Write, Edit and NotebookEdit that asks before a write lands in another git repository the session was not given.
- Modes `ask` (default), `deny-once`, `warn` and `off`; under bypassPermissions every ask is sent as deny.
- Allowed directories from settings, `/add-dir` (through the `DirectoryAdded` hook event) and `--add-dir`; reading the session transcript is opt-in through `read_transcript`.
- Tighten-only repository file `.claude/cyberine-devguard.json` with `mode`, `allowIgnored` and `protect`.
- Skills `/cyberine-devguard:status` and `/cyberine-devguard:help`.
