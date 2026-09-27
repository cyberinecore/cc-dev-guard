# Live probe matrix

Headless `claude -p` runs of this plugin (`--plugin-dir .`) in throwaway git repos `a` (session) and `b` (other), produced by `tests/live/matrix.sh`. "target written" is whether the file exists afterwards. Temp path prefixes are trimmed.

2.1.283 (Claude Code), model haiku, 2026-09-27T17:26Z

| row | claude args | target written | first devguard message in a tool result |
|---|---|---|---|
| same-repo | --permission-mode acceptEdits | yes | (no devguard message) |
| other-repo-ask-acceptEdits | --permission-mode acceptEdits | no | devguard: `b/x.txt` is in another repository (`<tmp> |
| other-repo-ask-bypass | --dangerously-skip-permissions | no | devguard: `b/x.txt` is in another repository (`<tmp> devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |
| other-repo-ask-allowedTools | --allowedTools Write | no | devguard: `b/x.txt` is in another repository (`<tmp> |
| other-repo-deny-once-retry | --dangerously-skip-permissions | yes | Default: NO. `b/x.txt` is outside this session's repository `<tmp> devguard deny-once: a retry within 10 minutes passes.) |
| other-repo-warn | --dangerously-skip-permissions | yes | (no devguard message) |
| other-repo-off | --dangerously-skip-permissions | yes | (no devguard message) |
| add-dir-target | --permission-mode acceptEdits --add-dir b/sub | yes | (no devguard message) |
| gitignored-target | --dangerously-skip-permissions | yes | (no devguard message) |
| relative-other-repo | --dangerously-skip-permissions | no | devguard: `b/rel.txt` is in another repository (`<tmp> devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |
| subagent-other-repo | --dangerously-skip-permissions | no | devguard: `b/sub-agent.txt` is in another repository (`<tmp> devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |
| worktree-into-main | --dangerously-skip-permissions | yes | (no devguard message) |
| config-file-same-repo | --dangerously-skip-permissions | no | devguard: `a/.claude/devguard.json` is a devguard configuration file, and a chan devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |
| config-file-acceptEdits | --permission-mode acceptEdits | no | (no devguard message) |
| other-repo-dot-claude-bypass | --dangerously-skip-permissions | no | devguard: `b/.claude/x.md` is in another repository (`<tmp> devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |
| other-repo-dot-git-bypass | --dangerously-skip-permissions | no | devguard: `b/.git/x.sample` is in another repository (`<tmp> devguard denies instead. To allow it, add the directory to the session with /add-dir, or let the user make the change. |


Before the bypass fix (first run, same day), an `ask` under `bypassPermissions` for a path Claude Code treats as a safety-check path (`.claude/`, `.git/`, `.vscode/`, a dotfile) was routed into the permission pipeline ("hookAskFloor" in the debug log) and the write ran. The same paths stayed blocked under `default`, `acceptEdits`, `auto` and `dontAsk`. devguard therefore answers `deny` instead of `ask` when the hook input says `permission_mode: bypassPermissions`.

Two hooks answering the same write (measured the same day, `acceptEdits`): devguard answered `ask` and a second test plugin answered `deny`; the tool result was the deny and the write did not run.
