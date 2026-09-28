---
name: help
description: This skill should be used when the request names devguard and asks what it does or how to use it - "/cyberine-devguard:help", "devguard lam gi", "what does devguard do", "how do I configure devguard", "devguard modes", "turn devguard off". Explains the hook, the modes, the configuration surfaces and the limits, and routes to /cyberine-devguard:status for a concrete path. Never fires without a devguard anchor.
disable-model-invocation: true
user-invocable: true
---

# Cyberine DevGuard help

Answer from this page; for a concrete path or "why was I asked", use `/cyberine-devguard:status`.

What it does: a PreToolUse hook on Write, Edit and NotebookEdit. When the target file is in a different git repository from the one the session started in, and not inside a directory the session was allowed, Cyberine DevGuard asks before the write runs. Writes inside the session repository, its worktrees, allowed directories (`--add-dir`, `/add-dir`, `permissions.additionalDirectories`; read from settings, the `/add-dir` hook event and the claude command line, never from the conversation), paths the other repository gitignores, non-git directories, and Claude Code's own memory and plan folders pass without a prompt. A session started outside any git repository is not guarded.

Modes, set with the `mode` plugin option in `/config`:

| mode | on a write outside the session's scope |
|---|---|
| `ask` (default) | Claude Code asks you. In a headless run (`claude -p`) nobody can answer, so the write does not run and Claude is told why. |
| `deny-once` | Denied the first time per session and repository; a retry within 10 minutes passes. The behaviour of the original Go hook. |
| `warn` | Never blocks; shows a notice. |
| `off` | Does nothing. |

Configuration:

- Plugin options (`/config`, yours only): `mode`, `extra_allowed_dirs`, `hub_repos` (repositories whose own submodules count as part of them), `allow_ignored` (default true), `log_decisions` (default false; writes verdicts to the plugin data directory, never over the network), `read_transcript` (default false; take allowed directories from the transcript's environment snapshot, which also tracks removals).
- `.claude/cyberine-devguard.json` in a repository can only make the guard stricter: `"mode"` (raise only, never `off`), `"allowIgnored": false`, and `"protect": ["relative/path"]` to ask before writes to those paths inside the repository. Anything that would widen scope is ignored with a warning, and Cyberine DevGuard asks before any write to that file.

Limits: writes through Bash, MCP tools, or commands you type with `!` are not seen. Without `read_transcript`, a directory removed during the session stays allowed until it ends. Cyberine DevGuard needs `node` on the PATH; without it, or when the hook times out, writes are not checked.
