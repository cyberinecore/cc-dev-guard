# Adversarial review, v0.1.0

Each vector was attacked on real fixtures (temp git repos) or live `claude -p` runs on Claude Code 2.1.283. "Test" names the case in `tests/` that pins the verdict.

| # | Vector | Verdict | Evidence |
|---|---|---|---|
| 1 | Symlinked ancestor pointing into another repo (`a/linked -> b`) | Blocked: the nearest existing ancestor is realpath-resolved before the repo check | `decide.test.mjs` "via symlink" |
| 2 | Symlink inside an allowed dir escaping into another repo | Blocked: allowed-dir match uses the resolved path | `decide.test.mjs` "symlink escaping an allowed dir" |
| 3 | Allowed dir listed through a symlink, `/tmp` vs `/private/tmp`, trailing slash | Passes as intended: entries are realpath-resolved | `transcript.test.mjs`, `decide.test.mjs` |
| 4 | `..` segments, doubled separators | Blocked: paths are normalized first | `adversarial.test.mjs` |
| 5 | macOS `/.vol/<dev>/<ino>`, `/.nofollow`, `/.resolve/1` spellings | Blocked: realpath does not canonicalize them, but git resolves the repo | `decide.test.mjs` "/.vol", `adversarial.test.mjs` |
| 6 | Case variants on a case-insensitive volume | Blocked for another repo (realpath canonicalizes case); a case variant of an existing allowed dir resolves to that dir and passes, which is the same directory; a case variant of a not-yet-existing allowed dir is a false ask | `decide.test.mjs`, `adversarial.test.mjs` |
| 7 | Unicode NFD vs NFC spelling of another repo's folder | Blocked (APFS is normalization-insensitive, realpath returns the on-disk form) | `adversarial.test.mjs` |
| 8 | Hard link from the session repo to a file in another repo | Accepted: Write and Edit replace the file through a temp file and rename (Claude Code debug log: "Applied original permissions to temp file"), which breaks the link instead of writing through it | reasoned |
| 9 | Windows junctions and UNC paths | Accepted as best-effort (D9): `realpathSync.native` resolves junctions; CI runs the unit suite on Windows; no live Windows probe | reasoned |
| 10 | Relative `../other/x` path | Blocked: Claude Code 2.1.283 sends absolute paths; relative ones are joined to the hook `cwd` defensively | live matrix row `relative-other-repo`, `decide.test.mjs` |
| 11 | NUL byte in the path | Blocked (ask) | `decide.test.mjs` |
| 12 | Repository file `.claude/cyberine-devguard.json` widening scope (`extraAllowedDirs`, `hubRepos`, `mode: off`, `allowIgnored: true`) | Ignored with a warning; writes to the file itself always ask | `config.test.mjs`, `decide.test.mjs` |
| 13 | Repository settings `env` setting `CLAUDE_PLUGIN_OPTION_MODE=off` | Was a bypass (live: the write ran). Fixed: option keys set in the session repo's `.claude/settings.json` env are applied tighten-only | live probe 2026-09-28; `adversarial.test.mjs` |
| 14 | Repository settings `env` setting `PATH` or `NODE_OPTIONS` | NOT DEFENDED: Claude Code passes project env to hook processes, so a trusted workspace can hide `node` or preload code, and the hook fails open (live: "Executable not found in $PATH"). Same class as a repository shipping its own hooks or `permissions.additionalDirectories`: Claude Code's workspace trust is the boundary. Documented in the README | live probe 2026-09-28 |
| 15 | `HOME`, `CLAUDE_CONFIG_DIR`, `CLAUDE_JOB_DIR`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT` from repository settings env | Not passed through to the hook by Claude Code (live probe), so allowances and the anchor cannot be redirected that way | live probe 2026-09-28 |
| 16 | The model writing a Claude Code settings file to add `additionalDirectories` | Always asks (deny under bypassPermissions) for `.claude/settings.json`, `.claude/settings.local.json` and the config dir's settings files | `adversarial.test.mjs` |
| 17 | Transcript forgery (writing a fake environment snapshot) | Only matters with `read_transcript` on (D17). Writes to `*.jsonl` under the config dir's `projects/` always ask. Appending through Bash is outside the file-tool boundary (accepted, D7) | `adversarial.test.mjs` |
| 17b | Forging a `/add-dir` record in devguard's data dir | Writes into the plugin data dir always ask; session ids are restricted to `[A-Za-z0-9._-]` so a record cannot be written outside `sessions/` | `decide.test.mjs` "devguard's own data dir", `sources.test.mjs` |
| 17c | A misleading `claude` command line (`--add-dir` injected into argv) | Accepted: only the user or the parent process can set the argv of the running Claude Code; it is the same grant Claude Code itself applies | reasoned |
| 18 | Hub submodule self-grant | Not possible from inside a repository: the opt-in is the user's `hub_repos` option (D11) | `decide.test.mjs` "a repo file cannot opt its own hub in" |
| 19 | `GIT_DIR` / `GIT_WORK_TREE` in the hook environment | Stripped before spawning git | `adversarial.test.mjs` |
| 20 | Target repo `core.fsmonitor` command | Was a real risk: `git check-ignore` and `git rev-parse` run a configured fsmonitor command (measured with git on this machine), so checking a hostile repo would execute its command. Every git call passes `-c core.fsmonitor=false` | `adversarial.test.mjs` |
| 21 | A repo git refuses to read (broken `.git` file, dubious ownership) | Treated as a repo (`unverified:<path>`), never as a non-git directory | `adversarial.test.mjs` |
| 22 | `ask` under bypassPermissions on safety-check paths (`.claude/`, `.git/`, `.vscode/`, dotfiles) | Was a bypass (live: the write ran after "hookAskFloor"). Fixed: every ask becomes deny when the hook input reports bypassPermissions | `docs/LIVE-MATRIX.md`, `output.test.mjs` |
| 23 | Hook start failure, timeout, missing node, malformed output | Fail open, Claude Code's contract; engine load failure is caught and asks; missing node warns at session start | `docs/FAILURE-MODES.md` |
| 24 | Stale grants: with `read_transcript`, a directory added in the same batch as a write (false ask) or removed (brief pass until the next tool result); without it, a directory removed mid-session stays allowed until the session ends | Accepted, documented in the README | prior measurement E4; D17 |
| 25 | Absent or unreadable transcript with `read_transcript` on (`CLAUDE_CODE_SIMPLE`, remote call, older transcripts) | Nothing is granted from it; devguard falls back to settings, `/add-dir` records and `--add-dir`, and the prompt says the transcript could not be read | `transcript.test.mjs`, `decide.test.mjs` |
| 26 | Non-string or array `file_path` | Accepted: Claude Code validates the tool schema before PreToolUse (live: an invalid NotebookEdit call never reached the hook) | harness probe 2026-09-28 |
| 27 | Writes through Bash, MCP tools, `!` commands | Out of scope for v0.1 (D7), stated in the README | - |
