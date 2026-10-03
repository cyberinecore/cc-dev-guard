import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runHook } from "../scripts/lib/cli.mjs";
import { git, gitCommit, gitInit, hookInput, isolatedEnv, tempDir } from "./helpers.mjs";

const decisionOf = (out) => out?.hookSpecificOutput?.permissionDecision ?? "passed";

function fixture() {
  const root = tempDir();
  const a = join(root, "a");
  gitInit(a);
  writeFileSync(join(a, ".gitignore"), ".local/\n");
  gitCommit(a);
  const scratch = join(a, ".local", "tmp", "scratch");
  gitInit(scratch);
  const plain = join(a, "vendor", "lib");
  gitInit(plain);
  const wt = join(a, ".claude", "worktrees", "w");
  git(a, "worktree", "add", "-q", "-b", "w", wt);
  const wtScratch = join(wt, ".local", "tmp", "s");
  gitInit(wtScratch);
  return { root, a, scratch, plain, wt, wtScratch };
}

function write(session, target, env = isolatedEnv(), mode = "default") {
  const raw = JSON.stringify(hookInput({ cwd: session, target, extra: { permission_mode: mode } }));
  return runHook({ raw, env: { CLAUDE_PROJECT_DIR: session, ...env } });
}

function bash(session, command, env = isolatedEnv()) {
  const raw = JSON.stringify({ session_id: "s1", cwd: session, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, permission_mode: "default" });
  return runHook({ raw, env: { CLAUDE_PROJECT_DIR: session, ...env } });
}

test("a repository nested in a path the session repository ignores passes, from the main checkout and from a worktree", () => {
  const f = fixture();
  assert.equal(write(f.a, join(f.scratch, "x.md")), null);
  assert.equal(write(f.wt, join(f.wtScratch, "x.md")), null);
  assert.equal(bash(f.a, `cd ${JSON.stringify(f.scratch)} && git add . && git commit -qm x`), null);
});

test("a nested repository the session repository does not ignore still asks", () => {
  const f = fixture();
  assert.equal(decisionOf(write(f.a, join(f.plain, "x.md"))), "ask");
});

test("an ignored path of the session repository does not cover a repository outside it", () => {
  const f = fixture();
  const outside = join(f.root, "b");
  gitInit(outside);
  writeFileSync(join(outside, ".gitignore"), ".local/\n");
  mkdirSync(join(outside, ".local"), { recursive: true });
  assert.equal(decisionOf(write(f.a, join(outside, ".local", "x.md"))), "passed", "ignored by b itself, as before");
  assert.equal(decisionOf(write(f.a, join(outside, "x.md"))), "ask");
});

test("allow_ignored_nested_repos false sends nested repositories back to ask", () => {
  const f = fixture();
  const env = isolatedEnv({ CLAUDE_PLUGIN_OPTION_ALLOW_IGNORED_NESTED_REPOS: "false" });
  assert.equal(decisionOf(write(f.a, join(f.scratch, "x.md"), env)), "ask");
  assert.equal(decisionOf(write(f.a, join(f.scratch, "x.md"), env, "bypassPermissions")), "deny");
});

test("a repository file can turn allowIgnoredNestedRepos off but not on", () => {
  const f = fixture();
  mkdirSync(join(f.a, ".claude"), { recursive: true });
  writeFileSync(join(f.a, ".claude", "cyberine-devguard.json"), JSON.stringify({ allowIgnoredNestedRepos: false }));
  assert.equal(decisionOf(write(f.a, join(f.scratch, "x.md"))), "ask");
  writeFileSync(join(f.a, ".claude", "cyberine-devguard.json"), JSON.stringify({ allowIgnoredNestedRepos: true }));
  const out = write(f.a, join(f.scratch, "x.md"), isolatedEnv({ CLAUDE_PLUGIN_OPTION_ALLOW_IGNORED_NESTED_REPOS: "false" }));
  assert.equal(decisionOf(out), "ask");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /allowIgnoredNestedRepos true is ignored/);
});
