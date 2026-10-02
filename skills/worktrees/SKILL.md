---
name: worktrees
description: This skill should be used when the user asks to audit git worktrees with devguard - "/cyberine-devguard:worktrees", "devguard worktrees", "list stray worktrees", "which worktrees can I clean up", "worktree nao da merge", "kiem tra worktree rac". Reports, per repository, worktrees whose directory is gone, worktrees outside .claude/worktrees/, and worktrees whose branch is merged. Deletes nothing.
disable-model-invocation: true
user-invocable: true
---

# Cyberine DevGuard worktree report

Report only: this skill never removes a worktree, prunes a record or deletes a branch.

1. Directory: the one the user named, else the session root (the primary working directory in your environment details). A directory that is not inside a git repository is searched up to three levels deep for repositories.
2. Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/devguard.mjs" worktrees "<directory>"
```

Add `--no-gh` when the user does not want GitHub queried. With `gh` available, each worktree branch is looked up with `gh pr view <branch> --json state,mergedAt,number` under the active `gh` account; without it, a branch counts as merged only when the default branch already contains it, which misses squash merges.

3. Report the output as it is, grouped by repository: prunable or missing directories, worktrees outside `.claude/worktrees/`, merged branches, and any `gh` failure line.
4. Offer the cleanup commands the report names (`git worktree prune`, `git worktree remove <path>`), and run one only when the user asks for that worktree by name this turn. Check `git -C <path> status --short` first: a worktree with uncommitted work is never removed with `--force` on your own initiative.
