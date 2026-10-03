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

The deny reasons differ on purpose: devguard drops the personal pointers (`settings.json deny list`, the 2026-03-24 incident, `~/.claude/rules/safety.md`) and names `CYBERINE_DEVGUARD_ALLOW_DANGER` or the `allow_danger_env` variable as the escape.
