# Cyberine Worktree

A `WorktreeCreate` hook for Claude Code that puts every worktree Claude Code creates in one predictable place: `<main repository>/.claude/worktrees/<name>`, on branch `worktree/<name>`, based on the spawning session's `HEAD`.

## What it does

- Creates the worktree for the Agent tool's `isolation: "worktree"`, for `EnterWorktree`, and, on Claude Code 2.1.311 and later, for `claude --worktree <name>` at launch. It runs `git worktree add --no-track -B worktree/<name>` and prints the new path, which is what Claude Code expects from a `WorktreeCreate` hook.
- Resolves the main repository even from inside a linked worktree, so a subagent spawned from a worktree lands beside it, not inside it. A submodule session keeps its worktrees under the submodule.
- Running it again for a worktree that already exists prints the existing path instead of creating a second one.
- At session start it reads your Claude Code settings files and warns when another `WorktreeCreate` hook is configured, because Claude Code runs every such hook in parallel and a second one that picks a different path leaves an orphan worktree.

While it is installed, Claude Code hands worktree creation entirely to this hook, so `worktreeBaseRef` and the built-in `worktree-<name>` branch naming no longer apply.

## Install

```bash
claude plugin marketplace add cyberinecore/cc-dev-guard
claude plugin install cyberine-worktree@cyberine-devguard
```

Remove any `WorktreeCreate` hook of your own from `settings.json` first. Uninstall with `claude plugin uninstall cyberine-worktree@cyberine-devguard`.

## Privacy

The hooks run only `git` and Node.js built-ins on your machine. They make no network requests, keep no records of their own, and send nothing anywhere.

## Troubleshooting

If a worktree lands somewhere else, check the session-start warning for a second `WorktreeCreate` hook. If creation fails, the hook reports the error to Claude Code; run the same `git worktree add` in a terminal to see it. Design notes and measurements live in the companion repository's `docs/DECISIONS.md` (D26) and `docs/LIVE-MATRIX.md`.

## License

MIT. Part of [cyberinecore/cc-dev-guard](https://github.com/cyberinecore/cc-dev-guard), next to the Cyberine DevGuard plugin.
