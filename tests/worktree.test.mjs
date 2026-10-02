import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findWorktreeAdds, judgeWorktreeAdds, tokenize } from "../scripts/lib/bashguard.mjs";
import { runHook } from "../scripts/lib/cli.mjs";
import { makeGit, parseWorktreeList } from "../scripts/lib/git.mjs";
import { formatScan, scanRepo } from "../scripts/lib/worktrees.mjs";
import { createWorktree, makeGit as makePluginGit, validName } from "../plugins/cyberine-worktree/scripts/worktree-create.mjs";
import { git, gitCommit, gitInit, isolatedEnv, tempDir } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const createScript = join(here, "..", "plugins", "cyberine-worktree", "scripts", "worktree-create.mjs");

function repo(dir) {
  gitInit(dir);
  gitCommit(dir);
  return dir;
}

function families() {
  const root = tempDir();
  const plain = repo(join(root, "plain"));
  const nest = repo(join(root, "nest"));
  git(nest, "worktree", "add", "-q", "--no-track", "-B", "worktree/parent", join(nest, ".claude", "worktrees", "parent"), "HEAD");
  const subsrc = repo(join(root, "subsrc"));
  const outer = repo(join(root, "outer"));
  git(outer, "-c", "protocol.file.allow=always", "submodule", "add", "-q", subsrc, "sub");
  git(outer, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "sub");
  const sub = join(outer, "sub");
  const subWt = join(sub, ".claude", "worktrees", "subparent");
  git(sub, "worktree", "add", "-q", "--no-track", "-B", "worktree/subparent", subWt, "HEAD");
  return { root, plain, nest, nestWt: join(nest, ".claude", "worktrees", "parent"), outer, sub, subWt };
}

const bash = (command, cwd, extra = {}) => ({ session_id: "s1", cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, ...extra });

test("the tokenizer keeps quoted words whole and marks variables", () => {
  const t = tokenize(`git -C "my repo" worktree add '/tmp/a b' && echo $X`);
  assert.deepEqual(t.filter((x) => x.text !== undefined).map((x) => x.text), ["git", "-C", "my repo", "worktree", "add", "/tmp/a b", "echo", "$X"]);
  assert.ok(t.find((x) => x.text === "$X").dynamic);
  assert.ok(t.some((x) => x.op === "&&"));
});

test("worktree add targets are found through -C, cd, options and prefixes", () => {
  const cwd = "/r";
  const target = (c) => findWorktreeAdds(c, { cwd, home: "/h" }).map((h) => h.target || h.unresolved);
  assert.deepEqual(target("git worktree add /tmp/x"), [resolve("/tmp/x")]);
  assert.deepEqual(target("git -C /other worktree add ../sib -b feat"), [resolve("/sib")]);
  assert.deepEqual(target("git worktree add -B b --lock --reason why .claude/worktrees/y HEAD"), [resolve("/r/.claude/worktrees/y")]);
  assert.deepEqual(target("cd /a && git worktree add w"), [resolve("/a/w")]);
  assert.deepEqual(target("(cd /a && true); git worktree add w"), [resolve("/r/w")]);
  assert.deepEqual(target("GIT_X=1 command git --no-pager worktree add ~/wt"), [resolve("/h/wt")]);
  assert.deepEqual(target("git worktree add -- -odd"), [resolve("/r/-odd")]);
  assert.deepEqual(target("git worktree add $DIR"), ["the worktree path"]);
  assert.deepEqual(target("cd $X && git worktree add w"), ["the working directory"]);
  assert.deepEqual(target("git --git-dir=/x/.git worktree add w"), ["--git-dir or --work-tree"]);
  assert.deepEqual(target("git worktree list; git worktree prune; echo git worktree add /tmp/z"), []);
  assert.deepEqual(target("git worktree add /tmp/x 2>/dev/null"), [resolve("/tmp/x")]);
  for (const sub of ["list", "prune", "lock w", "unlock w", "repair", "remove w", "move a b"]) {
    assert.deepEqual(target(`git -C "$X" worktree ${sub}`), [], `worktree ${sub} with an unresolved -C`);
    assert.deepEqual(target(`git --git-dir "$G" worktree ${sub}`), [], `worktree ${sub} with --git-dir`);
  }
  assert.deepEqual(target("git -C $P/repo worktree list"), []);
  assert.deepEqual(target(`mkdir -p $P; cd $P; git init -q -b main repo; git -C repo -c user.name=t -c user.email=t@t commit -q --allow-empty -m init; cd repo; claude -p "...EnterWorktree..." --allowedTools=EnterWorktree; git worktree list`), [], "the compound command from the 0.2.0 report");
  assert.deepEqual(target(`git -C "$X" worktree add w`), ["the -C directory"]);
  assert.deepEqual(target("cd $P; git -C repo worktree add w"), ["the -C directory"]);
});

