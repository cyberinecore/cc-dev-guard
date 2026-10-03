import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runHook } from "../scripts/lib/cli.mjs";
import { hookInput, isolatedEnv, scopeFixture } from "./helpers.mjs";

const decisionOf = (out) => out?.hookSpecificOutput?.permissionDecision ?? "passed";

function write(f, target, env, { session = "s1", mode = "bypassPermissions", tool = "Write" } = {}) {
  const raw = JSON.stringify(hookInput({ cwd: f.a, target, session, tool, extra: { permission_mode: mode } }));
  return runHook({ raw, env: { CLAUDE_PROJECT_DIR: f.a, ...env } });
}

test("under bypassPermissions a cross-repo write is held once and a retry passes", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const first = write(f, join(f.b, "x.md"), env);
  assert.equal(decisionOf(first), "deny");
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /^Default: NO\./);
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /Retry only if the user explicitly names that target this turn/);
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /bypassPermissions.*bypass_strict/);
  assert.equal(write(f, join(f.b, "x.md"), env), null, "the retry passes");
  assert.equal(write(f, join(f.b, "other.md"), env), null, "the same repository passes for the retry window");
  assert.equal(decisionOf(write(f, join(f.b, "x.md"), env, { session: "s2" })), "deny", "another session is held again");
});

test("bypass_strict keeps every cross-repo write denied under bypassPermissions", () => {
  const f = scopeFixture();
  const env = isolatedEnv({ CLAUDE_PLUGIN_OPTION_BYPASS_STRICT: "true" });
  for (let i = 0; i < 2; i++) {
    const out = write(f, join(f.b, "x.md"), env);
    assert.equal(decisionOf(out), "deny");
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /so cyberine-devguard denies instead/);
  }
});

test("a repository file can turn bypassStrict on but not off", () => {
  const f = scopeFixture();
  mkdirSync(join(f.a, ".claude"), { recursive: true });
  writeFileSync(join(f.a, ".claude", "cyberine-devguard.json"), JSON.stringify({ bypassStrict: true }));
  const env = isolatedEnv();
  assert.equal(decisionOf(write(f, join(f.b, "x.md"), env)), "deny");
  assert.equal(decisionOf(write(f, join(f.b, "x.md"), env)), "deny", "strict: the retry is denied too");
  writeFileSync(join(f.a, ".claude", "cyberine-devguard.json"), JSON.stringify({ bypassStrict: false }));
  const strict = isolatedEnv({ CLAUDE_PLUGIN_OPTION_BYPASS_STRICT: "true" });
  write(f, join(f.b, "y.md"), strict);
  const again = write(f, join(f.b, "y.md"), strict);
  assert.equal(decisionOf(again), "deny");
  assert.match(again.hookSpecificOutput.permissionDecisionReason, /bypassStrict false is ignored/);
});

test("guard files stay denied on every retry under bypassPermissions", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const target = join(f.a, ".claude", "cyberine-devguard.json");
  for (let i = 0; i < 2; i++) assert.equal(decisionOf(write(f, target, env)), "deny");
});

test("outside bypassPermissions a cross-repo write still asks every time", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  for (let i = 0; i < 2; i++) assert.equal(decisionOf(write(f, join(f.b, "x.md"), env, { mode: "acceptEdits" })), "ask");
});
