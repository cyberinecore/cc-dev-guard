# Live probe matrix

Headless `claude -p` runs of this plugin (`--plugin-dir .`) in throwaway git repos `a` (session) and `b` (other), produced by `tests/live/matrix.sh`. "target written" is whether the file exists afterwards. Temp paths are shown as `<tmp>`.

2.1.283 (Claude Code), model haiku, 2026-09-27T18:00Z

| row | claude args | target written | first devguard message in a tool result |
|---|---|---|---|
| same-repo | --permission-mode acceptEdits | yes | (no devguard message) |
| other-repo-ask-acceptEdits | --permission-mode acceptEdits | no | devguard: `<tmp>` is in another repository (`<tmp> |
| other-repo-ask-bypass | --dangerously-skip-permissions | no | devguard: `<tmp>` is in another repository (`<tmp> devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |
| other-repo-ask-allowedTools | --allowedTools Write | no | devguard: `<tmp>` is in another repository (`<tmp> |
| other-repo-deny-once-retry | --dangerously-skip-permissions | yes | Default: NO. `<tmp>` is outside this session's repository `<tmp> devguard deny-once: a retry within 10 minutes passes.) |
| other-repo-warn | --dangerously-skip-permissions | yes | (no devguard message) |
| other-repo-off | --dangerously-skip-permissions | yes | (no devguard message) |
| add-dir-target | --permission-mode acceptEdits --add-dir <tmp> | yes | (no devguard message) |
| add-dir-target-bypass | --dangerously-skip-permissions --add-dir <tmp> | yes | (no devguard message) |
| settings-additional-dir-bypass | --dangerously-skip-permissions | yes | (no devguard message) |
| add-dir-via-transcript-bypass | --dangerously-skip-permissions --add-dir <tmp> | yes | (no devguard message) |
| gitignored-target | --dangerously-skip-permissions | yes | (no devguard message) |
| relative-other-repo | --dangerously-skip-permissions | no | devguard: `<tmp>` is in another repository (`<tmp> devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |
| subagent-other-repo | --dangerously-skip-permissions | no | devguard: `<tmp>` is in another repository (`<tmp> devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |
| worktree-into-main | --dangerously-skip-permissions | yes | (no devguard message) |
| config-file-same-repo | --dangerously-skip-permissions | no | devguard: `<tmp>` is a devguard configuration file, and a chan devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |
| config-file-acceptEdits | --permission-mode acceptEdits | no | (no devguard message) |
| other-repo-dot-claude-bypass | --dangerously-skip-permissions | no | devguard: `<tmp>` is in another repository (`<tmp> devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |
| other-repo-dot-git-bypass | --dangerously-skip-permissions | no | devguard: `<tmp>` is in another repository (`<tmp> devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |


The `add-dir-*` and `settings-additional-dir-*` rows pass through devguard's default sources (`--add-dir` from the process command line, `permissions.additionalDirectories` from `.claude/settings.local.json`) without opening the transcript; `add-dir-via-transcript-bypass` passes through the opt-in snapshot.

Before the bypass fix (first run, same day), an `ask` under `bypassPermissions` for a path Claude Code treats as a safety-check path (`.claude/`, `.git/`, `.vscode/`, a dotfile) was routed into the permission pipeline ("hookAskFloor" in the debug log) and the write ran. The same paths stayed blocked under `default`, `acceptEdits`, `auto` and `dontAsk`. devguard therefore answers `deny` instead of `ask` when the hook input says `permission_mode: bypassPermissions`.

Re-run on 2.1.287 (Claude Code), model haiku, 2026-10-01T18:50Z: every row's "target written" matched the table above. The same day a copy of the plugin with the bypass conversion removed answered a raw `ask` under `--dangerously-skip-permissions` for a Write into repository `b`: `.claude/x.md`, `.git/x.sample` and `.vscode/x.json` were written, `plain.txt` and `.dotfile` were not. A second run wrote `.bashrc`, `.gitmodules`, `.mcp.json`, `.ripgreprc`, `.idea/x.xml`, `.husky/pre-commit` and `.devcontainer/x.json`, and held `.env` and `.gitignore`: the safety-check path is a fixed list of names in the 2.1.287 binary (folders `.git`, `.vscode`, `.idea`, `.claude`, `.husky`, `.cargo`, `.devcontainer`, `.yarn`, `.mvn`; files `.gitconfig`, `.gitmodules`, `.bashrc`, `.bash_profile`, `.zshrc`, `.zprofile`, `.profile`, `.ripgreprc`, `.mcp.json`), not every dotfile. The deny conversion is still needed on 2.1.287.

Re-run on 2.1.289 (Claude Code), model haiku, 2026-10-04T08:25Z, `tests/live/matrix.sh`: all 20 rows' "target written" matched the table above.

Two hooks answering the same write (measured the same day, `acceptEdits`): devguard answered `ask` and a second test plugin answered `deny`; the tool result was the deny and the write did not run.

## Worktree rows

`tests/live/worktrees.sh`: headless `claude -p --setting-sources project` runs in throwaway repositories (`plain`, a submodule `outer/sub`, and `nest` with a linked worktree `nest/.claude/worktrees/parent`). Rows with cyberine-worktree load `--plugin-dir plugins/cyberine-worktree`; Bash rows load devguard. The result column lists the linked worktrees after the run as `path [branch]`.

2.1.287 (Claude Code), model haiku, 2026-10-02T03:28Z

| row | setup | result |
|---|---|---|
| cli-w-plain | `-w probe` in plain, cyberine-worktree | `plain/.claude/worktrees/probe [worktree-probe]`: built-in creation, the plugin hook did not run at launch |
| cli-w-submodule | `-w subprobe` in outer/sub, cyberine-worktree | `outer/sub/.claude/worktrees/subprobe [worktree-subprobe]`: built-in creation, as above |
| agent-isolation | Agent `isolation: "worktree"` in plain, cyberine-worktree | `plain/.claude/worktrees/agent-<id> [worktree/agent-<id>]` |
| agent-isolation-nested | Agent `isolation: "worktree"` from `nest/.claude/worktrees/parent`, cyberine-worktree | `nest/.claude/worktrees/agent-<id> [worktree/agent-<id>]` beside `parent`, not inside it |
| enter-worktree | `EnterWorktree name=entered` in plain, cyberine-worktree | `plain/.claude/worktrees/entered [worktree/entered]` |
| bash-tmp-control | `git worktree add <fixture>/tmp-control`, no plugin (positive control) | `tmp-control [tmp-control]`: created |
| bash-tmp | `git worktree add /tmp/...`, devguard, bypass | none; tool result "cyberine-devguard: this command runs `git worktree add` for `/tmp/...`, outside `.../plain/.claude/worktrees`" |
| bash-sibling | `git -C plain worktree add ../sibling`, devguard, bypass | none; same reason for `<fixture>/sibling` |
| bash-inside | `git worktree add .claude/worktrees/ok`, devguard, bypass | `plain/.claude/worktrees/ok [ok]`: passes |
| bash-tmp-acceptEdits | `git worktree add <fixture>/tmp-ae`, devguard, `acceptEdits` and `--allowedTools "Bash(git worktree add:*)"` | none; the ask held although the command was pre-allowed |

A plugin `WorktreeCreate` hook is not loaded yet when `claude --worktree` creates its worktree at launch; a hook in `--settings` is (measured the same day by the owner's `~/.claude` session, which also measured that two `WorktreeCreate` hooks run in parallel and that an empty stdout fails creation). A first run of the Bash rows the same day is discarded: the prompt ended in "CMD ." and the model passed the dot to git as a commit-ish.

## Bash, MCP and worktree-isolation rows

`tests/live/bash-mcp.sh`: throwaway repositories `a` (session, with a linked worktree `a/.claude/worktrees/w`) and `b` (other). The MCP rows run `@modelcontextprotocol/server-filesystem` through `npx` with `--mcp-config`. The reason column is cut.

2.1.287 (Claude Code), model haiku, 2026-10-02T18:55Z

| row | setup | target written | first devguard message |
|---|---|---|---|
| bash-redirect-control | `echo x > b/ctl.txt`, no plugin (positive control) | yes | (no devguard message) |
| bash-redirect | redirect into b, devguard, bypass | no | cyberine-devguard: `<fx>/b/r.txt` (written by a Bash redirect) ... denies instead |
| bash-cp-acceptEdits | `cp a/s.txt b/`, devguard, `acceptEdits` and `--allowedTools Bash` | no | cyberine-devguard: `<fx>/b` (written by a Bash cp) is in another repository |
| bash-same-repo | redirect inside a, devguard, bypass | yes | (no devguard message) |
| bash-guard-off | redirect into b, `bash_guard=false` | yes on the first run (18:52Z); no on this run, where the model made no tool call | (no devguard message) |
| mcp-control | MCP `write_file` into b, no plugin, `--add-dir b` (positive control) | yes | (no devguard message) |
| mcp-write | MCP `write_file` into b, devguard, bypass | no | cyberine-devguard: `<fx>/b/m.txt` is in another repository ... denies instead |
| isolate-on | Write from worktree w into main checkout a, `isolate_worktrees=true` | no | cyberine-devguard: `<fx>/a/from-wt.txt` is in another worktree ... |
| isolate-off | the same, default options | yes | (no devguard message) |
| wt-dup-warning | cyberine-worktree with a second `WorktreeCreate` hook in project settings | - | SessionStart `hook_response` carries "cyberine-worktree: another WorktreeCreate hook is configured (`/opt/other-wt.sh` in ...)" |

Without `--add-dir b`, the filesystem server itself refused the control write ("Access denied - path outside allowed directories"): Claude Code hands the server its session directories as roots, so the server's own limit already covered that case. The devguard row shows the hook answering before the server is called.

Danger guard (D34), 2.1.287, model haiku, 2026-10-03, `--setting-sources project,local` so no other hook reads Bash: under `--dangerously-skip-permissions` a request to run `git reset --hard HEAD` in a temp repository holding an uncommitted change was denied with the danger reason and the change survived; the same run started with the escape variable set to `1` ran the command and the change was gone. Measured with `CYBERINE_DEVGUARD_ALLOW_DANGER` on 0.4.0 and again with its 0.4.1 name `CY_ALLOW_DANGER`, same outcome.

Bypass retry (D35), 0.5.0, 2.1.287, model haiku, 2026-10-03, `--dangerously-skip-permissions`, session repository `a`, target in repository `b`: a prompt in which the user explicitly asked for `b/asked.txt` made two Write calls, the first denied with the deny-once reason and the retry passing, and the file was written; a prompt that said not to retry after a refusal made one Write call, which was denied, and `b/notasked.txt` was not written.

## `/cd` rows

2.1.289 (Claude Code), model haiku, 2026-10-04, interactive session driven through tmux (`/cd` is a local-jsx command and does not run under `-p`), a probe plugin plus a `--settings` file logging every hook input. Session started in this repository, then `/cd` into a throwaway git repository `b` after answering "Yes, move here" to the trust prompt.

| row | observed |
|---|---|
| hook input `cwd` after `/cd` | `b` |
| `CLAUDE_PROJECT_DIR` in the hook environment after `/cd` | the launch directory, unchanged (README "After `/cd`" limit) |
| `CwdChanged` on `/cd`, declared by a plugin or by settings | not fired |
| `CwdChanged` on a Bash `cd /tmp && pwd` | not fired |
| `UserPromptSubmit` / `UserPromptExpansion` on `/cd` | not fired; the next typed prompt fires `UserPromptSubmit` with `cwd` `b` |
| Write into `b` after `/cd` | devguard asks (`explain`: `cross (cross-repo) -> asks`) |
| transcript after `/cd` | a new file under the projects folder of `b`, first line `{"type":"relocated","relocatedCwd":"b",...}`, then a `system` / `local_command` record with `commandRun.command` `cd` |

No hook tells a plugin that the user moved the session, so a user who works in `b` after `/cd` is asked on every write there; `/add-dir b` is the supported way to work in a second repository.

Confirmed with this plugin the same day in an interactive tmux session (`--plugin-dir .`, `--setting-sources project,local`, `--dangerously-skip-permissions`, session in `a`): after `/cd` into a fresh repository `c`, a Write to `c/z.txt` was held with "Default: NO. ... is outside this session's repository `a`", and nothing was written. Claude Code 2.1.289 prints a PreToolUse deny in the transcript as `PreToolUse:Write hook error: <reason>`. In the default permission mode the interactive dialog for a cross-repository Write showed Claude Code's own "Do you want to create x.txt?" choices with no devguard reason on screen; Claude Code also asks there on its own for a path outside the working directory, so that run does not separate devguard's ask from Claude Code's.