test("a worktree under the repository's .claude/worktrees passes, anything else crosses", () => {
  const f = families();
  const g = makeGit();
  const judge = (command, cwd) => judgeWorktreeAdds(command, { cwd, home: f.root, git: g });
  assert.equal(judge("git worktree add .claude/worktrees/a", f.plain).action, "pass");
  assert.equal(judge(`git -C '${f.plain}' worktree add '${join(f.plain, ".claude", "worktrees", "b")}'`, f.root).action, "pass");
  const tmp = judge("git worktree add /tmp/stray", f.plain);
  assert.equal(tmp.action, "cross");
  assert.equal(tmp.worktreesDir, join(f.plain, ".claude", "worktrees"));
  assert.equal(judge(`git -C '${f.plain}' worktree add ../sibling`, f.root).action, "cross");
  assert.equal(judge("git worktree add .claude/worktrees", f.plain).action, "cross", "the folder itself is not a worktree slot");
  assert.equal(judge(`git worktree add '${join(f.nest, ".claude", "worktrees", "child")}'`, f.nestWt).action, "pass", "a linked worktree uses the main root");
  assert.equal(judge("git worktree add .claude/worktrees/nested", f.nestWt).action, "cross", "nesting under a linked worktree is stray");
  assert.equal(judge("git worktree add $D", f.plain).why, "worktree-unresolved");
  assert.equal(judge("git status", f.plain).action, "pass");
});

test("the Bash hook asks, denies under bypass, warns, and stays silent when off", () => {
  const f = families();
  const env = isolatedEnv({ CLAUDE_PROJECT_DIR: f.plain });
  const ask = runHook({ raw: JSON.stringify(bash("git worktree add /tmp/stray-x", f.plain)), env });
  assert.equal(ask.hookSpecificOutput.permissionDecision, "ask");
  assert.match(ask.hookSpecificOutput.permissionDecisionReason, /\.claude\/worktrees|\.claude\\worktrees/);
  assert.match(ask.hookSpecificOutput.permissionDecisionReason, /EnterWorktree/);
  const bypass = runHook({ raw: JSON.stringify(bash("git worktree add /tmp/stray-x", f.plain, { permission_mode: "bypassPermissions" })), env });
  assert.equal(bypass.hookSpecificOutput.permissionDecision, "deny");
  const warn = runHook({ raw: JSON.stringify(bash("git worktree add /tmp/stray-x", f.plain)), env: { ...env, CLAUDE_PLUGIN_OPTION_MODE: "warn" } });
  assert.ok(warn.systemMessage);
  assert.equal(runHook({ raw: JSON.stringify(bash("git worktree add /tmp/stray-x", f.plain)), env: { ...env, CLAUDE_PLUGIN_OPTION_WORKTREE_GUARD: "false" } }), null);
  assert.equal(runHook({ raw: JSON.stringify(bash("git worktree add /tmp/stray-x", f.plain)), env: { ...env, CLAUDE_PLUGIN_OPTION_MODE: "off" } }), null);
  assert.equal(runHook({ raw: JSON.stringify(bash("ls -la", f.plain)), env }), null);
  assert.equal(runHook({ raw: JSON.stringify(bash("git worktree add .claude/worktrees/ok", f.plain)), env }), null);
});

test("a repository file cannot switch the worktree guard off", () => {
  const f = families();
  mkdirSync(join(f.plain, ".claude"), { recursive: true });
  writeFileSync(join(f.plain, ".claude", "cyberine-devguard.json"), JSON.stringify({ worktreeGuard: false }));
  const out = runHook({ raw: JSON.stringify(bash("git worktree add /tmp/stray-y", f.plain)), env: isolatedEnv({ CLAUDE_PROJECT_DIR: f.plain }) });
  assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /worktreeGuard false is ignored/);
});

test("devguard and cyberine-worktree resolve the same main root for every family", () => {
  const f = families();
  const a = makeGit();
  const b = makePluginGit();
  const want = { [f.plain]: f.plain, [f.nestWt]: f.nest, [f.sub]: f.sub, [f.subWt]: f.sub, [f.nest]: f.nest };
  for (const [dir, root] of Object.entries(want)) {
    assert.equal(a.mainRoot(dir), root, `devguard ${dir}`);
    assert.equal(b.mainRoot(dir), root, `cyberine-worktree ${dir}`);
  }
});

