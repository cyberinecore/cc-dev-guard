# Claude Code contact points

Every place where this plugin depends on Claude Code behaviour. `cc-plugin-compat` judges each Claude Code release against this list, so add a row whenever the plugin starts using a new hook, output key, manifest key, component or loading rule. Plugins cannot declare a minimum Claude Code version, so "Needs CC" records the first version a feature needs, as the docs state it; blank means not established.

| Contact point | Where in this repo | Needs CC | Breaks if Claude Code changes |
|---|---|---|---|
| hooks.json shape: top-level `"hooks"` wrapper | hooks/hooks.json, plugins/cyberine-worktree/hooks/hooks.json | | the plugin's hooks stop loading |
| Exec form `command: "node"` + `args`, `timeout` | both hooks.json | 2.1.139 | the hook fails to spawn |
| `${CLAUDE_PLUGIN_ROOT}` substitution inside `args` | both hooks.json | 2.1.139 | the script is not found; the engine never runs |
| `CLAUDE_PLUGIN_DATA` env (records of /add-dir, deny-once state) | scripts/lib/sources.mjs, scripts/lib/output.mjs | | records lost; deny-once and /add-dir allowances break |
| PreToolUse matcher `Write\|Edit\|NotebookEdit` (regex alternation, exact names) | hooks/hooks.json | | file writes go unguarded |
| PreToolUse matcher `Bash` | hooks/hooks.json | | danger_guard, bash_guard and worktree_guard stop firing |
| PreToolUse matcher `mcp__.*__(write_file\|edit_file\|create_directory\|move_file)` (regex over MCP tool names) | hooks/hooks.json | | filesystem MCP writes go unguarded |
| SessionStart hook (node check, record pruning; the worktree plugin warns on other WorktreeCreate hooks) | both hooks.json, plugins/cyberine-worktree/scripts/session-start.mjs | | warnings vanish; stale records pile up |
| DirectoryAdded hook, input `directory` | hooks/hooks.json, scripts/lib/sources.mjs | | /add-dir is no longer recorded; allowed directories get asked |
| WorktreeCreate hook, input `name`, `worktree_path`, `git_ref`, `cwd`; stdout is the worktree path | plugins/cyberine-worktree/ | | agent and EnterWorktree worktree creation fails or lands elsewhere |
| PreToolUse input `tool_name`, `tool_input` (`file_path`, `notebook_path`, `command`, MCP `path`, `edits`, `dryRun`, `source`, `destination`) | scripts/lib/decide.mjs, scripts/lib/bashguard.mjs, scripts/lib/mcpfs.mjs | | the target path is not seen; the guard passes or asks wrongly |
| Hook input `cwd`, `session_id`, `permission_mode`, `transcript_path`, `scratchpad_dir` | scripts/devguard.mjs, scripts/lib/allowances.mjs, scripts/lib/output.mjs | | wrong session root, wrong bypass handling, scratchpad writes asked |
| Output `hookSpecificOutput.permissionDecision` ask/deny with `permissionDecisionReason`; `systemMessage` | scripts/lib/output.mjs, scripts/devguard.mjs | | the decision is ignored or reinterpreted |
| Harness behaviour: ask is not honoured under bypassPermissions, so ask is sent as deny | scripts/lib/output.mjs, docs/LIVE-MATRIX.md | | if Claude Code starts honouring ask under bypass, deny becomes over-strict |
| `CLAUDE_PROJECT_DIR` stays on the launch directory after a Bash `cd` and after `/cd` (D12) | scripts/lib/decide.mjs `sessionRootOf` | | the session repository moves with the working directory |
| `/cd` fires no hook (`CwdChanged`, `UserPromptSubmit`, `UserPromptExpansion` all silent, 2.1.289); the transcript moves to the new project folder and starts with a `relocated` record | README Limits, docs/LIVE-MATRIX.md `/cd` rows | | a new event would let devguard follow a user's `/cd` |
| Env `CLAUDE_PROJECT_DIR`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CONFIG_DIR`, `CLAUDE_PID`, `CLAUDE_JOB_DIR`, `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` | scripts/lib/*.mjs | | session root, records or Claude Code's own folders resolve wrong |
| Claude Code's own folders: `<config>/plans`, `<config>/projects/<slug>/memory` layout | scripts/lib/allowances.mjs | | memory and plan writes get asked |
| Settings `permissions.additionalDirectories` (user, project, local, managed paths) | scripts/lib/sources.mjs | | allowed directories are missed |
| `claude` process argv `--add-dir` (exact argv, or `ps` on macOS) | scripts/lib/sources.mjs | | --add-dir directories are missed |
| Transcript JSONL shape (opt-in `read_transcript`) | scripts/lib/transcript.mjs | | removed directories are not detected |
| Skills `help`, `status`, `worktrees` (`disable-model-invocation`, `user-invocable`, namespaced `cyberine-devguard:<name>`) | skills/*/SKILL.md | | the skill is not listed or not invocable |
| `userConfig` fields (string, boolean, `multiple: true` string list), `CLAUDE_PLUGIN_OPTION_*` | .claude-plugin/plugin.json, scripts/lib/config.mjs | | an option is refused or unset |
| Manifest keys (`displayName`, `privacyPolicyUrl`, `$schema`, `keywords`) | both plugin.json | | install, listing or strict validation fails |
| Marketplace entries, `source` `./` and `./plugins/cyberine-worktree`, `category` | .claude-plugin/marketplace.json | | install fails |

Last verified: 2.1.289 (Claude Code), 2026-10-04 (`/cd` rows only; full release check pending)
