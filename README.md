# Cyberine DevGuard

![Cyberine DevGuard: the session repository inside a boundary, a write to another repository paused at the edge](assets/banner.png)

A Claude Code plugin that keeps a session inside its own repository. When Claude is about to Write, Edit or NotebookEdit a file in a different git repository that the session was not given, Cyberine DevGuard stops and asks you first. Writes inside the session's repository and its worktrees, its allowed directories (`--add-dir`, `/add-dir`, `permissions.additionalDirectories`), paths the other repository gitignores, non-git directories, and Claude Code's own memory and plan folders pass without a prompt.

It exists because an agent that `cd`s into a neighbouring checkout, follows a symlink, or resolves `../other-repo/file` can edit a project nobody asked it to touch, and the permission prompt does not say "this is a different repository".

## Install

In Claude Code:

```
/plugin marketplace add cyberinecore/cc-dev-guard
/plugin install cyberine-devguard@cyberine-devguard
```

From a shell:

```bash
claude plugin marketplace add cyberinecore/cc-dev-guard
claude plugin install cyberine-devguard@cyberine-devguard
```

Cyberine DevGuard needs Claude Code 2.1.219 or later and Node.js 18 or later on the `PATH` that Claude Code runs hooks with. It has no dependencies and installs nothing. Older Claude Code lacks what the plugin relies on: exec-form hooks (2.1.139) and the `DirectoryAdded` hook event (2.1.219); on such a version the guard does not run.

## What happens on a write

For every Write, Edit and NotebookEdit, the hook resolves the target path (following symlinks in the part that exists) and compares the target's git repository with the session's.

- The session's repository is the one Claude Code was started in (`CLAUDE_PROJECT_DIR`). A later `cd` does not move it; a `--worktree` session counts its main checkout as the same repository.
- The hook never answers `allow` and never approves a tool call: it either stays silent, so Claude Code's normal permission rules decide, or it answers `ask` (`deny` under `bypassPermissions` and in `deny-once` mode).
- Passes without a word: the same repository (worktrees included), a directory that is not inside any git repository, a path the other repository ignores (`allow_ignored`, default on), an allowed directory of the session, and Claude Code's own folders (`~/.claude/projects/*/memory/`, `~/.claude/plans/`, a user-level `autoMemoryDirectory`, the session scratchpad and a background job's `tmp/`).
- Everything else is a crossing. What happens then depends on the mode.
- Always asked about, even inside the session's repository: `.claude/cyberine-devguard.json`, Claude Code settings files (`.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json`), session transcripts, Cyberine DevGuard's own data directory, and paths a repository protects with `protect`. Each of these can widen what the session may write.
- A session started outside any git repository is not guarded.

The allowed directories come from three places, read fresh on every crossing: `permissions.additionalDirectories` in the managed, user, project and local settings files; directories added with `/add-dir`, which Cyberine DevGuard records through Claude Code's `DirectoryAdded` hook event for that session only; and the `--add-dir` arguments of the running `claude` process (read from `/proc` on Linux and `ps` on macOS; relative ones are resolved against the directory Claude Code was started in). Cyberine DevGuard never opens the session transcript unless you turn on `read_transcript`: then it reads only the environment snapshot Claude Code writes there, backwards in fixed chunks and at most 256 MiB, which also reflects directories removed during the session, and falls back to the three sources when the snapshot cannot be read.

## Modes

