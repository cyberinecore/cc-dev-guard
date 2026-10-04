# Failure modes

What happens when devguard itself cannot run. Measured with `tests/live/failures.sh` on Claude Code 2.1.283 (headless, `bypassPermissions`, a Write into another repository, each case a modified copy of the plugin). "Blocked" means the write did not run.

| case | outcome | how it was observed |
|---|---|---|
| normal run | blocked (deny under bypassPermissions, ask otherwise) | debug log: `returned permissionDecision: deny` |
| engine module fails to load (syntax error, missing file under `scripts/lib/`) | blocked: the entry file catches the failed import and answers ask, or deny under bypassPermissions | debug log: `devguard failed to start (Unexpected token ';')`; unit test `tests/failure.test.mjs` |
| internal exception while deciding | blocked: ask, or deny under bypassPermissions, with the error in the reason | unit tests `tests/cli.test.mjs`, `tests/output.test.mjs` |
| unparseable hook input | blocked: ask | unit test `tests/cli.test.mjs` |
| `node` missing from PATH | FAILS OPEN: the write runs; the hook error goes only to the debug log | debug log: `Executable not found in $PATH`. The SessionStart hook runs `node` too, so the missing node surfaces at session start: stream-json shows `hook_response` for SessionStart with `outcome: error` and `Executable not found in $PATH: "node"`; node older than 18 prints a notice |
| `scripts/devguard.mjs` missing | FAILS OPEN | debug log: `Cannot find module` |
| `scripts/devguard.mjs` itself throws before any output | FAILS OPEN | debug log: hook error with the stack |
| hook prints something that is not JSON | FAILS OPEN, silently | nothing in the debug log |
| hook exits 2 | blocked | debug log: hook error with stderr |
| hook exceeds its timeout | FAILS OPEN | debug log: `timed out after 2000ms` (probe used a 2 s timeout) |
| Claude Code cannot evaluate the matcher, or cannot serialize the tool input to JSON (2.1.288 and later) | blocked by Claude Code before the hook runs; on 2.1.287 and earlier the hook was skipped and the call ran | not reproduced live: Claude Code 2.1.288 changelog ("the call is now blocked"), and the `hook_match_failed` string, absent from the 2.1.287 binary and present in 2.1.288 and 2.1.289 |

The same rows hold for the Bash hook and `danger_guard` (D34): an engine that fails to load answers ask, or deny under bypassPermissions, for every Bash call, so a broken install shows at once as every command being held; the fail-open rows let a data-destroying command run. Keep settings `deny` rules for commands you never want as a second layer outside bypassPermissions.

The fail-open rows are Claude Code's contract for a hook that cannot answer, not something the plugin can change from inside. devguard keeps them rare: the entry file is small and only imports the engine, the engine has no dependencies, and the timeout is 15 s against a measured p95 of about 120 ms per call (40 runs, Node 22, Apple M-series; `node tests/live/latency.mjs`). `tests/failure.test.mjs` fails if the p95 of eight real hook runs exceeds 3 s or the configured timeout drops below twice that budget.
