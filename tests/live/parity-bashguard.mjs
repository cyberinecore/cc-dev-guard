import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWS, CASE_HOME, DENIES } from "../fixtures/bashguard-cases.mjs";

const goBin = process.argv[2];
if (!goBin) {
  console.error("usage: node tests/live/parity-bashguard.mjs <path to the nf-hooks binary>");
  process.exit(2);
}
const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "devguard.mjs");
const home = homedir();
const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "dgbashparity-")));
const env = { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: cwd };

const denies = (out) => {
  if (!out.trim()) return false;
  return JSON.parse(out).hookSpecificOutput?.permissionDecision === "deny";
};

const cases = [...DENIES.map((c) => [c, true]), ...ALLOWS.map((c) => [c, false])].map(([c, expected]) => [c.replaceAll(CASE_HOME, home), expected]);
let same = 0;
const rows = [];
for (const [command, expected] of cases) {
  const input = JSON.stringify({ session_id: `bashparity-${process.pid}`, cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, permission_mode: "bypassPermissions" });
  const go = denies(spawnSync(goBin, ["bash-guard"], { input, env, encoding: "utf8" }).stdout);
  const dg = denies(spawnSync(process.execPath, [entry, "hook"], { input, env, encoding: "utf8" }).stdout);
  if (go === dg) same += 1;
  const verdict = go !== dg ? "DIFFERENT" : go !== expected ? "both differ from the Go table" : "same";
  rows.push(`| \`${command.replaceAll("\n", "\\n").replaceAll(home, "~").replaceAll("|", "\\|")}\` | ${go ? "deny" : "pass"} | ${dg ? "deny" : "pass"} | ${verdict} |`);
}
console.log(`| command | Go bash-guard | devguard | verdict |\n|---|---|---|---|\n${rows.join("\n")}\n\n${same} of ${cases.length} cases agree.`);
process.exitCode = same === cases.length ? 0 : 1;
