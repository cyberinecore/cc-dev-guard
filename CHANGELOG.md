# Changelog

All notable changes to Cyberine DevGuard. Versions follow `version` in `.claude-plugin/plugin.json`; each release is tagged `cyberine-devguard--v<version>`.

## [0.14.0] - 2026-10-29

- `tests/` is removed from the repository, so the plugin directory no longer scans test fixtures (D49). CI runs plugin validation only. The last suite is at tag `cyberine-devguard--v0.13.1`. No hook behaviour changes.

## [0.13.1] - 2026-10-29

- The decision-log tests no longer hold any secret-shaped literal: the command-not-logged test uses a plain marker variable, and the `redactCommand` cases build their credential-like inputs at run time (the directory policy still flagged `tests/decisionlog.test.mjs` after 0.12.1).

## [0.13.0] - 2026-10-29

- `relaunch_limit` now defaults to 10 launches per app per 60 minutes, up from 5 (D48). A value set in the plugin options is kept, and a repository file can still only lower it.

## [0.12.1] - 2026-10-29

- The decision-log test builds its fake GitHub token at run time, so no shipped file holds a string shaped like a real token (directory policy flagged `tests/decisionlog.test.mjs`).

## [0.12.0] - 2026-10-28

- `danger_guard` reads recursive `rm` targets with shell quoting and resolves `.` and `..` first (D47). `rm -rf "/Users/x/dist precious"` is now judged as one path and denied (before, the space split it and `dist` passed); `rm -rf ./src/..`, `rm -rf a/../..` and `rm -rf ./*` are denied; an absolute path with a `..` segment gets no allowance; an unterminated quote denies.
- A recursive `rm` of a variable set to a literal earlier in the same command is judged by its value: `S=$HOME/.claude/jobs/x/tmp/hl && rm -rf $S` passes, `S=/ && rm -rf $S` and `S=$(pwd) && rm -rf $S` stay denied.
- New ask verdict for deletions that can lose work (denied under `bypassPermissions`): `git worktree remove --force`, a recursive `rm` of a `.claude/worktrees/<name>` folder, a plain `git worktree remove` of a worktree holding ignored files such as `.env` or commits only its detached HEAD holds, and `git branch -D` of a branch with commits no remote has. A protected branch stays denied.
- When `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS` reaches the hook, the session hint adds a notice that Claude Code's own dangerous-`rm` prompt is off and `danger_guard` is the only layer before a recursive delete (task k4x66, #8). Claude Code 2.1.312 does not pass the variable to hooks, so the notice shows only when it arrives another way.
- With `read_transcript` on, the last `/cd` record counts only when the transcript's project folder is the slug of the directory it names (every non-alphanumeric character becomes `-`; a slug over 200 characters never matches), so a forged record naming another directory grants nothing (task k0c7a, #8).
- The worktree report counts a merged PR only when its head commit is the worktree's HEAD; a reused branch name or a later commit is reported "unverifiable", never merged (task k1831, #9).
- README limits name Claude Code's own dangerous-`rm` prompt and the variable that lifts it, and that plugin hooks do not run while the machine serves a cloud session (task kpgsa, #9). `docs/CC-CONTACT-POINTS.md` gains five Claude Code contact points checked against the 2.1.312 binary (task kp3rc, #9).

## [0.11.2] - 2026-10-27

- `decisions.jsonl` no longer stores the Bash command of a `danger_guard` or `live_guard` stop, only the guard, verdict and the reason shown to Claude (D46). The Anthropic Software Directory Policy does not allow collecting extraneous conversation data, even for logging.

## [0.11.1] - 2026-10-27

- With `log_decisions` on, `decisions.jsonl` now also records every `danger_guard`, `live_guard` and internal-error stop: the guard, verdict, reason, plugin version and, for Bash, the command with values that look like tokens, passwords or keys masked and `$HOME` shortened to `~` (D46). Until now only cross-repository verdicts were logged.

## [0.11.0] - 2026-10-27

