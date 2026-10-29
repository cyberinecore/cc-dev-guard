import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { redactCommand, runHook } from "../scripts/lib/cli.mjs";
import { gitInit, isolatedEnv, tempDir } from "./helpers.mjs";

function setup(log = "true") {
  const a = join(tempDir(), "a");
  gitInit(a);
  const data = join(tempDir(), "data");
  const env = isolatedEnv({ CLAUDE_PROJECT_DIR: a, CLAUDE_PLUGIN_DATA: data, CLAUDE_PLUGIN_OPTION_LOG_DECISIONS: log });
  const run = (tool_name, tool_input) => runHook({ raw: JSON.stringify({ session_id: "s1", cwd: a, hook_event_name: "PreToolUse", tool_name, tool_input, permission_mode: "default" }), env });
  const lines = () => (existsSync(join(data, "decisions.jsonl")) ? readFileSync(join(data, "decisions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { a, env, run, lines };
}

test("log_decisions records danger_guard and live_guard denials with the guard and reason, never the command", () => {
  const { run, lines, env } = setup();
  const fakeToken = ["ghp", "x".repeat(36)].join("_");
  run("Bash", { command: `GITHUB_TOKEN=${fakeToken} git reset --hard HEAD` });
  run("Bash", { command: "pkill node" });
  const [danger, live] = lines();
  assert.equal(danger.guard, "danger");
  assert.equal(danger.verdict, "deny");
  assert.match(danger.reason, /git reset --hard/);
  assert.equal(danger.command, undefined);
  assert.doesNotMatch(JSON.stringify(danger), /ghp_|GITHUB_TOKEN/);
  assert.equal(live.guard, "live");
  assert.equal(live.command, undefined);
  assert.ok(danger.version);
  assert.doesNotMatch(JSON.stringify(lines()), new RegExp(env.HOME));
});

test("a CACHEDIR.TAG write through the Write tool is logged with its target", () => {
  const { a, run, lines } = setup();
  run("Write", { file_path: join(a, "out", "CACHEDIR.TAG"), content: "x" });
  const [line] = lines();
  assert.equal(line.guard, "danger");
  assert.match(line.target, /CACHEDIR\.TAG$/);
});

test("nothing is logged when log_decisions is off or the command passes", () => {
  const off = setup("false");
  off.run("Bash", { command: "git reset --hard HEAD" });
  assert.deepEqual(off.lines(), []);
  const on = setup();
  on.run("Bash", { command: "ls -la" });
  assert.deepEqual(on.lines(), []);
});

test("redactCommand masks secrets but keeps paths and ordinary flags readable", () => {
  assert.equal(redactCommand("curl -H 'Authorization: Bearer abc.def' https://u:pw@host/x"), "curl -H 'Authorization: Bearer ***' https://***@host/x");
  assert.equal(redactCommand("mkdir -p /Users/me/WORK/AI/ai-recording/target/debug/bundle", "/Users/me"), "mkdir -p ~/WORK/AI/ai-recording/target/debug/bundle");
  assert.equal(redactCommand("tool --api-key sk-ant-123 --token=xyz run"), "tool --api-key *** --token=*** run");
  assert.equal(redactCommand("export DB_PASSWORD='hunter 2'; psql"), "export DB_PASSWORD=***; psql");
  assert.ok(redactCommand("x".repeat(1000)).length <= 403);
});
