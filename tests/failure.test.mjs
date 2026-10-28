import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sessionStart } from "../scripts/lib/cli.mjs";
import { hookInput, isolatedEnv, scopeFixture, tempDir } from "./helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "scripts", "devguard.mjs");
const LATENCY_BUDGET_MS = 3000;

function copyWithBrokenEngine() {
  const dir = tempDir();
  cpSync(join(root, "scripts"), join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "lib", "cli.mjs"), "export const main = ;\n");
  return join(dir, "scripts", "devguard.mjs");
}

test("an engine that fails to load still answers ask, or deny under bypassPermissions", () => {
  const broken = copyWithBrokenEngine();
  for (const [mode, want] of [["default", "ask"], ["bypassPermissions", "deny"]]) {
    const r = spawnSync(process.execPath, [broken, "hook"], { input: JSON.stringify({ permission_mode: mode }), encoding: "utf8" });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, want);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /failed to start/);
  }
});

test("session-start hands over the danger hint on node 18+, is silent with the hint off, and warns on older node", () => {
  const r = spawnSync(process.execPath, [entry, "session-start"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /^cyberine-devguard denies/);
  const off = spawnSync(process.execPath, [entry, "session-start"], { encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_OPTION_SESSION_HINT: "false" } });
  assert.equal(off.status, 0);
  assert.equal(off.stdout, "");
  assert.equal(sessionStart("22.1.0"), null);
  assert.equal(sessionStart("18.0.0"), null);
  assert.match(sessionStart("16.20.2").systemMessage, /16\.20\.2 is older than 18/);
  assert.match(sessionStart("16.20.2", { dangerGuard: true, sessionHint: true }).systemMessage, /older than 18/);
  const hint = sessionStart("22.1.0", { dangerGuard: true, sessionHint: true });
  assert.equal(hint.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(hint.hookSpecificOutput.additionalContext, /^cyberine-devguard denies data-destroying Bash commands/);
  assert.ok(hint.hookSpecificOutput.additionalContext.length < 800);
  assert.equal(sessionStart("22.1.0", { dangerGuard: true, sessionHint: false }), null);
  assert.equal(sessionStart("22.1.0", { dangerGuard: false, sessionHint: true }), null);
});

test("session-start says the dangerous-rm prompt is off only when the variable is set and danger_guard is on", () => {
  const on = { dangerGuard: true, sessionHint: true };
  const name = "CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS";
  const text = (cfg, env) => sessionStart("22.1.0", cfg, env)?.hookSpecificOutput.additionalContext || "";
  assert.doesNotMatch(text(on, {}), new RegExp(name));
  assert.doesNotMatch(text(on, { [name]: "" }), new RegExp(name));
  assert.match(text(on, { [name]: "1" }), new RegExp(`${name} is set, so Claude Code's own prompt before a dangerous rm is off`));
  assert.match(text(on, { [name]: "1" }), /^cyberine-devguard denies data-destroying/);
  assert.equal(sessionStart("22.1.0", { dangerGuard: false, sessionHint: true }, { [name]: "1" }), null);
  assert.equal(sessionStart("22.1.0", { dangerGuard: true, sessionHint: false }, { [name]: "1" }), null);
  const r = spawnSync(process.execPath, [entry, "session-start"], { encoding: "utf8", env: { ...process.env, [name]: "1" } });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, new RegExp(name));
  const unset = { ...process.env };
  delete unset[name];
  const u = spawnSync(process.execPath, [entry, "session-start"], { encoding: "utf8", env: unset });
  assert.doesNotMatch(JSON.parse(u.stdout).hookSpecificOutput.additionalContext, new RegExp(name));
});

test("the hook stays well inside its configured timeout", () => {
  const f = scopeFixture();
  const timeoutMs = JSON.parse(readFileSync(join(root, "hooks", "hooks.json"), "utf8")).hooks.PreToolUse[0].hooks[0].timeout * 1000;
  const input = JSON.stringify(hookInput({ cwd: f.a, target: join(f.b, "x.md") }));
  const times = [];
  for (let i = 0; i < 8; i++) {
    const t = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [entry, "hook"], { input, env: { PATH: process.env.PATH, ...isolatedEnv({ CLAUDE_PROJECT_DIR: f.a }) }, encoding: "utf8" });
    times.push(Number(process.hrtime.bigint() - t) / 1e6);
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "ask");
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95) - 1] ?? times[times.length - 1];
  assert.ok(p95 < LATENCY_BUDGET_MS, `p95 ${p95.toFixed(0)} ms exceeds the ${LATENCY_BUDGET_MS} ms budget`);
  assert.ok(timeoutMs >= 2 * LATENCY_BUDGET_MS, `hook timeout ${timeoutMs} ms is tighter than twice the latency budget`);
});