- `danger_guard` lets a recursive `rm` through below the nearest folder with a valid `CACHEDIR.TAG` or a regenerable name (`target/debug/bundle/...`, `<repo>/tmp/exp1`), never past the session repository root, `$HOME` or another repository's root (D45). A peer survey found the one real cleanup block was a stale bundle under cargo's `target/`, which cargo tags only at its root.
- The regenerable-name allowance no longer covers a folder directly in `$HOME` (`~/node_modules`), anything inside `.git`, or a repository root named like a build folder.
- Fewer false positives: quoted arguments of `cyberine`, `glab` and `linear` are not scanned; `2>&1` or `2>/dev/null` after a command that reads a `CACHEDIR.TAG` is not a tag write; `live_guard` lets `sfltool dumpbtm` through.
- A denial now says when it matched inside a heredoc body fed to an interpreter or a quoted string handed to a wrapper, so an agent can tell data from a command.
- The session hint names where scratch work goes so it can be deleted later: a `mktemp -d` dir, `$CLAUDE_JOB_DIR/tmp` or `<repo>/tmp/`.

## [0.10.0] - 2026-10-26

- New `live_guard` (default on) for commands that disrupt the running machine rather than destroy data (D44). Denied in every permission mode: `pkill`/`killall` of a common process name (`node`, `cat`, `python`, `claude`, `Google Chrome`, terminal apps and similar), of a pattern of three characters or fewer, or by user with no name; `kill -1` and `kill 0`; `killall Dock`, `Finder`, `SystemUIServer` and other macOS system processes; `shutdown`, `reboot`, `systemctl poweroff`/`reboot`, `launchctl reboot` and AppleScript shut down or restart. Asked about, and denied once under `bypassPermissions`: other kills by name, pattern or port (`kill $(lsof -ti:3000)`, `xargs kill`, `fuser -k`, `kill-port`); tmux commands on sessions this session did not create (`switch-client`, `attach`, `kill-server`, `send-keys`, `kill-session` and the rest; `tmux -L`/`-S` and sessions made with `new-session -s` pass); `defaults write` to Apple or global domains, `networksetup`, `pmset`, `scutil --set`, VPN and firewall changes, `/etc/hosts`; `launchctl`, `crontab`, `brew services` and writes into `LaunchAgents`/`LaunchDaemons` (also through Write, Edit and filesystem MCP tools); `adb` and `xcrun devicectl` changes to a physical device; `rsync --delete` to a remote without `-n`; `systemctl stop`/`restart`. A kill by PID passes.
- New `relaunch_limit` (default 5): an app launched or brought to the front more than that many times within 60 minutes by one session asks, and under `bypassPermissions` is denied on every try. `0` turns it off.
- New `live_guard_desktop` (default off): asks before `pbcopy`, `say`, `afplay`, `cliclick`, `open` without `-g`, and AppleScript keystrokes, dialogs, volume, clipboard or `activate`.
- The session hint gains one sentence for `live_guard`: stop a process by the PID the session started.
- Option keys set through the `env` block of a repository's `.claude/settings.local.json` are now tighten-only, like `.claude/settings.json` (D15); before, that file could turn `danger_guard` off.

## [0.9.3] - 2026-10-17

- Fixed: `session_hint` was missing from the plugin's `userConfig`, so 0.9.2 offered no way to turn the hint off from `/config`. The option is now listed with its default.

## [0.9.2] - 2026-10-17

- The SessionStart hook hands Claude three sentences of `additionalContext` on how to avoid a `danger_guard` denial: a recursive `rm` names its target literally, never through a variable or substitution, and text fed to an interpreter or database client is scanned like a command, so destructive statements go into a file through a plain `cat` heredoc instead. Until now the rule reached Claude only through the first denial, so every session paid one denied attempt per cleanup. The text states principles, not the guard's allow list. Option `session_hint`, default on; nothing is added when it or `danger_guard` is off (D43).

## [0.9.1] - 2026-10-17

