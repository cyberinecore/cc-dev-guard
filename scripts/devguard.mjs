#!/usr/bin/env node
import { readFileSync } from "node:fs";

function startupFailure(error) {
  let mode = "";
  try {
    mode = JSON.parse(readFileSync(0, "utf8"))?.permission_mode || "";
  } catch {}
  const reason = `devguard failed to start (${error && error.message ? error.message : error}), so it could not check whether this write stays inside the session's scope. Approve only if you expected this write.`;
  const permissionDecision = mode === "bypassPermissions" ? "deny" : "ask";
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason: reason } }) + "\n");
}

try {
  const { main } = await import("./lib/cli.mjs");
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (process.argv[2] === "hook") startupFailure(e);
  else {
    process.stderr.write(`devguard: ${e && e.stack ? e.stack : e}\n`);
    process.exitCode = 1;
  }
}
