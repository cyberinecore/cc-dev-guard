---
name: status
description: This skill should be used when the user asks what devguard allows in this session or why a write was stopped - "/devguard:status", "devguard status", "why did devguard ask", "is this path allowed", "tai sao devguard hoi", "path nay co duoc ghi khong", "which repos can this session write to". Prints the session repository, the allowed directories, the effective configuration, and the verdict for a path when one is given.
disable-model-invocation: true
user-invocable: true
---

# devguard status

Read-only: this skill never changes configuration and never writes files.

1. Session root: the directory this session was started in (the primary working directory in your environment details), not the directory a `cd` left you in.
2. Without a path, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/devguard.mjs" status --root "<session root>"
```

3. With a path (the user named one, or asked about the last write devguard stopped), run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/devguard.mjs" explain "<path>" --root "<session root>" --cwd "<current directory>"
```

4. Report the output as it is: session repository, allowed directories with where each came from, mode, repository config file and any warnings, then the verdict line. `pass (<reason>)` means the write goes through without devguard; `cross (...)` names what devguard does in the current mode.
5. If the user wants a directory allowed, point to the fixes that stay with them: `/add-dir <dir>` for this session, `--add-dir` at launch, `permissions.additionalDirectories` in settings, or the `extra_allowed_dirs` plugin option in `/config`. Do not edit their settings or `.claude/devguard.json` yourself unless they ask; devguard asks before any write to `.claude/devguard.json`.