test("cyberine-worktree creates under the main root, reuses, and refuses bad input", () => {
  const f = families();
  const opts = { git: makePluginGit(), stderrFd: "ignore" };
  const p = createWorktree({ name: "w1", cwd: f.plain }, opts);
  assert.equal(p, join(f.plain, ".claude", "worktrees", "w1"));
  assert.equal(git(p, "branch", "--show-current").trim(), "worktree/w1");
  assert.equal(createWorktree({ name: "w1", cwd: f.plain }, opts), p, "idempotent");
  const child = createWorktree({ name: "child", cwd: f.nestWt }, opts);
  assert.equal(child, join(f.nest, ".claude", "worktrees", "child"));
  assert.equal(git(child, "rev-parse", "HEAD"), git(f.nestWt, "rev-parse", "HEAD"), "based on the spawning worktree's HEAD");
  assert.equal(createWorktree({ name: "s1", cwd: f.sub }, opts), join(f.sub, ".claude", "worktrees", "s1"));
  assert.equal(createWorktree({ name: "s2", cwd: f.subWt }, opts), join(f.sub, ".claude", "worktrees", "s2"), "absorbed submodule worktree family");
  assert.equal(createWorktree({ worktree_path: "/x/fallback", cwd: f.plain }, opts), join(f.plain, ".claude", "worktrees", "fallback"));
  assert.throws(() => createWorktree({ cwd: f.plain }, opts), /missing \.name/);
  assert.throws(() => createWorktree({ name: "x" }, opts), /missing \.cwd/);
  assert.throws(() => createWorktree({ name: "x", cwd: tempDir() }, opts), /not a git repository/);
  assert.throws(() => createWorktree({ name: "../escape", cwd: f.plain }, opts), /segment/);
  assert.ok(validName("feat/a-1.b_c"));
  assert.ok(!validName("/abs") && !validName("a//b") && !validName("a b"));
});

test("the WorktreeCreate entry prints only the path on stdout and fails with a message", () => {
  const f = families();
  const ok = spawnSync(process.execPath, [createScript], { input: JSON.stringify({ hook_event_name: "WorktreeCreate", name: "e2e", cwd: f.plain }), encoding: "utf8", env: { PATH: process.env.PATH, HOME: f.root } });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, join(f.plain, ".claude", "worktrees", "e2e") + "\n");
  const bad = spawnSync(process.execPath, [createScript], { input: JSON.stringify({ name: "e2e", cwd: tempDir() }), encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stdout, "");
  assert.match(bad.stderr, /not a git repository/);
});

test("the scanner flags prunable, stray and merged worktrees and changes nothing", () => {
  const root = tempDir();
  const main = repo(join(root, "main"));
  const g = makeGit();
  git(main, "worktree", "add", "-q", "-b", "inside", join(main, ".claude", "worktrees", "inside"));
  git(main, "worktree", "add", "-q", "-b", "stray", join(root, "stray"));
  git(main, "worktree", "add", "-q", "-b", "gone", join(root, "gone"));
  rmSync(join(root, "gone"), { recursive: true, force: true });
  const gh = { prState: (dir, branch) => (branch === "inside" ? { ok: true, state: "MERGED", number: 7, mergedAt: "2026-10-01T00:00:00Z" } : { ok: true, state: "NONE" }) };
  const r = scanRepo(main, { git: g, gh });
  const by = Object.fromEntries(r.findings.map((x) => [x.branch, x.issues.join("; ")]));
  assert.match(by.inside, /merged: PR #7/);
  assert.doesNotMatch(by.inside, /outside/);
  assert.match(by.stray, /outside \.claude\/worktrees/);
  assert.match(by.gone, /prunable|directory missing/);
  const text = formatScan([r], { gh: true });
  assert.match(text, /worktree prune/);
  assert.match(text, /Nothing was changed/);
  assert.equal(parseWorktreeList(git(main, "worktree", "list", "--porcelain")).length, 4, "no worktree record was removed");
  assert.ok(existsSync(join(root, "stray")));
});

test("a gh failure is reported once per repository", () => {
  const root = tempDir();
  const main = repo(join(root, "main"));
  git(main, "worktree", "add", "-q", "-b", "a", join(root, "a"));
  git(main, "worktree", "add", "-q", "-b", "b", join(root, "b"));
  let calls = 0;
  const gh = { prState: () => (calls++, { ok: false, reason: "no access" }) };
  const r = scanRepo(main, { git: makeGit(), gh });
  assert.equal(calls, 1);
  assert.match(formatScan([r], { gh: true }), /gh failed \(no access\)/);
});