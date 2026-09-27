import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runHook } from "../scripts/lib/cli.mjs";
import { envLine, hookInput, isolatedEnv, scopeFixture, writeTranscript } from "./helpers.mjs";

const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "devguard.mjs");

function hook(stdin, env) {
  const r = spawnSync(process.execPath, [entry, "hook"], { input: stdin, env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr };
}

test("a same-repo write prints nothing and exits 0", () => {
  const f = scopeFixture();
  const r = hook(JSON.stringify(hookInput({ cwd: f.a, target: join(f.a, "x.md") })), isolatedEnv({ CLAUDE_PROJECT_DIR: f.a }));
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

test("a cross-repo write prints an ask decision and exits 0", () => {
  const f = scopeFixture();
  const r = hook(JSON.stringify(hookInput({ cwd: f.a, target: join(f.b, "x.md") })), isolatedEnv({ CLAUDE_PROJECT_DIR: f.a }));
  assert.equal(r.code, 0);
  const out = JSON.parse(r.out);
  assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
});

test("CLAUDE_PROJECT_DIR anchors the session even after a cd", () => {
  const f = scopeFixture();
  const r = hook(JSON.stringify(hookInput({ cwd: f.b, target: join(f.b, "x.md") })), isolatedEnv({ CLAUDE_PROJECT_DIR: f.a }));
  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "ask");
});

test("an allowed dir from the transcript passes end to end", () => {
  const f = scopeFixture();
  const transcript = writeTranscript(envLine(join(f.b, "sub")));
  const r = hook(JSON.stringify(hookInput({ cwd: f.a, target: join(f.b, "sub", "x.md"), transcript })), isolatedEnv({ CLAUDE_PROJECT_DIR: f.a }));
  assert.equal(r.out, "");
});

test("mode off from userConfig prints nothing", () => {
  const f = scopeFixture();
  const r = hook(JSON.stringify(hookInput({ cwd: f.a, target: join(f.b, "x.md") })), isolatedEnv({ CLAUDE_PROJECT_DIR: f.a, CLAUDE_PLUGIN_OPTION_MODE: "off" }));
  assert.equal(r.out, "");
});

test("unparseable hook input asks", () => {
  const r = hook("{not json", isolatedEnv());
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "ask");
});

test("an internal exception asks and never relies on stderr alone", () => {
  const f = scopeFixture();
  const raw = JSON.stringify(hookInput({ cwd: f.a, target: join(f.a, "x.md") }));
  const out = runHook({ raw, env: isolatedEnv({ CLAUDE_PROJECT_DIR: f.a }), deps: { decide: () => { throw new Error("engine exploded"); } } });
  assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /engine exploded/);
});

test("log_decisions appends cross verdicts to the plugin data dir", () => {
  const f = scopeFixture();
  const env = isolatedEnv({ CLAUDE_PROJECT_DIR: f.a, CLAUDE_PLUGIN_OPTION_LOG_DECISIONS: "true", CLAUDE_PLUGIN_DATA: join(f.root, "data") });
  hook(JSON.stringify(hookInput({ cwd: f.a, target: join(f.b, "x.md") })), env);
  hook(JSON.stringify(hookInput({ cwd: f.a, target: join(f.a, "x.md") })), env);
  const lines = readFileSync(join(f.root, "data", "decisions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1, "only cross verdicts are logged");
  assert.equal(lines[0].verdict, "ask");
  assert.equal(lines[0].target, join(f.b, "x.md"));
  assert.deepEqual(Object.keys(lines[0]).sort(), ["session", "target", "time", "tool", "verdict", "why"]);
});

test("explain prints the session repo, allowed dirs, config and verdict", () => {
  const f = scopeFixture();
  const transcript = writeTranscript(envLine(join(f.b, "sub")));
  const r = spawnSync(process.execPath, [entry, "explain", join(f.b, "x.md"), "--root", f.a, "--cwd", f.a, "--transcript", transcript], { env: { PATH: process.env.PATH, ...isolatedEnv() }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  for (const needle of ["session repo", f.a, "allowed dirs", join(f.b, "sub"), "mode", "ask", "verdict", "cross"]) {
    assert.ok(r.stdout.includes(needle), `explain output mentions ${needle}:\n${r.stdout}`);
  }
  assert.ok(!r.stdout.includes("workingDirectory"), "no raw transcript content");
});

test("explain on a same-repo path says it passes", () => {
  const f = scopeFixture();
  const r = spawnSync(process.execPath, [entry, "explain", join(f.a, "x.md"), "--root", f.a], { env: { PATH: process.env.PATH, ...isolatedEnv() }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /verdict: pass \(same-repo\)/);
});

test("unknown subcommands exit 2 with usage", () => {
  const r = spawnSync(process.execPath, [entry, "nope"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/i);
});
