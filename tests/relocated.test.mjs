import { strict as assert } from "node:assert";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "../scripts/lib/config.mjs";
import { decide } from "../scripts/lib/decide.mjs";
import { projectSlug, readRelocatedDir } from "../scripts/lib/transcript.mjs";
import { envLine, hookInput, isolatedEnv, scopeFixture } from "./helpers.mjs";

const relocated = (dir, sessionId = "s1") => JSON.stringify({ type: "relocated", relocatedCwd: dir, sessionId });

let transcriptCount = 0;

function projectTranscript(env, lines, folderFor) {
  const dir = join(env.CLAUDE_CONFIG_DIR, "projects", projectSlug(folderFor));
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `s1-${transcriptCount++}.jsonl`);
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
  const t = projectTranscript(env, [relocated(f.b), envLine()], f.b);
  const v = run({ f, env, transcript: t });
  assert.equal(v.action, "pass", `want pass, got ${v.action} (${v.why})`);
  assert.equal(v.why, "allowed-dir");
});

test("without read_transcript the relocated record is never read, so /cd still crosses", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const t = projectTranscript(env, [relocated(f.b), envLine()], f.b);
  assert.equal(run({ f, env, transcript: t, readTranscript: false }).action, "cross");
});

test("the last relocated record wins, wherever it sits in a moved transcript", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const mode = JSON.stringify({ type: "mode", mode: "normal", sessionId: "s1" });
  assert.equal(run({ f, env, transcript: projectTranscript(env, [mode, envLine(), relocated(f.b), envLine()], f.b) }).action, "pass", "mid-file record");
  assert.equal(run({ f, env, transcript: projectTranscript(env, [envLine(), relocated(f.b), envLine(), relocated(f.a), envLine()], f.a) }).action, "cross", "moved back to a");
});

test("relocated text inside a message or tool result is not a record", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const quoted = JSON.stringify({ type: "user", message: { role: "user", content: relocated(f.b) } });
  const result = JSON.stringify({ type: "user", toolUseResult: { stdout: `${relocated(f.b)}\n` } });
  assert.equal(run({ f, env, transcript: projectTranscript(env, [envLine(), quoted, result], f.b) }).action, "cross");
});

test("a relocated record for another session or outside the projects folder grants nothing", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  assert.equal(run({ f, env, transcript: projectTranscript(env, [relocated(f.b, "other"), envLine()], f.b) }).action, "cross", "session mismatch");
  const outside = join(f.root, "fake.jsonl");
  writeFileSync(outside, [relocated(f.b), envLine()].join("\n") + "\n");
  assert.equal(run({ f, env, transcript: outside }).action, "cross", "outside projects");
});

test("the relocated dir grants only that directory, not its parent or siblings", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const t = projectTranscript(env, [relocated(join(f.b, "sub")), envLine()], join(f.b, "sub"));
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
  assert.equal(run({ f, env, transcript: projectTranscript(env, [relocated("/"), envLine()], "/") }).action, "cross", "root");
  assert.equal(run({ f, env, transcript: projectTranscript(env, [relocated(join(f.root, "ghost")), envLine()], join(f.root, "ghost")) }).action, "cross", "missing dir");
  const bad = JSON.stringify({ type: "relocated", relocatedCwd: "rel/dir", sessionId: "s1" });
  assert.equal(run({ f, env, transcript: projectTranscript(env, [relocated(f.b), envLine(), bad, envLine()], f.b) }).action, "cross", "invalid last record");
  assert.equal(run({ f, env, transcript: projectTranscript(env, [relocated(f.b), envLine(), relocated(f.b, "other"), envLine()], f.b) }).action, "cross", "foreign last record");
});

test("readRelocatedDir rejects malformed input", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  assert.equal(readRelocatedDir("", "s1"), "");
  assert.equal(readRelocatedDir("rel.jsonl", "s1"), "");
  assert.equal(readRelocatedDir(projectTranscript(env, [relocated(f.b)], f.b), ""), "", "no session id");
  assert.equal(readRelocatedDir(projectTranscript(env, ["{not json", envLine()], f.b), "s1"), "");
  assert.equal(readRelocatedDir(projectTranscript(env, [JSON.stringify({ type: "relocated", relocatedCwd: "rel/dir", sessionId: "s1" })], f.b), "s1"), "", "relative dir");
  assert.equal(readRelocatedDir(projectTranscript(env, [relocated(f.b)], f.b), "s1"), f.b);
});

test("a relocated record is accepted only when its directory matches the transcript's project folder", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  assert.equal(run({ f, env, transcript: projectTranscript(env, [relocated(f.b), envLine()], f.b) }).action, "pass", "folder named for the relocated dir");
  const forged = projectTranscript(env, [relocated(f.b), envLine()], f.a);
  assert.equal(run({ f, env, transcript: forged }).action, "cross", "forged record naming b inside a's project folder");
  assert.equal(readRelocatedDir(forged, "s1"), "");
  const stale = projectTranscript(env, [relocated(f.b), envLine(), relocated(f.root), envLine()], f.b);
  assert.equal(readRelocatedDir(stale, "s1"), "", "a forged last record hides the older valid one");
});

test("projectSlug replaces every character that is not a letter or a digit", () => {
  assert.equal(projectSlug("/Users/a/.claude/wt_1 x"), "-Users-a--claude-wt-1-x");
  assert.equal(projectSlug("/private/var/folders/_2/5v_c"), "-private-var-folders--2-5v-c");
  assert.equal(projectSlug(""), "");
  const f = scopeFixture();
  const env = isolatedEnv();
  const long = join(f.root, "a".repeat(40), "b".repeat(40), "c".repeat(40), "d".repeat(40));
  mkdirSync(long, { recursive: true });
  assert.equal(readRelocatedDir(projectTranscript(env, [relocated(long)], long), "s1"), "", "a slug over 200 characters never matches");
});
