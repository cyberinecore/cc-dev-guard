import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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

test("check-node.sh is silent with node 18+ and warns without it", { skip: process.platform === "win32" }, () => {
  const script = join(root, "scripts", "check-node.sh");
  const ok = spawnSync("/bin/sh", [script], { env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }, encoding: "utf8" });
  assert.equal(ok.stdout, "");
  const bin = tempDir();
  const none = spawnSync("/bin/sh", [script], { env: { PATH: bin }, encoding: "utf8" });
  assert.match(JSON.parse(none.stdout).systemMessage, /node was not found/);
  mkdirSync(join(bin, "old"));
  writeFileSync(join(bin, "old", "node"), "#!/bin/sh\necho v16.20.0\n", { mode: 0o755 });
  const old = spawnSync("/bin/sh", [script], { env: { PATH: join(bin, "old") }, encoding: "utf8" });
  assert.match(JSON.parse(old.stdout).systemMessage, /v16\.20\.0 is older than 18/);
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