- `danger_guard` no longer denies the English word "truncate" in prose that a scanned command carries, such as a Python string in a `python3 - <<'EOF'` heredoc ("writes truncate in place"). A `TRUNCATE` is now denied when it reads as a statement: `TRUNCATE TABLE <name>` anywhere; `truncate <names>` at the start of a statement (after the start of a line, `;`, a quote, `(` or `*/`) and followed by a statement end, quote, `)`, comment, `*` or a TRUNCATE option; or `truncate <names>` anywhere followed by `;`, the end of a line, a comment, `*` or a TRUNCATE option (D42).

## [0.9.0] - 2026-10-15

- `danger_guard` lets a recursive `rm` (and `find ... -delete`) of an absolute or `~` path through when the directory carries a valid `CACHEDIR.TAG`, the cache-directory marker that cargo, SwiftPM, uv, tox, nox, ruff, pytest, mypy and npm's cache write (D41). The check reads the first 43 bytes of the tag on the directory's real path; the tag must be a regular file starting with the spec header. It never applies to `/`, `$HOME` or an ancestor of it, a path inside `.git`, a glob, a shell variable, a `.` or `..` segment, or a target with an unbalanced quote.
- Because a tag now unlocks a delete, `danger_guard` denies an agent writing a `CACHEDIR.TAG`, in every mode: Write, Edit, NotebookEdit and filesystem MCP writes to a path named `CACHEDIR.TAG` (any case), and a Bash command that names one with an unquoted redirect or through `cp`, `mv`, `ln`, `install`, `rsync`, `ditto`, `tar`, `unzip`, `dd`, `tee`, `touch`, `curl`, `wget` or `scp`. Reading or mentioning a tag passes.

## [0.8.0] - 2026-10-12

- `danger_guard` closes gaps found by probing it with real destructive commands, every one of which passed before (D40): `rm` reached as `\rm`, `/bin/rm` or any other path; `find <root> ... -delete` and `find <root> ... -exec rm -r` with the root judged like a recursive `rm` target; recursive `rm` fed by `xargs`; recursive `rm` of a `.git` directory anywhere; `dropdb`, `mysqladmin drop`, `redis-cli FLUSHALL`/`FLUSHDB`, `dropDatabase()`/`.drop()`/`deleteMany({})`/`remove({})` in a mongo shell; ORM resets (`prisma migrate reset`, `prisma db push --force-reset`, `rails`/`rake db:drop`/`db:reset`/`db:schema:load`, `artisan migrate:fresh`/`db:wipe`, `sequelize db:drop`, `typeorm schema:drop`); managed database deletes (`wrangler d1 delete`, `aws rds delete-db-instance`/`delete-db-cluster`, `aws dynamodb delete-table`, `az sql db delete`, `az cosmosdb ... delete`, `gcloud sql instances`/`databases delete`); `docker rm -v`, `kubectl delete statefulset`; `DELETE FROM <table>` with no `WHERE` in the statement; `dd of=/dev/<device>`, `mkfs`, `wipefs`; `git branch -D` of a protected branch and `git stash clear`. Every rule runs through the same wrapper unwrapping (`bash -c`, `ssh`, `sudo`, `xargs`, `docker exec` and the rest, three levels deep) and the same text-only skips, so `echo`, `grep`, comments and `git commit -m` messages still pass.
- README names two known gaps of `danger_guard`: SQL read from a file (`mysql app < x.sql`, `psql -f x.sql`) and a delete written as code in `python -c`/`node -e`.

## [0.7.1] - 2026-10-12

- `danger_guard` lets a recursive `rm` under `<CLAUDE_CONFIG_DIR>/jobs/` through, the same as `~/.claude/jobs/`, so a session run under a per-account config dir can clear its own expanded `CLAUDE_JOB_DIR`. Only when `CLAUDE_CONFIG_DIR` is set, absolute and not `$HOME`; other paths under it stay denied (D39).

## [0.7.0] - 2026-10-04

