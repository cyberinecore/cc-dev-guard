import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LIVE_HINT, runHook, SESSION_HINT, sessionStart } from "../scripts/lib/cli.mjs";
import { loadConfig } from "../scripts/lib/config.mjs";
import { gitInit, isolatedEnv, tempDir } from "./helpers.mjs";

function session() {
  const a = join(tempDir(), "a");
  gitInit(a);
  return a;
}

function withData(env) {
  return { CLAUDE_PLUGIN_DATA: join(tempDir(), "data"), ...env };
}

function bash(a, command, env, { mode = "default", sid = "s1", now } = {}) {
  const raw = JSON.stringify({ session_id: sid, cwd: a, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, permission_mode: mode });
  return runHook({ raw, env: { CLAUDE_PROJECT_DIR: a, ...env }, now });
}

function write(a, file, env, mode = "default") {
  const raw = JSON.stringify({ session_id: "s1", cwd: a, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "x" }, permission_mode: mode });
  return runHook({ raw, env: { CLAUDE_PROJECT_DIR: a, ...env } });
}

const decisionOf = (out) => out?.hookSpecificOutput?.permissionDecision ?? "passed";
const reasonOf = (out) => out?.hookSpecificOutput?.permissionDecisionReason ?? "";

test("a broad process kill is denied in every permission mode and every devguard mode", () => {
  const a = session();
  for (const mode of ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"]) {
    for (const dgMode of ["ask", "deny-once", "warn", "off"]) {
      const out = bash(a, "pkill -f cat", withData(isolatedEnv({ CLAUDE_PLUGIN_OPTION_MODE: dgMode })), { mode });
      assert.equal(decisionOf(out), "deny", `${mode} / ${dgMode}`);
      assert.match(reasonOf(out), /live_guard denies this in every permission mode.*CY_ALLOW_DANGER=1/);
    }
  }
});

test("a disruptive command asks, and under bypassPermissions is denied once then passes on retry", () => {
  const a = session();
  const env = withData(isolatedEnv());
  assert.equal(decisionOf(bash(a, "tmux send-keys -t main ls Enter", env)), "ask");
  const first = bash(a, "tmux send-keys -t main ls Enter", env, { mode: "bypassPermissions" });
  assert.equal(decisionOf(first), "deny");
  assert.match(reasonOf(first), /^Default: NO\./);
  assert.equal(bash(a, "tmux send-keys -t main ls Enter", env, { mode: "bypassPermissions" }), null);
  assert.equal(decisionOf(bash(a, "tmux kill-server", env, { mode: "bypassPermissions" })), "deny");
});

test("bypass_strict keeps every live_guard ask denied under bypassPermissions", () => {
  const a = session();
  const env = withData(isolatedEnv({ CLAUDE_PLUGIN_OPTION_BYPASS_STRICT: "true" }));
  for (let i = 0; i < 2; i++) assert.equal(decisionOf(bash(a, "defaults write -g x 1", env, { mode: "bypassPermissions" })), "deny");
});

test("a tmux session created in one call can be driven and closed in the next", () => {
  const a = session();
  const env = withData(isolatedEnv());
  assert.equal(bash(a, "tmux new-session -d -s cx-1 codex", env), null);
  assert.equal(bash(a, "tmux send-keys -t cx-1 -l hello", env), null);
  assert.equal(bash(a, "tmux kill-session -t cx-1", env), null);
  assert.equal(decisionOf(bash(a, "tmux kill-session -t cx-1", env, { sid: "other" })), "ask");
});

test("the relaunch limit asks after the limit and denies under bypassPermissions", () => {
  const a = session();
  const env = withData(isolatedEnv({ CLAUDE_PLUGIN_OPTION_RELAUNCH_LIMIT: "2" }));
  const now = Date.parse("2026-10-26T10:00:00Z");
  assert.equal(bash(a, "open -a \"Session Deck\"", env, { now }), null);
  assert.equal(bash(a, "open -a \"Session Deck\"", env, { now: now + 1000 }), null);
  const third = bash(a, "open -a 'Session Deck'", env, { now: now + 2000 });
  assert.equal(decisionOf(third), "ask");
  assert.match(reasonOf(third), /`Session Deck` has been launched or brought to the front 3 times/);
  for (let i = 0; i < 2; i++) assert.equal(decisionOf(bash(a, "open -a \"Session Deck\"", env, { mode: "bypassPermissions", now: now + 3000 + i })), "deny");
  assert.equal(bash(a, "open -a \"Session Deck\"", env, { now: now + 61 * 60 * 1000 }), null);
  assert.equal(bash(a, "open -a Safari", env, { now: now + 4000 }), null);
});

