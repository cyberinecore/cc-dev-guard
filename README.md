# Cyberine DevGuard

![Cyberine DevGuard: the session repository inside a boundary, a write to another repository paused at the edge](assets/banner.png)

A Claude Code plugin that keeps a session inside its own repository. When Claude is about to write a file in a different git repository that the session was not given, through Write, Edit, NotebookEdit, an obvious Bash write or a filesystem MCP tool, Cyberine DevGuard stops and asks you first. Writes inside the session's repository and its worktrees, its allowed directories (`--add-dir`, `/add-dir`, `permissions.additionalDirectories`), paths the other repository gitignores, non-git directories, and Claude Code's own memory and plan folders pass without a prompt.

It also keeps git worktrees where you can find them. A Bash `git worktree add` aimed outside the repository's `.claude/worktrees/` (a `/tmp` folder that later vanishes and leaves a stale record behind, a sibling directory) asks first, `/cyberine-devguard:worktrees` reports the stray, prunable and merged worktrees you already have, and the optional companion plugin `cyberine-worktree` routes every worktree Claude Code creates to `<main repository>/.claude/worktrees/<name>`.

It also guards the machine you are working on. A `pkill node` or `pkill -f cat` that would stop other projects' servers, your editor, your apps and Claude Code itself is denied, and so are `killall Dock`, `kill -1` and `shutdown`. A kill by name, pattern or port, a tmux command on a session the agent did not create, a change to macOS system settings, `/etc/hosts`, launch agents or cron, a change to a physical phone, and an `rsync --delete` to a remote ask first. An app relaunched over and over in one session asks too (see [The running machine](#the-running-machine)).

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

