import { strict as assert } from "node:assert";
import { readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { RETRY_WINDOW_MS } from "../scripts/lib/constants.mjs";
import { render, renderError } from "../scripts/lib/output.mjs";
import { tempDir } from "./helpers.mjs";

const input = { session_id: "s1", tool_name: "Write", tool_input: { file_path: "/b/x.md" } };
const cross = {
  action: "cross",
  why: "cross-repo",
  target: "/b/x.md",
  targetRepo: "/b/.git",
  targetTop: "/b",
  sessionTop: "/a",
  allowed: { ok: true, dirs: ["/c/sub"] },
};

function decisionOf(out) {
  return out?.hookSpecificOutput?.permissionDecision;
}

test("pass verdicts emit nothing in every mode", () => {
  for (const mode of ["ask", "deny-once", "warn", "off"]) {
    assert.equal(render({ action: "pass", why: "same-repo" }, { mode, input, now: Date.now(), markerDir: tempDir() }), null);
  }
});

test("ask mode asks with a reason naming the target, both repos and the allowed dirs", () => {
  const out = render(cross, { mode: "ask", input, now: Date.now(), markerDir: tempDir() });
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(decisionOf(out), "ask");
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  for (const needle of ["/b/x.md", "/b", "/a", "/c/sub"]) assert.ok(reason.includes(needle), `reason mentions ${needle}: ${reason}`);
});

test("the reason says when allowed dirs could not be read", () => {
  const out = render({ ...cross, allowed: { ok: false, reason: "no environment snapshot in the transcript" } }, { mode: "ask", input, now: Date.now(), markerDir: tempDir() });
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /could not be read/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /no environment snapshot/);
});

test("the allowed-dir list is capped", () => {
  const dirs = Array.from({ length: 13 }, (_, i) => `/d${i}`);
  const reason = render({ ...cross, allowed: { ok: true, dirs } }, { mode: "ask", input, now: Date.now(), markerDir: tempDir() }).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /and 3 more/);
  const none = render({ ...cross, allowed: { ok: true, dirs: [] } }, { mode: "ask", input, now: Date.now(), markerDir: tempDir() }).hookSpecificOutput.permissionDecisionReason;
  assert.match(none, /none/);
});

test("deny-once denies the first write, lets a retry through inside the window, and denies again after it", () => {
  const markerDir = join(tempDir(), "markers");
  const now = Date.now();
  const first = render(cross, { mode: "deny-once", input, now, markerDir });
  assert.equal(decisionOf(first), "deny");
  assert.equal(render(cross, { mode: "deny-once", input, now: now + 60_000, markerDir }), null);
  const other = render(cross, { mode: "deny-once", input: { ...input, session_id: "s2" }, now: now + 60_000, markerDir });
  assert.equal(decisionOf(other), "deny", "markers are per session");
  const marker = join(markerDir, readdirSync(markerDir)[0]);
  const old = new Date(now - RETRY_WINDOW_MS - 60_000);
  utimesSync(marker, old, old);
  assert.equal(decisionOf(render(cross, { mode: "deny-once", input, now, markerDir })), "deny");
});

test("deny-once prunes stale markers", () => {
  const markerDir = tempDir();
  const stale = join(markerDir, "stale");
  writeFileSync(stale, "");
  const old = new Date(Date.now() - 2 * RETRY_WINDOW_MS);
  utimesSync(stale, old, old);
  render(cross, { mode: "deny-once", input, now: Date.now(), markerDir });
  assert.throws(() => statSync(stale));
});

test("deny-once still denies when the marker dir cannot be written", () => {
  const blocker = join(tempDir(), "file");
  writeFileSync(blocker, "");
  const out = render(cross, { mode: "deny-once", input, now: Date.now(), markerDir: join(blocker, "markers") });
  assert.equal(decisionOf(out), "deny");
});

test("warn mode never blocks and shows a notice", () => {
  const out = render(cross, { mode: "warn", input, now: Date.now(), markerDir: tempDir() });
  assert.equal(decisionOf(out), undefined);
  assert.match(out.systemMessage, /\/b\/x\.md/);
});

test("off mode emits nothing, even for a config file", () => {
  assert.equal(render(cross, { mode: "off", input, now: Date.now(), markerDir: tempDir() }), null);
  assert.equal(render({ action: "cross", why: "config-file", target: "/a/.claude/devguard.json" }, { mode: "off", input, now: Date.now(), markerDir: tempDir() }), null);
});

test("config-file and protected verdicts ask in ask, deny-once and warn modes", () => {
  for (const why of ["config-file", "protected"]) {
    for (const mode of ["ask", "deny-once", "warn"]) {
      const out = render({ action: "cross", why, target: "/a/.claude/devguard.json" }, { mode, input, now: Date.now(), markerDir: tempDir() });
      assert.equal(decisionOf(out), "ask", `${why} in ${mode}`);
    }
  }
});

test("the hook never emits allow", () => {
  const verdicts = [cross, { ...cross, allowed: { ok: false, reason: "x" } }, { action: "cross", why: "config-file", target: "/t" }, { action: "cross", why: "protected", target: "/t" }, { action: "cross", why: "invalid-path", target: "/t" }, { action: "pass", why: "same-repo" }];
  for (const mode of ["ask", "deny-once", "warn", "off"]) {
    for (const v of verdicts) {
      const out = render(v, { mode, input, now: Date.now(), markerDir: tempDir() });
      assert.notEqual(decisionOf(out), "allow");
    }
  }
  assert.equal(decisionOf(renderError(new Error("boom"))), "ask");
});

test("an internal error asks with a readable reason", () => {
  const out = renderError(new Error("boom"));
  assert.equal(decisionOf(out), "ask");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /could not check/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /boom/);
});