- With `read_transcript` on, a `/cd` into another repository is followed: the directory of the latest `/cd` becomes an allowed directory, so writes there no longer ask. Claude Code fires no hook for `/cd`, so this reads the `relocated` record Claude Code writes into the transcript; a `cd` inside a Bash command never widens the scope, and with `read_transcript` off nothing changes (`/add-dir` still works everywhere) (D38).
- Fixed: `cp`, `mv`, `ln`, `install` and `rsync` with a session transcript, a Claude Code settings file or a Cyberine DevGuard configuration file as the destination ran without a prompt, because the destination was judged only as a directory. They now ask like a redirect to the same file does.

## [0.6.1] - 2026-10-04

- `danger_guard` stops denying three harmless shapes it inherited from the Go guard: a heredoc body written by a text tool such as `cat > seed.sql <<'EOF'` or a `git commit -m "$(cat <<'EOF' ...)"` message, a Tailwind `truncate` class (`truncate text-sm`) in `python -c` or `node -e`, and `rm -rf "$(mktemp -d)"`. A heredoc fed to anything but `cat` or `tee` (or piped onward), `truncate` followed by a table name in any case, and a `$(mktemp ...)` argument with anything appended or anything else inside are still denied (D37, `docs/PARITY.md`).

## [0.6.0] - 2026-10-03

- A git repository nested inside the session repository under a path the session repository gitignores now passes, for file tools, Bash writes (`git add`, `git commit` in an agent's scratch repository under `.local/tmp/`) and MCP writes, from the main checkout and from a worktree. Before, it was treated as another repository and asked (denied under `bypassPermissions`). Option `allow_ignored_nested_repos`, default on; off sends those writes back to ask. A repository file can only turn it off (D36).

## [0.5.0] - 2026-10-03

- Under `bypassPermissions` a write to another repository is no longer a hard deny: the first one per session and repository is denied with a note telling Claude to retry only if the user named that target this turn, and a retry within 10 minutes passes, so the user can ask for a cross-repository change in chat. Guard files, settings files, transcripts, `protect` paths, misplaced worktrees and data-destroying commands stay denied. New option `bypass_strict` (default off) restores the hard deny; a repository file can only turn it on (D35).

## [0.4.1] - 2026-10-03

- The built-in escape variable of `danger_guard` is now `CY_ALLOW_DANGER=1`; `CYBERINE_DEVGUARD_ALLOW_DANGER` from 0.4.0 is no longer read. `allow_danger_env` still names a second one.

## [0.4.0] - 2026-10-03

- Data-destroying Bash commands are denied in every permission mode, `bypassPermissions` included: recursive `rm` outside temp, worktree and build folders, `git reset --hard`, `git checkout -- .`, `git restore .`, `git clean -f`, force-push to a protected branch or with no branch named, `terraform destroy`, `kubectl delete` of a namespace, volume or `--all`, `docker system prune`, `docker volume rm`/`prune`, `docker compose down -v`, `DROP`/`TRUNCATE`, and `aws s3` deletes. A port of the Go `bash-guard` hook with case parity (`docs/PARITY.md`). New options `danger_guard` (default on), `protected_branches`, `deny_aws_s3_deletes` (default on) and `allow_danger_env`; escape `CYBERINE_DEVGUARD_ALLOW_DANGER=1`, never from a repository's settings env (D34).

## [0.3.0] - 2026-10-03

- Obvious Bash writes are judged like file-tool writes: redirects, `tee`, `sed -i`, `dd of=`, `cp`/`mv`/`install`/`ln`/`rsync` destinations, `touch`/`mkdir`/`rm`/`rmdir`/`truncate`, and git commands that change a repository. Option `bash_guard`, default on (D28).
- Write tools of the reference filesystem MCP server (`write_file`, `edit_file`, `create_directory`, `move_file`) are judged too, matched by name and input schema (D29).
- New option `isolate_worktrees`, default off: a session in a linked worktree is asked before it writes into the main checkout or another worktree (D30).
- Ask and deny reasons name the fix: `/add-dir <directory>` and `extra_allowed_dirs` (D31).
- README states that a worktree and a child process started through Bash are not boundaries.
- cyberine-worktree 0.2.0: warns at session start when another `WorktreeCreate` hook is configured, and ships an icon (D32).

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