One line, both plugins (the second is optional, see [Worktrees](#worktrees)):

```bash
claude plugin marketplace add cyberinecore/cc-dev-guard && claude plugin install cyberine-devguard@cyberine-devguard && claude plugin install cyberine-worktree@cyberine-devguard
```

Cyberine DevGuard needs Claude Code 2.1.219 or later and Node.js 18 or later on the `PATH` that Claude Code runs hooks with. It has no dependencies and installs nothing. Older Claude Code lacks what the plugin relies on: exec-form hooks (2.1.139) and the `DirectoryAdded` hook event (2.1.219); on such a version the guard does not run.

## What happens on a write

For every Write, Edit and NotebookEdit, for each obvious write in a Bash command, and for the write tools of the reference filesystem MCP server, the hook resolves the target path (following symlinks in the part that exists) and compares the target's git repository with the session's.

- The session's repository is the one Claude Code was started in (`CLAUDE_PROJECT_DIR`). A later `cd` does not move it; a `--worktree` session counts its main checkout as the same repository. Every worktree of one repository is one scope unless you turn on `isolate_worktrees`.
- The hook never answers `allow` and never approves a tool call: it either stays silent, so Claude Code's normal permission rules decide, or it answers `ask` (`deny` in `deny-once` mode and under `bypassPermissions`, where a retry you asked for passes; see below).
- Passes without a word: the same repository (worktrees included), a directory that is not inside any git repository, a path the other repository ignores (`allow_ignored`, default on), an allowed directory of the session, and Claude Code's own folders (`~/.claude/projects/*/memory/`, `~/.claude/plans/`, an `autoMemoryDirectory` from user settings or from a gitignored `.claude/settings.local.json`, the session scratchpad and a background job's `tmp/`).
- Everything else is a crossing. What happens then depends on the mode. The reason names the fix: `/add-dir <directory>` for this session, or the `extra_allowed_dirs` option for every session.
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

Under `bypassPermissions` no prompt reaches you, and Claude Code lets an `ask` through for paths it treats as sensitive (folders such as `.claude/`, `.git/`, `.vscode/`, `.idea/`, `.husky/`, and files such as `.bashrc`, `.gitmodules`, `.mcp.json`; measured on 2.1.283 and 2.1.287), so Cyberine DevGuard never answers `ask` there. A write to another repository is handled like `deny-once`: the first one per session and repository is denied with a note telling Claude to retry only if you named that target in this turn, and a retry within 10 minutes passes. So you can still say in chat "write the fix into ../other-repo" and Claude can do it. Turn on `bypass_strict` to deny every such write instead, as before 0.5.0. Writes to Cyberine DevGuard's own configuration, Claude Code settings files, transcripts and `protect` paths, a misplaced `git worktree add`, and data-destroying commands stay denied on every retry. To allow a directory for the whole session, add it with `/add-dir`. See `docs/LIVE-MATRIX.md` for every measured row.

## Configuration

Plugin options, yours only (stored in your user settings by Claude Code):

| option | default | meaning |
|---|---|---|
| `mode` | `ask` | `ask`, `deny-once`, `warn` or `off` |
| `extra_allowed_dirs` | none | absolute directories every session may write to |
| `hub_repos` | none | absolute paths of repositories whose own git submodules count as part of them (both the absorbed and the old in-tree `.git` layouts) |
| `allow_ignored` | `true` | let writes to paths the other repository gitignores pass |
| `allow_ignored_nested_repos` | `true` | let writes into a git repository nested inside the session repository under a path the session repository gitignores pass (an agent's scratch repository in `.local/tmp/`); off: ask like any other repository |
| `log_decisions` | `false` | append each crossing (time, session id, tool, path, verdict), and each `danger_guard`, `live_guard` or internal-error stop (guard, verdict and the reason shown to Claude, with secret-looking values masked and `$HOME` shortened to `~`; the command itself is not stored), to `decisions.jsonl` in the plugin data directory; nothing is sent anywhere |
| `bash_guard` | `true` | read each Bash command for obvious writes (see [Bash and MCP writes](#bash-and-mcp-writes)) and treat each target like a file-tool write |
| `isolate_worktrees` | `false` | ask before a session started in a linked worktree writes into the main checkout or another worktree of the same repository (file tools, Bash writes, MCP writes) |
| `worktree_guard` | `true` | ask before a Bash `git worktree add` whose path lies outside the repository's `.claude/worktrees/` |
| `danger_guard` | `true` | deny data-destroying Bash commands in every permission mode (see [Data-destroying commands](#data-destroying-commands)) |
| `live_guard` | `true` | deny process kills and power commands that reach far beyond the session, and ask before commands that disrupt the user's running machine (see [The running machine](#the-running-machine)) |
| `live_guard_desktop` | `false` | with `live_guard`, also ask before `pbcopy`, `say`, `afplay`, `cliclick`, `open` without `-g`, and AppleScript keystrokes, dialogs, volume, clipboard or `activate` |
| `relaunch_limit` | `10` | with `live_guard`, ask before this session launches or brings the same app to the front more than this many times within 60 minutes (denied under `bypassPermissions`); `0` turns it off |
| `session_hint` | `true` | at session start, hand Claude three sentences on how to avoid a `danger_guard` denial (a literal path for a recursive `rm`, no destructive statements in text fed to an interpreter) and, with `live_guard` on, one sentence on stopping processes by PID; off, or with both guards off, nothing is added |
| `protected_branches` | `main`, `master`, `production`, `prod`, `development`, `develop`, `dev`, `release`, `staging` | branches a force-push to is denied |
| `deny_aws_s3_deletes` | `true` | also deny `aws s3 rm`/`rb` and `aws s3api delete-*` |
| `bypass_strict` | `false` | under `bypassPermissions`, deny every write to another repository instead of letting a retry through |
| `allow_danger_env` | none | name of a second variable that lifts `danger_guard` when set to `1`, besides `CY_ALLOW_DANGER` |
| `read_transcript` | `false` | take the allowed directories from the environment snapshot in the session transcript instead of settings, `/add-dir` and `--add-dir`, and allow the directory a `/cd` moved the session to; the only setting that makes Cyberine DevGuard open the transcript |

A repository can add `.claude/cyberine-devguard.json`, which may only make the guard stricter:

```json
{
  "mode": "ask",
  "allowIgnored": false,
  "protect": ["infra/prod", "migrations"]
}
```

- `mode` can only be raised (`off` < `warn` < `deny-once` < `ask`), never set to `off`.
- `allowIgnored` and `allowIgnoredNestedRepos` can only be turned off.
- `worktreeGuard`, `bashGuard`, `isolateWorktrees`, `dangerGuard`, `denyAwsS3Deletes`, `bypassStrict`, `liveGuard` and `liveGuardDesktop` can only be turned on.
- `relaunchLimit` can only be lowered, to a whole number of at least 1.
- `protectedBranches` adds branch names to the user's list; it cannot remove one.
- `protect` lists paths relative to the repository; writes under them ask.
- Anything that would widen scope (`extraAllowedDirs`, `hubRepos`, `allowDangerEnv`, unknown keys) is ignored with a warning shown in Cyberine DevGuard's next prompt and in `/cyberine-devguard:status`. The same tighten-only rule applies to Cyberine DevGuard options that a repository sets through the `env` block of its `.claude/settings.json` or `.claude/settings.local.json`.

## Bash and MCP writes

Write, Edit and NotebookEdit are not the only way an agent writes. With `bash_guard` on (the default), the hook also reads each Bash command for obvious write shapes and judges every target exactly like a file-tool write, with the same allowances and the same answers:

- `>`, `>>`, `&>` and `>|` redirects (not `2>&1`-style descriptor copies, not `/dev/*`), `tee`, `sed -i`, `dd of=`;
- destinations of `cp`, `mv`, `install`, `ln` and `rsync` (the last operand, or `-t`), skipping remote `host:path` targets;
- `touch`, `mkdir`, `rm`, `rmdir` and `truncate` operands;
- `git` commands that change a repository (`add`, `commit`, `checkout`, `reset`, `merge`, `rebase`, `stash` and similar) run with `-C <dir>` or after a `cd` in the same command.

The parser follows quotes, `cd` within the command, subshells and heredocs (a heredoc body is data, not commands). A target built from a variable or command substitution is skipped rather than asked about, to keep the prompt for real crossings. This is best effort: a script, an alias, `sh -c`, `eval`, or a program that writes files on its own are not seen. A process started through Bash, such as another coding tool or a build script, writes wherever it likes.

Write tools of the reference filesystem MCP server (`@modelcontextprotocol/server-filesystem`) are judged too: `write_file`, `edit_file` (not with `dryRun`), `create_directory`, and `move_file` (both the source and the destination). A tool is matched by its name and by that server's documented input schema, so a different server's tool with the same name but other arguments is left alone. Other MCP servers are not seen.

## Data-destroying commands

With `danger_guard` on (the default), a Bash command that destroys data or rewrites shared history is denied in every permission mode, `bypassPermissions` included, and whatever `mode` is set to. The reason tells Claude to hand the exact command to you instead of rephrasing it.

- recursive `rm` (`-r`, `-R`, `--recursive`; also `\rm`, `/bin/rm` and any other path to `rm`) of `/`, `~`, `.`, `..`, `*`, a `../` path, a target held in a shell variable, a `.git` directory anywhere, or any absolute or `~` path, except temp folders (`/tmp`, `/var/tmp`, the macOS `/var/folders/.../T/` folders, `$TMPDIR`, `$CLAUDE_JOB_DIR`, `~/.claude/jobs/`), paths inside a `.claude/worktrees/<name>/` folder, regenerable folders (`node_modules`, `dist`, `build`, `.next`, `coverage`, `.venv` and similar) and any folder that carries a valid `CACHEDIR.TAG`, the cache marker cargo, SwiftPM, uv, tox, nox, ruff, pytest and mypy write (checked on the real path; never `$HOME`, `/` or inside `.git`), plus any path below the nearest such folder inside the session repository or `$HOME` (`target/debug/bundle/...`, `<repo>/tmp/exp1`), never past a repository root; a regenerable name does not count for a folder directly in `$HOME`, inside `.git`, or at a repository root; an absolute path with a `..` segment gets none of these allowances. Targets are read with shell quoting (`"/a/dist precious"` is one path; an unterminated quote denies) and `.`/`..` are resolved first, so a relative target that resolves to `.` or above (`./src/..`, `a/../..`, `./*`) is denied. A variable set to a literal earlier in the same command (`S=$HOME/.claude/jobs/x/tmp && rm -rf $S`) is resolved and judged by its value; a substitution, a reassignment, a pipe, `||`, `&` or a subshell keeps the deny;
- writing a file named `CACHEDIR.TAG` (Write, Edit, NotebookEdit, filesystem MCP writes, or a Bash redirect into one, `cp`, `mv`, `ln`, `tee`, `touch` and similar naming one; `2>&1` or `2>/dev/null` after a command that only reads a tag passes), because a tag unlocks the delete above;
- `find <root> ... -delete` and `find <root> ... -exec rm -r` (`-execdir` too), where the root is judged like a recursive `rm` target (a relative root such as `.` or `src` passes, `/`, `~`, a variable or an absolute path outside the temp and regenerable folders is denied); recursive `rm` fed by `xargs`, because its targets come from stdin;
- `git reset --hard`, `git checkout -- .`, `git restore .`, `git clean -f`, `git stash clear`, and `git branch -D` (or `-d` with `--force`) of a branch in `protected_branches`;
- a force-push (`--force`, `-f`, `+branch`) to a branch in `protected_branches`, or with no branch named; `--force-with-lease` to an unprotected branch passes;
- `terraform destroy`, `kubectl delete` of a namespace, `pv`, `pvc`, a statefulset or `--all`, `docker system prune`, `docker volume rm`/`prune`, `docker compose down -v`, `docker rm -v`/`--volumes`;
- `DROP DATABASE`/`SCHEMA`/`TABLE` wherever they appear in the command, `TRUNCATE` written as a statement (`TRUNCATE TABLE x`, `truncate users;`, `psql -c 'truncate users'`; the word in prose such as "writes truncate in place" passes), and `DELETE FROM <table>` with no `WHERE` in the same statement (a `DELETE ... WHERE ...` passes, also when the `WHERE` sits on the next line of a heredoc);
- database CLIs: `dropdb`, `mysqladmin drop`, `redis-cli FLUSHALL`/`FLUSHDB`, and `dropDatabase()`, `.drop()`, `deleteMany({})` or `remove({})` handed to `mongo`/`mongosh`;
- ORM resets: `prisma migrate reset`, `prisma db push --force-reset`, `rails`/`rake db:drop`, `db:reset`, `db:schema:load`, `artisan migrate:fresh`, `artisan db:wipe`, `sequelize db:drop`, `typeorm schema:drop`;
- managed databases: `wrangler d1 delete`, `aws rds delete-db-instance`/`delete-db-cluster`, `aws dynamodb delete-table`, `az sql db delete`, `az cosmosdb ... delete`, `gcloud sql instances`/`databases delete`;
- block devices: `dd` with `of=/dev/<device>` (not `/dev/null`, `/dev/stdout` or a tty), `mkfs`, `mkfs.*` and `wipefs`;
- with `deny_aws_s3_deletes` (default on), `aws s3 rm`/`rb` and `aws s3api delete-bucket`/`delete-object`/`delete-objects`.

The same checks run on the quoted text handed to `ssh`, `bash -c`, `sh -c`, `eval`, `xargs`, `sudo`, `env`, `timeout`, `docker exec`, `kubectl exec` and `*.sh` wrappers, three levels deep. Text-only commands (`echo`, `grep`, `git log`, `git commit -m` messages and similar), quoted arguments of `git`, `gh`, `glab`, `jira`, `linear`, `curl` and `cyberine`, and comment lines are not read, so mentioning a command does not trigger it. A denial says when it matched inside a heredoc body fed to an interpreter or inside a quoted string handed to a wrapper.

Some deletions are asked about instead, because they are often what you want but can lose work (under `bypassPermissions`, where no prompt reaches you, they are denied):

- `git worktree remove --force` (or `-f`) of any path, and a recursive `rm` of a `.claude/worktrees/<name>` folder or of `.claude/worktrees` itself; the reason points Claude at ExitWorktree, `claude rm <id>` or a plain `git worktree remove`, which refuses a worktree with uncommitted work;
- a plain `git worktree remove <path>` when that worktree holds ignored files (`.env`, `.local/`; build and cache folders such as `node_modules/` do not count) or commits that only its detached HEAD holds, and `git branch -D <branch>` (or `-d --force`) when the branch has commits that no remote has. The guard asks git through the same shell-free calls it uses everywhere; if git fails or times out, it asks. These checks are skipped for a command inside a quoted string handed to `bash -c` or `ssh`.

To run such a command, run it yourself, or start the session with `CY_ALLOW_DANGER=1` in its environment (or the variable you named in `allow_danger_env`). A value set through the `env` block of a repository's `.claude/settings.json` or `.claude/settings.local.json` is ignored, so a cloned repository cannot lift the guard. A repository file can turn the guard on and add protected branches, never turn it off.

This is a pattern check on the command text, not a sandbox: a script file, an alias, or a program that deletes on its own is not seen. SQL read from a file (`mysql app < dump.sql`, `psql -f reset.sql`) and a delete written as code in `python -c` or `node -e` are not seen either (see [Limits](#limits)). It and the deny list of `live_guard` (see [The running machine](#the-running-machine)) are the parts of Cyberine DevGuard that deny outright, because `bypassPermissions` skips every prompt and settings `deny` rules are the only other gate.

## The running machine

With `live_guard` on (the default), Cyberine DevGuard also reads each Bash command for things that disrupt the machine you are using rather than destroy data: the agent works in one repository, but a process kill, a tmux command or a system setting reaches everything else you have open. The reported cases behind it: `pkill -f "cat"` closed every macOS app (its pattern matches `/Applications` paths; on the author's Mac it matched 214 processes), an unscoped `pkill` stopped a sibling project's dev server, `pkill node` stopped Claude Code and VS Code, and a session relaunched the user's app about 80 times in 45 minutes and moved the user's tmux client to another session.

Denied in every permission mode, like `danger_guard`, because they are always wrong for an agent:

- `pkill` or `killall` (also `pgrep` inside `kill $(...)`) of a common process name (`node`, `python`, `bun`, `cat`, `bash`, `git`, `claude`, `code`, `Google Chrome`, `Safari`, `Slack`, terminal apps, `tmux`, `docker` and similar), of a pattern of three characters or fewer, or of a bare wildcard; `pkill -f` matches the whole command line, so `pkill -f cat` reaches every path that contains `cat`;
- `pkill`/`killall` with a user or group and no name, `kill -1`, `kill 0`;
- `killall` of a macOS system process (`Dock`, `Finder`, `SystemUIServer`, `WindowServer`, `cfprefsd`, `loginwindow`, `ControlCenter`, `NotificationCenter`, `launchd`);
- `shutdown`, `reboot`, `halt`, `poweroff`, `systemctl poweroff`/`reboot`/`suspend`, `launchctl reboot`, and AppleScript that shuts down, restarts or logs out.

Asked about (under `bypassPermissions`: denied once, and a retry within 10 minutes passes; `bypass_strict` keeps it denied):

- other kills by name or pattern (`pkill -f "vite --port 4173"`, `killall MyApp`), kills by port or computed ids (`kill $(lsof -ti:3000)`, `lsof -ti:3000 | xargs kill`, `fuser -k`, `kill-port`), and process-group kills (`kill -- -<pgid>`). A kill by PID (`kill 4242`, `kill $SERVER_PID`, `kill "$(cat dev.pid)"`) passes;
- tmux on your server: `switch-client`, `attach` (not `-r`), `kill-server`, `detach-client`, `lock-*`, `kill-session -a`, and every command that types into, rearranges or closes a session (`send-keys`, `kill-session`, `kill-window`, `select-window`, `rename-session` and the rest) unless its target is a session this Claude Code session created with `tmux new-session -s <name>`, or it runs on its own server (`tmux -L <name>` or `-S <path>`). Session names are remembered per session in the plugin data directory, and a name held in a variable is followed when the same command assigns it;
- macOS settings: `defaults write`/`delete`/`import` to `com.apple.*` or the global domain, `networksetup -set*`, `scutil --set`, `pmset` (other than `-g`), `systemsetup -set*`, `tailscale down`/`up`/`logout`/`set`, `wg-quick`, `pfctl`, `ifconfig ... down`, `route add`/`delete`; writes to `/etc/hosts`;
- jobs that outlive the session: `launchctl load`/`bootstrap`/`bootout`/`enable`/`kickstart` and similar, `crontab` other than `-l`, `brew services start`/`stop`/`restart`, `sfltool` (except the read-only `sfltool dumpbtm`), AppleScript `make login item`, and a write into a `LaunchAgents` or `LaunchDaemons` folder or a cron table (Bash, Write, Edit and filesystem MCP writes);
- physical devices: `adb install`/`uninstall`/`reboot`/`root`, `adb shell am force-stop`/`pm clear`, `xcrun devicectl` with `uninstall` or `--terminate-existing`, `ios-deploy --uninstall`. An emulator (`adb -e`, `-s emulator-*`) and `xcrun simctl` pass;
- `rsync --delete` (or `--remove-source-files`) to a remote `host:path` without `-n`/`--dry-run`; `systemctl stop`/`restart`/`disable` and similar;
- AppleScript that quits an app;
- an app launched or brought to the front (`open -a`, a `.app` path, AppleScript `activate`) more than `relaunch_limit` times in 60 minutes by one session. Under `bypassPermissions` this one is denied on every try, since the retries are the problem.

With `live_guard_desktop` on, it also asks before `pbcopy`, `say`, `afplay`, `cliclick`, `terminal-notifier`, `open` without `-g`, and AppleScript that sends keystrokes or clicks, shows a dialog or notification, changes the volume or the clipboard, or calls `activate`.

The same wrappers are followed as for `danger_guard` (`sudo`, `env`, `nohup`, `timeout`, `bash -c`, `ssh <host> '...'`, `eval`, `xargs`), and text-only commands and `git commit -m` messages pass. `CY_ALLOW_DANGER=1` (or your `allow_danger_env` variable) lifts it, and `live_guard` set to `false` turns it off. Like `danger_guard`, it reads command text only: a script, a build tool or an app that kills or relaunches on its own is not seen, and an app relaunched by a dev server's file watcher is not counted.

## Worktrees

Agents tend to create extra git worktrees in scratch folders. When the folder goes, the worktree record stays, and a repository collects dozens of entries that point at nothing. Cyberine DevGuard handles this in three parts; nothing is banned, and nothing is ever deleted for you.

- **Bash guard** (in `cyberine-devguard`, option `worktree_guard`, default on). Before a Bash command runs `git worktree add`, the hook reads the target path, following `git -C <dir>`, an earlier `cd` in the same command, and `~`. A path directly under the repository's main `.claude/worktrees/` passes. A path anywhere else asks, and so does one nested inside an existing worktree there, or one built from a variable. The ask points the agent at the Agent tool's `isolation: "worktree"` or `EnterWorktree`, or tells it to stay in the checkout and use a scratch directory. Like every Cyberine DevGuard ask, it becomes a deny under bypassPermissions. This is a guardrail, not a boundary: it reads the command text, so a script, an alias, `sh -c` or `eval` can hide the call. The Bash matcher costs about 13 ms per call over a bare node start when the command has no write shape, and about 47 ms when it writes, for the git lookups (measured on macOS, 2026-10-03).
- **Report** (`/cyberine-devguard:worktrees [dir]`, or `node <plugin dir>/scripts/devguard.mjs worktrees [dir...] [--no-gh]`). For each repository at or up to three levels under the directory, it lists worktrees whose directory is gone (prunable), worktrees outside `.claude/worktrees/`, and worktrees whose branch is merged. Merged branches are looked up with `gh pr view <branch> --json state,mergedAt,number` under your active `gh` account, because an ancestry check misses squash merges. Without `gh`, or with `--no-gh`, a branch counts only when the default branch already contains it, and such a branch is labelled "merged or empty". The report prints the cleanup commands and runs none of them.
- **Placement** (separate plugin `cyberine-worktree`, opt-in by installing it). A `WorktreeCreate` hook creates every worktree for the Agent tool's `isolation: "worktree"` and for `EnterWorktree`. Each goes to `<main repository>/.claude/worktrees/<name>` on branch `worktree/<name>`, with `git worktree add --no-track -B`, based on the spawning session's `HEAD`. The main repository is resolved even from inside a linked worktree, so a subagent spawned from a worktree lands beside it, not inside it. A submodule session keeps its worktrees under the submodule. Re-running for an existing worktree prints its path again. It is a separate plugin because Claude Code hands worktree creation entirely to such a hook: the hook cannot fall back to the built-in behaviour, which means `worktreeBaseRef` and the built-in branch naming no longer apply while it is installed.

```bash
claude plugin install cyberine-worktree@cyberine-devguard
```

Disable any other `WorktreeCreate` hook first: Claude Code runs every `WorktreeCreate` hook in parallel, and a second hook that picks a different path or branch leaves an orphan worktree. On Claude Code 2.1.311, `claude --worktree <name>` at launch runs this plugin's hook too (branch `worktree/<name>`); up to at least 2.1.287 it used the built-in creation (branch `worktree-<name>`), because plugin hooks loaded after that worktree was made.

## Commands

- `/cyberine-devguard:status [path]` prints the session repository, the allowed directories, the effective configuration and, for a path, the verdict and why.
- `/cyberine-devguard:worktrees [dir]` reports stray, prunable and merged git worktrees and changes nothing.
- `/cyberine-devguard:help` explains the modes and settings.
- Outside Claude Code: `node <plugin dir>/scripts/devguard.mjs explain <path> --root <session dir>`.

## Limits

- Guarded: the file tools, obvious Bash writes and `git worktree add` (best effort, see [Bash and MCP writes](#bash-and-mcp-writes) and [Worktrees](#worktrees)), and the reference filesystem MCP server. Not seen: writes hidden inside scripts or `sh -c`, files written by a process that Bash starts, other MCP servers, commands you type with `!`, and writes by another plugin's hooks module (Claude Mods), which runs before Cyberine DevGuard and can overrule it.
- A git worktree is not a boundary by default: every worktree of a repository is the session's own repository, so a session in a worktree may write into the main checkout. Turn on `isolate_worktrees` to ask about that. Neither a worktree nor Cyberine DevGuard contains a child process started through Bash.
- Without `read_transcript`, a directory removed from the session during the session stays allowed until the session ends (settings edits apply at once), and `--add-dir` paths containing spaces are not recognized on macOS, where only `ps` output is available. With `read_transcript`, a directory added in the same step as a write is seen from the next step (the snapshot is written after the next tool result).
- After `/cd`, the session repository stays the one the session started in. Claude Code fires no hook for `/cd` (measured, `docs/LIVE-MATRIX.md`), so with default settings every write in the new directory asks; with `read_transcript` on, the directory of the latest `/cd` is allowed (D38). A `cd` inside a Bash command never widens the scope. `/add-dir` works in either setting.
- A repository you trust can switch Cyberine DevGuard off: Claude Code passes the `env` block of a project's `.claude/settings.json` to hook processes, so a `PATH` without node or a `NODE_OPTIONS` preload stops the hook, and a committed `permissions.additionalDirectories` widens the allowed list. That is Claude Code's workspace-trust boundary; review a repository's `.claude/` before you trust it.
- Fail-open cases, measured in `docs/FAILURE-MODES.md`, apply to `danger_guard` too: if the hook cannot run, a data-destroying command is not stopped. Pair it with settings `deny` rules for the commands you never want, which hold in every mode except `bypassPermissions`. Fail-open cases: no `node` on the `PATH`, a missing or crashing entry script, output that is not JSON, and a hook that exceeds its 15 s timeout all let the write run. Cyberine DevGuard's SessionStart hook also runs `node`, so a missing node shows up at session start as a failed hook (`Executable not found in $PATH: "node"`), and a node older than 18 prints a notice. An internal error while deciding asks instead of failing open.
- `danger_guard` reads the command text only. SQL inside a file is not seen: `mysql app < reset.sql`, `psql -f drop.sql`, `sqlite3 app.db < wipe.sql` run whatever the file holds, so the guard cannot tell a seed from a wipe. A delete written as code in `python -c`, `node -e`, `ruby -e` or a REPL (`shutil.rmtree`, `fs.rmSync`, an ORM's `deleteMany`, a `DROP` built from string pieces) is not seen either; only SQL text and shell commands that appear verbatim inside the quoted program are. Pair the guard with settings `deny` rules or a database user without destructive privileges for those.
- A process that can already write to your session transcript or to Cyberine DevGuard's data directory can forge a grant (with `read_transcript` on, a `/cd` record too); file-tool writes and obvious Bash write shapes to both ask, but a write from inside a script or an interpreter (`python3 -c`, `node -e`) is not seen.
- With `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS` set, Claude Code's own prompt before a dangerous `rm` is off, so `danger_guard` is the only layer before a recursive delete, and the session hint says so. Claude Code 2.1.312 does not pass this variable to hook processes (measured, `docs/LIVE-MATRIX.md`), so the notice shows only when the variable reaches the hook another way; `danger_guard` denies the same either way.
- Paths are compared after resolving symlinks and case on the existing part; a case or Unicode variant of a directory that does not exist yet is treated as different (a false ask, never a false pass).
- Claude Code has its own dangerous-`rm` prompt since 2.1.288, a second layer next to `danger_guard`: it asked before `rm -rf` of a `$(mktemp)` path under bypass (compat report for 2.1.287 to 2.1.289, item 2.1.288#54). From 2.1.311 the undocumented variable `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS` lifts that prompt in bypassPermissions (see `docs/CC-CONTACT-POINTS.md`), which leaves `danger_guard` as the only layer.
- Plugin hooks do not run on a machine that serves a cloud session as a self-hosted runner: Claude Code 2.1.288 added the message "This folder's hooks and plugin settings are not used while this computer serves a cloud session" (same compat report, `bin:2.1.288:cloud-folder-hooks-withheld`). A project-scoped install gives no guard there.

## Platforms

Tested by CI on Linux, macOS and Windows with Node 18, 20 and 22, and measured live on macOS with Claude Code 2.1.283 and 2.1.287. Windows is best-effort: the unit suite passes there, but no live Windows session has been measured.

Hooks run in Claude Code and Cowork; the claude.ai chat surface ignores hooks, so there only the two skills load.

## Network and data

- The hooks make no network requests and send nothing anywhere. See `PRIVACY.md`. The one exception is the worktree report you run yourself: it calls your installed `gh` to look up pull requests for worktree branches, and `--no-gh` turns that off. `gh` runs with only `PATH`, home, temp and gh config-directory variables.
- It does not read your conversation. With the default settings it never opens the session transcript; with `read_transcript` on it parses only the environment snapshot line (working directory and allowed directories) and the `/cd` record (the directory moved to), and keeps nothing else.
- It reads, on your machine: the hook event Claude Code passes on stdin, `permissions.additionalDirectories` and `autoMemoryDirectory` from Claude Code settings files, the `env` keys for Cyberine DevGuard's own options in the session repository's `.claude/settings.json`, `.claude/cyberine-devguard.json` files at or above the session directory, the command line of the running `claude` process (`/proc/<pid>/cmdline` or `ps`, only for `--add-dir`) and its start directory (`~/.claude/sessions/<pid>.json`), and git metadata through `git rev-parse`, `git check-ignore` and `git ls-files`. Git runs without a shell, with `GIT_*` variables removed and `core.fsmonitor` disabled.
- It writes only inside its plugin data directory (`~/.claude/plugins/data/<id>/`): `sessions/<session id>.json` (the directories added with `/add-dir` in that session, pruned after 7 days), `markers/` (empty files for `deny-once` mode and for `deny-once` answers under `bypassPermissions`, pruned after 10 minutes), `live/<hash of the session id>.json` (with `live_guard`: names of tmux sessions this session created and the times it launched each app in the last 60 minutes, pruned after 7 days) and, when `log_decisions` is on, `decisions.jsonl` (time, session id, tool, file path, verdict). Without a data directory, `deny-once` markers go to the system temp directory. Claude Code deletes the data directory when the plugin is uninstalled.
- It reads no credentials. From the environment it takes only these named variables, picked once at startup, and never sees the rest: `HOME`, `USERPROFILE`, `CLAUDE_CONFIG_DIR`, `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`, `CLAUDE_JOB_DIR`, `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`, `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS` (only to tell whether it is set) and its own `CLAUDE_PLUGIN_OPTION_*` settings. Git runs with only `PATH`, home, temp and locale variables.
- It changes no settings and stores no personal data beyond those file paths.

## Uninstall or migrate

- Uninstall: `claude plugin uninstall cyberine-worktree@cyberine-devguard` if installed, `claude plugin uninstall cyberine-devguard@cyberine-devguard` (add `--keep-data` to keep the decision log), then `claude plugin marketplace remove cyberine-devguard`.
- Disable for a while: `claude plugin disable cyberine-devguard@cyberine-devguard`, or set `mode` to `off`.
- Coming from a PreToolUse hook of your own that does the same job: install Cyberine DevGuard, confirm a crossing asks (`/cyberine-devguard:status <path in another repo>`), then remove your own hook entry from `settings.json`. While both are wired, Claude Code takes the stricter answer (measured: a second hook's deny beats Cyberine DevGuard's ask, `docs/LIVE-MATRIX.md`), so there is no unguarded window.

- Coming from a `WorktreeCreate` hook of your own: install `cyberine-worktree`, then remove your own `WorktreeCreate` entry from `settings.json` right away, since both run in parallel.

## Development

`npm test` runs the unit suite (real git repositories in temp dirs). `tests/live/matrix.sh`, `tests/live/failures.sh` and `tests/live/worktrees.sh` drive real `claude -p` sessions and spend model quota; `node tests/live/latency.mjs` measures per-call cost. Design decisions and their evidence are in `docs/DECISIONS.md`, the adversarial review in `docs/SECURITY-REVIEW.md`.

## License

MIT, see `LICENSE`. Security reports: see `SECURITY.md`.