test("relaunch_limit 0 turns the budget off", () => {
  const a = session();
  const env = withData(isolatedEnv({ CLAUDE_PLUGIN_OPTION_RELAUNCH_LIMIT: "0" }));
  for (let i = 0; i < 8; i++) assert.equal(bash(a, "open -a Foo", env), null);
});

test("file tools writing a launch agent or /etc/hosts ask", () => {
  const a = session();
  const env = withData(isolatedEnv());
  assert.equal(decisionOf(write(a, join(env.HOME, "Library", "LaunchAgents", "x.plist"), env)), "ask");
  assert.equal(decisionOf(write(a, "/etc/hosts", env)), "ask");
  assert.equal(decisionOf(write(a, "/etc/hosts", env, "bypassPermissions")), "deny");
});

test("the escape variable and live_guard false lift the guard", () => {
  const a = session();
  assert.equal(bash(a, "pkill node", withData(isolatedEnv({ CY_ALLOW_DANGER: "1" }))), null);
  assert.equal(bash(a, "pkill node", withData(isolatedEnv({ CLAUDE_PLUGIN_OPTION_LIVE_GUARD: "false" }))), null);
  assert.equal(bash(a, "kill 4242", withData(isolatedEnv())), null);
});

test("the desktop pack is off by default and on with live_guard_desktop", () => {
  const a = session();
  assert.equal(bash(a, "say done", withData(isolatedEnv())), null);
  assert.equal(decisionOf(bash(a, "say done", withData(isolatedEnv({ CLAUDE_PLUGIN_OPTION_LIVE_GUARD_DESKTOP: "true" })))), "ask");
});

test("a repository can only tighten live_guard", () => {
  const a = session();
  mkdirSync(join(a, ".claude"), { recursive: true });
  writeFileSync(join(a, ".claude", "cyberine-devguard.json"), JSON.stringify({ liveGuard: true, liveGuardDesktop: true, relaunchLimit: 2 }));
  const off = loadConfig({ env: { CLAUDE_PLUGIN_OPTION_LIVE_GUARD: "false", CLAUDE_PLUGIN_OPTION_RELAUNCH_LIMIT: "0" }, sessionRoot: a });
  assert.equal(off.liveGuard, true);
  assert.equal(off.liveGuardDesktop, true);
  assert.equal(off.relaunchLimit, 2);
  writeFileSync(join(a, ".claude", "cyberine-devguard.json"), JSON.stringify({ liveGuard: false, liveGuardDesktop: false, relaunchLimit: 50 }));
  const c = loadConfig({ env: {}, sessionRoot: a });
  assert.equal(c.liveGuard, true);
  assert.equal(c.liveGuardDesktop, false);
  assert.equal(c.relaunchLimit, 5);
  assert.ok(c.warnings.some((w) => /liveGuard false is ignored/.test(w)));
  assert.ok(c.warnings.some((w) => /relaunchLimit 50 is ignored/.test(w)));
  writeFileSync(join(a, ".claude", "settings.json"), JSON.stringify({ env: { CLAUDE_PLUGIN_OPTION_LIVE_GUARD: "false", CLAUDE_PLUGIN_OPTION_RELAUNCH_LIMIT: "1" } }));
  writeFileSync(join(a, ".claude", "cyberine-devguard.json"), "{}");
  const viaEnv = loadConfig({ env: { CLAUDE_PLUGIN_OPTION_LIVE_GUARD: "false", CLAUDE_PLUGIN_OPTION_RELAUNCH_LIMIT: "1" }, sessionRoot: a });
  assert.equal(viaEnv.liveGuard, true);
  assert.equal(viaEnv.relaunchLimit, 1);
});

test("the session hint adds one line for live_guard", () => {
  const hint = (over) => sessionStart("22.0.0", { dangerGuard: true, liveGuard: true, sessionHint: true, ...over })?.hookSpecificOutput?.additionalContext;
  assert.equal(hint(), `${SESSION_HINT}\n${LIVE_HINT}`);
  assert.equal(hint({ liveGuard: false }), SESSION_HINT);
  assert.equal(hint({ dangerGuard: false }), LIVE_HINT);
  assert.equal(hint({ sessionHint: false }), undefined);
});