Set with the `mode` option (`/config`, or the plugin's configuration dialog).

| mode | a crossing |
|---|---|
| `ask` (default) | Claude Code asks you, with the target, both repositories and the allowed directories in the prompt. In a headless run (`claude -p`) nobody can answer, so the write does not run and Claude is told why. |
| `deny-once` | Denied the first time per session and repository, with a message telling Claude to retry only if you named the target; a retry within 10 minutes passes. This is how the original hook behaved. |
| `warn` | Never blocks; shows a notice. |
| `off` | Does nothing. |

Under `bypassPermissions` Cyberine DevGuard answers `deny` instead of `ask`. Measured on Claude Code 2.1.283: in that mode an `ask` for a path Claude Code treats as sensitive (`.claude/`, `.git/`, `.vscode/`, dotfiles) is handed to the permission pipeline and the write runs anyway. To allow a directory in such a session, add it with `/add-dir`. See `docs/LIVE-MATRIX.md` for every measured row.

## Configuration

Plugin options, yours only (stored in your user settings by Claude Code):

| option | default | meaning |
|---|---|---|
| `mode` | `ask` | `ask`, `deny-once`, `warn` or `off` |
| `extra_allowed_dirs` | none | absolute directories every session may write to |
| `hub_repos` | none | absolute paths of repositories whose own git submodules count as part of them (both the absorbed and the old in-tree `.git` layouts) |
| `allow_ignored` | `true` | let writes to paths the other repository gitignores pass |
| `log_decisions` | `false` | append each crossing (time, session id, tool, path, verdict) to `decisions.jsonl` in the plugin data directory |
| `read_transcript` | `false` | take the allowed directories from the environment snapshot in the session transcript instead of settings, `/add-dir` and `--add-dir`; the only setting that makes Cyberine DevGuard open the transcript |

A repository can add `.claude/cyberine-devguard.json`, which may only make the guard stricter:

```json
{
  "mode": "ask",
  "allowIgnored": false,
  "protect": ["infra/prod", "migrations"]
}
```

- `mode` can only be raised (`off` < `warn` < `deny-once` < `ask`), never set to `off`.
- `allowIgnored` can only be turned off.
- `protect` lists paths relative to the repository; writes under them ask.
- Anything that would widen scope (`extraAllowedDirs`, `hubRepos`, unknown keys) is ignored with a warning shown in Cyberine DevGuard's next prompt and in `/cyberine-devguard:status`. The same tighten-only rule applies to Cyberine DevGuard options that a repository sets through the `env` block of its committed `.claude/settings.json`.

## Commands

- `/cyberine-devguard:status [path]` prints the session repository, the allowed directories, the effective configuration and, for a path, the verdict and why.
- `/cyberine-devguard:help` explains the modes and settings.
- Outside Claude Code: `node <plugin dir>/scripts/devguard.mjs explain <path> --root <session dir>`.

## Limits

- Only the file tools are guarded. Writes made through Bash (`echo >`, `sed -i`, `cp`, `git -C`), MCP tools, or commands you type with `!` are not seen.
- Without `read_transcript`, a directory removed from the session during the session stays allowed until the session ends (settings edits apply at once), and `--add-dir` paths containing spaces are not recognized on macOS, where only `ps` output is available. With `read_transcript`, a directory added in the same step as a write is seen from the next step (the snapshot is written after the next tool result).
- After `/cd`, the session repository stays the one the session started in.
- A repository you trust can switch Cyberine DevGuard off: Claude Code passes the `env` block of a project's `.claude/settings.json` to hook processes, so a `PATH` without node or a `NODE_OPTIONS` preload stops the hook, and a committed `permissions.additionalDirectories` widens the allowed list. That is Claude Code's workspace-trust boundary; review a repository's `.claude/` before you trust it.
- Fail-open cases, measured in `docs/FAILURE-MODES.md`: no `node` on the `PATH`, a missing or crashing entry script, output that is not JSON, and a hook that exceeds its 15 s timeout all let the write run. Cyberine DevGuard's SessionStart hook also runs `node`, so a missing node shows up at session start as a failed hook (`Executable not found in $PATH: "node"`), and a node older than 18 prints a notice. An internal error while deciding asks instead of failing open.
- A process that can already write to your session transcript or to Cyberine DevGuard's data directory can forge a grant; file-tool writes to both ask, Bash writes are not seen.
- Paths are compared after resolving symlinks and case on the existing part; a case or Unicode variant of a directory that does not exist yet is treated as different (a false ask, never a false pass).

## Platforms

Tested by CI on Linux, macOS and Windows with Node 18, 20 and 22, and measured live on macOS with Claude Code 2.1.283. Windows is best-effort: the unit suite passes there, but no live Windows session has been measured.

Hooks run in Claude Code and Cowork; the claude.ai chat surface ignores hooks, so there only the two skills load.

## Network and data

- Cyberine DevGuard makes no network requests and sends nothing anywhere. See `PRIVACY.md`.
- It does not read your conversation. With the default settings it never opens the session transcript; with `read_transcript` on it parses only the environment snapshot line (working directory and allowed directories) and keeps nothing else.
- It reads, on your machine: the hook event Claude Code passes on stdin, `permissions.additionalDirectories` and `autoMemoryDirectory` from Claude Code settings files, the `env` keys for Cyberine DevGuard's own options in the session repository's `.claude/settings.json`, `.claude/cyberine-devguard.json` files at or above the session directory, the command line of the running `claude` process (`/proc/<pid>/cmdline` or `ps`, only for `--add-dir`) and its start directory (`~/.claude/sessions/<pid>.json`), and git metadata through `git rev-parse`, `git check-ignore` and `git ls-files`. Git runs without a shell, with `GIT_*` variables removed and `core.fsmonitor` disabled.
- It writes only inside its plugin data directory (`~/.claude/plugins/data/<id>/`): `sessions/<session id>.json` (the directories added with `/add-dir` in that session, pruned after 7 days), `markers/` (empty files, `deny-once` mode only, pruned after 10 minutes) and, when `log_decisions` is on, `decisions.jsonl` (time, session id, tool, file path, verdict). Without a data directory, `deny-once` markers go to the system temp directory. Claude Code deletes the data directory when the plugin is uninstalled.
- It changes no settings and stores no personal data beyond those file paths.

## Uninstall or migrate

- Uninstall: `claude plugin uninstall cyberine-devguard@cyberine-devguard` (add `--keep-data` to keep the decision log), then `claude plugin marketplace remove cyberine-devguard`.
- Disable for a while: `claude plugin disable cyberine-devguard@cyberine-devguard`, or set `mode` to `off`.
- Coming from a PreToolUse hook of your own that does the same job: install Cyberine DevGuard, confirm a crossing asks (`/cyberine-devguard:status <path in another repo>`), then remove your own hook entry from `settings.json`. While both are wired, Claude Code takes the stricter answer (measured: a second hook's deny beats Cyberine DevGuard's ask, `docs/LIVE-MATRIX.md`), so there is no unguarded window.

## Development

`npm test` runs the unit suite (real git repositories in temp dirs). `tests/live/matrix.sh` and `tests/live/failures.sh` drive real `claude -p` sessions and spend model quota; `node tests/live/latency.mjs` measures per-call cost. Design decisions and their evidence are in `docs/DECISIONS.md`, the adversarial review in `docs/SECURITY-REVIEW.md`.

## License

MIT, see `LICENSE`. Security reports: see `SECURITY.md`.
