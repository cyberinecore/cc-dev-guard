# Security policy

Cyberine DevGuard is a safety guard, so a way to make it allow a write it should have stopped is a security bug.

## Reporting

Report privately through GitHub's "Report a vulnerability" button on https://github.com/cyberinecore/cc-dev-guard/security, or by email to xinchao@nghia-pham.com. Please include the Claude Code version, the permission mode, the tool call (tool name and path) and what Cyberine DevGuard did. Do not open a public issue for a bypass until a fix is released.

## Scope

In scope: a Write, Edit or NotebookEdit into another repository that Cyberine DevGuard should have asked about and did not, a way for a repository to widen its own scope through `.claude/cyberine-devguard.json`, and any crash that makes the hook fail open where the README says it should ask.

Out of scope, documented as limits in the README: writes made through Bash or MCP tools, a missing `node`, a hook timeout, and a session forging its own transcript.
