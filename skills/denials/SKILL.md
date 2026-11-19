---
name: denials
description: This skill should be used when the user asks what devguard has been stopping, how often, or how to stop being blocked - "/cyberine-devguard:denials", "devguard denials", "what did devguard block", "why does devguard keep blocking cleanup", "devguard chan gi", "devguard chan bao nhieu lan", "lam sao de devguard khong chan nua". Summarises the stops recorded in decisions.jsonl by repository and kind, with the declaration that would let each through.
disable-model-invocation: true
user-invocable: true
---

# Cyberine DevGuard denials

Read-only: this skill never changes configuration and never writes files.

1. Run, adding `--days <N>` when the user names a period (default 30, the retention of the log):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/devguard.mjs" denials
```

2. Report the output as it is: per repository, each kind of stop with its count and verdict, then the `fix:` lines (a declaration taken from the reason shown at the time) or the `route:` line (the general way through).
3. A `fix:` that names `CYBERINE_DEVGUARD_REGENERABLE_PATHS` is a value for the repository's gitignored `.claude/settings.local.json`. Write it only if the user's prompt in this turn names that key or file; otherwise give the user the line to paste. Options in `/config`, including `allow_commands` and `regenerable_paths`, are the user's to set: never edit them yourself.
4. If the output says logging is off, tell the user that `log_decisions` in `/config` takes `off`, `stops` (the default: danger_guard, live_guard and internal-error stops) or `all` (also every write into another repository).
