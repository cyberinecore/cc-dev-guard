import { strict as assert } from "node:assert";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "../scripts/lib/config.mjs";
import { decide } from "../scripts/lib/decide.mjs";
import { readRelocatedDir } from "../scripts/lib/transcript.mjs";
import { envLine, hookInput, isolatedEnv, scopeFixture } from "./helpers.mjs";

const relocated = (dir, sessionId = "s1") => JSON.stringify({ type: "relocated", relocatedCwd: dir, sessionId });

function projectTranscript(env, lines, slug = "-moved") {
  const dir = join(env.CLAUDE_CONFIG_DIR, "projects", slug);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "s1.jsonl");
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
}

function run({ f, env, transcript, readTranscript = true, session = "s1" }) {
  const input = hookInput({ cwd: f.b, target: join(f.b, "x.md"), transcript, session });
  return decide(input, { sessionRoot: f.a, env, config: { ...defaultConfig(), readTranscript } });
}

test("a user /cd into another repository passes there when read_transcript is on", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const t = projectTranscript(env, [relocated(f.b), envLine()]);
  const v = run({ f, env, transcript: t });
  assert.equal(v.action, "pass", `want pass, got ${v.action} (${v.why})`);
  assert.equal(v.why, "allowed-dir");
});

test("without read_transcript the relocated record is never read, so /cd still crosses", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const t = projectTranscript(env, [relocated(f.b), envLine()]);
  assert.equal(run({ f, env, transcript: t, readTranscript: false }).action, "cross");
});

test("the last relocated record wins, wherever it sits in a moved transcript", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const mode = JSON.stringify({ type: "mode", mode: "normal", sessionId: "s1" });
  assert.equal(run({ f, env, transcript: projectTranscript(env, [mode, envLine(), relocated(f.b), envLine()], "-mid") }).action, "pass", "mid-file record");
  assert.equal(run({ f, env, transcript: projectTranscript(env, [envLine(), relocated(f.b), envLine(), relocated(f.a), envLine()], "-back") }).action, "cross", "moved back to a");
});

test("relocated text inside a message or tool result is not a record", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const quoted = JSON.stringify({ type: "user", message: { role: "user", content: relocated(f.b) } });
  const result = JSON.stringify({ type: "user", toolUseResult: { stdout: `${relocated(f.b)}\n` } });
  assert.equal(run({ f, env, transcript: projectTranscript(env, [envLine(), quoted, result], "-quoted") }).action, "cross");
});

test("a relocated record for another session or outside the projects folder grants nothing", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  assert.equal(run({ f, env, transcript: projectTranscript(env, [relocated(f.b, "other"), envLine()]) }).action, "cross", "session mismatch");
  const outside = join(f.root, "fake.jsonl");
  writeFileSync(outside, [relocated(f.b), envLine()].join("\n") + "\n");
  assert.equal(run({ f, env, transcript: outside }).action, "cross", "outside projects");
});

test("the relocated dir grants only that directory, not its parent or siblings", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const t = projectTranscript(env, [relocated(join(f.b, "sub")), envLine()]);
  assert.equal(run({ f, env, transcript: t }).action, "cross", "b/x.md is outside b/sub");
  const input = hookInput({ cwd: f.b, target: join(f.b, "sub", "y.md"), transcript: t });
  assert.equal(decide(input, { sessionRoot: f.a, env, config: { ...defaultConfig(), readTranscript: true } }).action, "pass");
});

test("a transcript path that is a symlink to a file outside the projects folder grants nothing", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const outside = join(f.root, "evil.jsonl");
  writeFileSync(outside, [relocated(f.b), envLine()].join("\n") + "\n");
  const dir = join(env.CLAUDE_CONFIG_DIR, "projects", "-link");
  mkdirSync(dir, { recursive: true });
  const link = join(dir, "s1.jsonl");
  symlinkSync(outside, link);
  assert.equal(run({ f, env, transcript: link }).action, "cross");
});

test("the root, a missing directory or an invalid last record grants nothing, and an older record is not used instead", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  assert.equal(run({ f, env, transcript: projectTranscript(env, [relocated("/"), envLine()], "-root") }).action, "cross", "root");
  assert.equal(run({ f, env, transcript: projectTranscript(env, [relocated(join(f.root, "ghost")), envLine()], "-ghost") }).action, "cross", "missing dir");
  const bad = JSON.stringify({ type: "relocated", relocatedCwd: "rel/dir", sessionId: "s1" });
  assert.equal(run({ f, env, transcript: projectTranscript(env, [relocated(f.b), envLine(), bad, envLine()], "-stale") }).action, "cross", "invalid last record");
  assert.equal(run({ f, env, transcript: projectTranscript(env, [relocated(f.b), envLine(), relocated(f.b, "other"), envLine()], "-foreign") }).action, "cross", "foreign last record");
});

test("readRelocatedDir rejects malformed input", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  assert.equal(readRelocatedDir("", "s1"), "");
  assert.equal(readRelocatedDir("rel.jsonl", "s1"), "");
  assert.equal(readRelocatedDir(projectTranscript(env, [relocated(f.b)]), ""), "", "no session id");
  assert.equal(readRelocatedDir(projectTranscript(env, ["{not json", envLine()], "-bad"), "s1"), "");
  assert.equal(readRelocatedDir(projectTranscript(env, [JSON.stringify({ type: "relocated", relocatedCwd: "rel/dir", sessionId: "s1" })], "-rel"), "s1"), "", "relative dir");
  assert.equal(readRelocatedDir(projectTranscript(env, [relocated(f.b)], "-ok"), "s1"), f.b);
});
