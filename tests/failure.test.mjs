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

test("session-start is silent on node 18+ and warns on older node", () => {
  const r = spawnSync(process.execPath, [entry, "session-start"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(sessionStart("22.1.0"), null);
  assert.equal(sessionStart("18.0.0"), null);
  assert.match(sessionStart("16.20.2").systemMessage, /16\.20\.2 is older than 18/);
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
