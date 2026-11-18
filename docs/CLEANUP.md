# Cleanup after a batch run

What a session can remove after a run (worktrees, dev stacks, scratch, processes) without a stop, measured with the 0.21.1 hook under bypassPermissions on 2026-11-19. Cyberine DevGuard reads no resource manifest, registry, compose label or cleanup schema, and nothing records which session started which PID, port or worktree: a cleanup passes when each command has a shape the guard can judge.

## Passes as-is

- `git worktree remove .claude/worktrees/<name>` without --force, then `git worktree prune`. It stops only when ignored files outside the built-in list (node_modules, dist, build, .next, .vite, target, tmp...) would be lost; the stop then names folders to declare.
- `git branch -d <b>`. `git branch -D <b>` asks only when the branch holds commits no remote has.
- `docker compose [--profile x] down [--remove-orphans]` and `docker compose stop <svc>`, without -v. `docker stop $(docker ps -q)` also passes and stops every container on the daemon, other repositories' included: filter by your own label or project.
- `kill <pid> <pid>` with literal numbers, from any session. The guard cannot check who started a PID, so a later session can stop a stack an earlier one left: have the starter write PID, port and start command to a file under the repo's gitignored .local/, read it back, check `ps -o command= -p <pid>` still matches (PIDs get reused), then kill the literal PIDs.
- `rm -rf <relative path inside the repo>`, tmp dirs ($TMPDIR, /tmp, $CLAUDE_JOB_DIR/tmp, <repo>/tmp), and `D=$(mktemp -d) ... rm -rf $D` in the same command.
- Repo scripts (`bun <script>`, `bash <script>`): devguard does not read script bodies. That is a limit of the guard, not an allowance, so the script must enforce its own scope (exact compose project names, no bare `docker volume prune`).

## Denied in every mode, owner only

- `docker compose down -v`, `docker volume rm/prune`, `docker system prune`, `git worktree remove --force`, `git clean -f`.
- pkill/killall, kill by port (`lsof -ti:PORT | xargs kill`), and `tmux kill-session` on a session this one did not create.
- An absolute `rm -rf` inside the repo, unless the path is ignored and declared (see below).

## Declarations that exist

- `CYBERINE_DEVGUARD_REGENERABLE_PATHS` in the env block of the repo's gitignored, untracked `.claude/settings.local.json`. Paths are relative to the repo root and comma-separated; `*` matches inside one folder name, and `**` is rejected. It covers only ignored, untracked paths inside the repo with no nested .git, and applies to absolute `rm -rf` and to `git worktree remove`. A session may write the key only when the owner's prompt in the same turn names the key or the file.
- `allow_commands` exact-command entries, set by the owner only, in /config under the cyberine-devguard options. It applies in every repo. Avoid trailing-* prefixes: they let `..` and extra targets through.

## Recurring command

`/cyberine-devguard:worktrees` reports stray, prunable and merged worktrees and prints the `git worktree prune` / `git worktree remove` commands. It changes nothing. There is no apply sweep and no stack sweep, so the repo ships its own script.
