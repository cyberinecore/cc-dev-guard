# Parity with the original Go hook

`node tests/live/parity.mjs <nf-hooks binary>` feeds the same PreToolUse input to the Go hook (`nf-hooks cross-repo-guard`, the hook devguard ports) and to devguard, over a fixed set of 27 cases built in temp repos, and compares whether each one blocks. The Go hook answers deny, devguard answers ask; both count as block. devguard runs with `read_transcript` on, because the Go hook takes its allowed directories from the transcript; with the default sources the allowed-dir rows pass or block the same way when the directory comes from `--add-dir`, `/add-dir` or settings (`docs/LIVE-MATRIX.md`). Run 2026-09-28 on macOS, git 2.54.0, Node v22.15.1. The case set is the cap: every disagreement is classified below, none is left open.

| case | Go hook | devguard | verdict |
|---|---|---|---|
| same repo | pass | pass | same |
| same repo new subdir | pass | pass | same |
| non-git target | pass | pass | same |
| gitignored in other repo | pass | pass | same |
| other repo | block | block | same |
| other repo new dir | block | block | same |
| through a symlink | block | block | same |
| relative into other repo | block | block | same |
| notebook_path into other repo | block | block | same |
| root A, cwd B, target B | block | block | same |
| root A, cwd B, target A | pass | pass | same |
| non-git session root | pass | pass | same |
| allowed dir | pass | pass | same |
| sibling of allowed dir | block | block | same |
| prefix of allowed dir | block | block | same |
| removed allowed dir | block | block | same |
| snapshot far from EOF | pass | pass | same |
| missing transcript | block | block | same |
| worktree root, write into main | pass | pass | same |
| hub -> submodule, no opt-in | block | block | same |
| hub -> submodule, Go overlay file | pass | block | accepted: Go reads the overlay rule file; devguard needs the user option hub_repos (D11) |
| submodule -> hub | block | block | same |
| repo git cannot read | pass | block | accepted: Go treats a failed git call as non-git and allows; devguard treats a .git entry as a repo |
| devguard config file | pass | block | accepted: devguard always asks about its own config file |
| Claude Code settings file | pass | block | accepted: devguard always asks about settings files (additionalDirectories self-grant) |
| ~/.claude/memory | pass | block | accepted: Go hard-codes ~/.claude/memory; devguard dropped it (D5) and offers extra_allowed_dirs |
| /.vol spelling of other repo | block | block | same |

22 of 27 cases agree.

Every difference is devguard being stricter. Someone migrating from the Go hook who relied on its `~/.claude/memory` allowance or its hub overlay file sets `extra_allowed_dirs` or `hub_repos` instead.

## Bash danger guard

`node tests/live/parity-bashguard.mjs <nf-hooks binary>` feeds every case of the Go hook's table tests (`TestBashGuardDenies`, `TestBashGuardAllows` in `bashguard_test.go`, copied into `tests/fixtures/bashguard-cases.mjs` with the home directory written as `/Users/me` and replaced by the real home at run time) to `nf-hooks bash-guard` and to devguard as a Bash PreToolUse event under bypassPermissions, and compares whether each one is denied. The same cases run in `npm test` against `dangerReason` (`tests/dangerguard.test.mjs`). Run 2026-10-03 on macOS, Node v22.15.1, against a binary built from the Go source as of its commit 42e644aa, with the `isTmpPath` fix (macOS `/var/folders/.../T/`, no `..` segment):

94 of 94 cases agree: 50 denied by both, 44 passed by both, none differing from the Go table.

Intended divergences since D37 (task km5zk), covered by `DEVGUARD_ALLOWS` and `DEVGUARD_DENIES` in the same fixture file and not part of the parity run, which compares the Go table only:

| command shape | Go guard | devguard | why |
|---|---|---|---|
| heredoc body received by `cat` or `tee` (inside `$(...)` only as a `git` argument), unquoted `<<`, no pipe, process substitution or line continuation, closing delimiter present, no `$(` or backtick under an unquoted delimiter (`cat > f.sql <<'EOF'`, a `git commit -m "$(cat <<'EOF' ...)"` message) | denies when the body names a dangerous command | passes | the body is file content, not a command |
| any other heredoc (`psql`, `bash`, `ssh`, `awk`, piped onward, `<<<`, a quoted `'<<EOF'`, `bash -c "$(cat <<'EOF' ...)"`) | denies | denies | unchanged |
| `truncate` followed by a word that continues with `-` (`python -c "print('truncate text-sm')"`) | denies | passes | a Tailwind class, not SQL |
| `truncate` in prose, not at a statement start and not followed by a statement end (`python3 -c "print('writes truncate in place')"`, D42) | denies | passes | English, not SQL |
| `truncate` followed by a table name, any case (`truncate users;`, `TRUNCATE TABLE x`, `truncate a, b`) | denies | denies | unchanged |
| `rm -rf "$(mktemp -d)"`, the whole argument one substitution of `mktemp` with flags and a template | denies (unresolved substitution) | passes | a directory the same command just created in the temp folder |
| `rm -rf "$(mktemp -d)"/*`, `.../..`, or a substitution running anything besides `mktemp` | denies | denies | unchanged |
| `rm -rf <CLAUDE_CONFIG_DIR>/jobs/<id>/...` with `CLAUDE_CONFIG_DIR` absolute and not `$HOME` (D39) | denies | passes | the profile’s own job dir, the same as `~/.claude/jobs/` |
| `rm -rf /abs/dir` where `dir` carries a valid `CACHEDIR.TAG` (D41, `tests/cachedir.test.mjs`) | denies | passes | the owning tool marked it a cache; checked on the real path, never `$HOME`, `/` or inside `.git` |
| a Bash write that names `CACHEDIR.TAG` (redirect, `cp`, `mv`, `ln`, `tee`, `touch` ...) (D41) | passes | denies | a planted tag would unlock the delete above |
| `rm -rf /abs/a/b` below the nearest ancestor with a valid `CACHEDIR.TAG` or a regenerable name, inside the session repository or `$HOME` (D45, `tests/cleanup.test.mjs`) | denies | passes | cargo tags only `target/`; the walk stops at a repository root, `$HOME` and `/` |
| recursive `rm` of a regenerable name directly in `$HOME`, inside `.git`, or at a repository root (D45, task kqgce) | passes | denies | the name alone does not make those folders regenerable |
| destructive text inside a quoted argument of `glab`, `linear` or `cyberine` (D45) | denies when the text names a dangerous command | passes | prose, like `git`, `gh`, `jira` and `curl` arguments |
| shapes the Go guard never checked (D40, `HARDEN_DENIES` in `tests/dangerguard.test.mjs`): `/bin/rm`, `\rm`, `find ... -delete`, `find ... -exec rm -r`, `xargs rm -r`, `rm -rf .git`, `dropdb`, `mysqladmin drop`, `redis-cli FLUSHALL`, mongo shell drops, ORM resets, managed-database deletes, `docker rm -v`, `kubectl delete statefulset`, `DELETE FROM` without `WHERE`, `dd of=/dev/<device>`, `mkfs`, `wipefs`, `git branch -D <protected>`, `git stash clear` | passes | denies | data-destroying, and under bypassPermissions nothing else asks |

The deny reasons differ on purpose: devguard drops the personal pointers (`settings.json deny list`, the 2026-03-24 incident, `~/.claude/rules/safety.md`) and names `CY_ALLOW_DANGER` or the `allow_danger_env` variable as the escape.
