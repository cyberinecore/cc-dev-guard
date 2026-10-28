import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runHook } from "../scripts/lib/cli.mjs";
import { dangerAskReason, dangerReason } from "../scripts/lib/dangerguard.mjs";
import { makeGit } from "../scripts/lib/git.mjs";
import { ALLOWS, CASE_HOME as home, DEVGUARD_ALLOWS, DEVGUARD_ASK_PASSES, DEVGUARD_ASKS } from "./fixtures/bashguard-cases.mjs";
import { git as runGit, gitCommit, gitInit, isolatedEnv, tempDir } from "./helpers.mjs";

const repo = `${home}/WORK/repo`;

function stubGit({ worktrees = [{ path: repo }], ignored = {}, counts = {}, refs = {} } = {}) {
  const calls = [];
  const entry = (w) => ({ head: "", branch: "", bare: false, detached: false, locked: null, prunable: null, ...w });
  return {
    calls,
    worktrees(dir) {
      calls.push(["worktrees", dir]);
      return worktrees ? worktrees.map(entry) : null;
    },
    ignoredPaths(dir) {
      calls.push(["ignoredPaths", dir]);
      return dir in ignored ? ignored[dir] : [];
    },
    countRevs(dir, args) {
      calls.push(["countRevs", dir, args.join(" ")]);
      const key = args[0];
      return key in counts ? counts[key] : 0;
    },
    refExists(dir, ref) {
      calls.push(["refExists", dir, ref]);
      return ref in refs ? refs[ref] : true;
    },
  };
}

const opts = (git = stubGit()) => ({ home, cwd: repo, root: repo, git });
const ask = (c, o = opts()) => dangerAskReason(c, o);

test("worktree force removal and a recursive rm of a .claude/worktrees folder ask, and are not denied (kgqqb)", () => {
  for (const c of DEVGUARD_ASKS) {
    assert.equal(dangerReason(c, { home, cwd: repo }), "", `expected no deny for ${JSON.stringify(c)}`);
    assert.notEqual(ask(c), "", `expected ask for ${JSON.stringify(c)}`);
  }
  assert.match(ask("git worktree remove -f .claude/worktrees/wt-1"), /ExitWorktree.*claude rm <id>.*without --force/);
  assert.match(ask("rm -rf .claude/worktrees/agent-a1"), /ExitWorktree/);
  assert.match(ask("cd .claude/worktrees && rm -rf wt-1"), /ExitWorktree/);
  assert.equal(ask("rm -rf src", { home, cwd: `${repo}/.claude/worktrees/wt-1` }), "");
});

test("a cd earlier in the command moves the directory the git probe runs in; an unknown one asks", () => {
  const wt = `${home}/WORK/other/.claude/worktrees/wt-1`;
  const worktrees = [{ path: `${home}/WORK/other` }, { path: wt }];
  const g = stubGit({ worktrees, ignored: { [wt]: [".env"] } });
  assert.match(ask("cd ../other && git worktree remove .claude/worktrees/wt-1", opts(g)), /\.env/);
  assert.deepEqual(g.calls[0], ["worktrees", `${home}/WORK/other`]);
  assert.match(ask("cd $DIR && git worktree remove .claude/worktrees/wt-1", opts()), /cannot be resolved/);
  assert.match(ask("cd - && git branch -D x", opts()), /cannot be resolved/);
});

test("mentions, plain clean removal, paths inside a worktree and non-force branch deletes do not ask", () => {
  for (const c of DEVGUARD_ASK_PASSES) assert.equal(ask(c), "", `expected no ask for ${JSON.stringify(c)}`);
});

test("only the Go table's .claude/worktrees case changes from pass to ask among the allow cases", () => {
  const asked = [...ALLOWS, ...DEVGUARD_ALLOWS].filter((c) => ask(c) !== "");
  assert.deepEqual(asked, ["rm -rf /Users/me/WORK/repo/.claude/worktrees/wt-1"]);
});

test("plain git worktree remove asks when the worktree holds ignored files other than build and cache folders (ksvxa)", () => {
  const wt = `${repo}/.claude/worktrees/wt-1`;
  const worktrees = [{ path: repo }, { path: wt, branch: "worktree/wt-1" }];
  const env = ask("git worktree remove .claude/worktrees/wt-1", opts(stubGit({ worktrees, ignored: { [wt]: [".env", "node_modules/", ".local/"] } })));
  assert.match(env, /ignored files that no commit holds \(`\.env`, `\.local\/`\)/);
  assert.equal(ask("git worktree remove .claude/worktrees/wt-1", opts(stubGit({ worktrees, ignored: { [wt]: ["node_modules/", "dist/", ".DS_Store", "target/"] } }))), "");
  assert.match(ask(`git worktree remove ${wt}`, opts(stubGit({ worktrees, ignored: { [wt]: [".env"] } }))), /\.env/);
  assert.match(ask("git worktree remove wt-1", opts(stubGit({ worktrees, ignored: { [wt]: [".env"] } }))), /\.env/);
  assert.match(ask(`git -C ${repo}/src worktree remove ../.claude/worktrees/wt-1`, opts(stubGit({ worktrees, ignored: { [wt]: [".env"] } }))), /\.env/);
  const many = Array.from({ length: 8 }, (_, i) => `f${i}.key`);
  assert.match(ask("git worktree remove wt-1", opts(stubGit({ worktrees, ignored: { [wt]: many } }))), /and 3 more/);
});

test("plain git worktree remove asks when its detached HEAD holds commits no ref contains", () => {
  const wt = `${repo}/.claude/worktrees/wt-2`;
  const head = "0123456789abcdef0123456789abcdef01234567";
  const worktrees = [{ path: repo }, { path: wt, detached: true, head }];
  const g = stubGit({ worktrees, counts: { [head]: 2 } });
  assert.match(ask("git worktree remove .claude/worktrees/wt-2", opts(g)), /2 commits reachable only from its detached HEAD `0123456789ab`/);
  assert.deepEqual(g.calls.find((c) => c[0] === "countRevs"), ["countRevs", repo, `${head} --not --branches --tags --remotes`]);
  assert.equal(ask("git worktree remove .claude/worktrees/wt-2", opts(stubGit({ worktrees, counts: { [head]: 0 } }))), "");
  const both = ask("git worktree remove .claude/worktrees/wt-2", opts(stubGit({ worktrees, counts: { [head]: 1 }, ignored: { [wt]: [".env"] } })));
  assert.match(both, /`\.env`.* and 1 commit reachable/);
});

test("git worktree remove passes for the main worktree, an unknown path and a prunable record, and asks when a probe fails", () => {
  const wt = `${repo}/.claude/worktrees/wt-3`;
  const worktrees = [{ path: repo }, { path: wt }];
  assert.equal(ask(`git worktree remove ${repo}`, opts(stubGit({ worktrees, ignored: { [repo]: [".env"] } }))), "");
  assert.equal(ask("git worktree remove .claude/worktrees/missing", opts(stubGit({ worktrees }))), "");
  assert.equal(ask("git worktree remove .claude/worktrees/wt-3", opts(stubGit({ worktrees: [{ path: repo }, { path: wt, prunable: "gitdir file points to non-existent location" }], ignored: { [wt]: null } }))), "");
  assert.match(ask("git worktree remove .claude/worktrees/wt-3", opts(stubGit({ worktrees: null }))), /could not check.*`git worktree list` failed/);
  assert.match(ask("git worktree remove .claude/worktrees/wt-3", opts(stubGit({ worktrees, ignored: { [wt]: null } }))), /`git ls-files --ignored` failed/);
  const head = "abcdef";
  assert.match(ask("git worktree remove .claude/worktrees/wt-3", opts(stubGit({ worktrees: [{ path: repo }, { path: wt, detached: true, head }], counts: { [head]: null } }))), /`git rev-list` failed/);
  assert.match(ask("git worktree remove $WT", opts()), /variable/);
  assert.match(ask("git worktree remove .claude/worktrees/wt-3", { home, cwd: "", git: stubGit({ worktrees }) }), /cannot be resolved/);
  assert.match(ask("git worktree remove .claude/worktrees/wt-3", { home, cwd: repo, git: null }), /git is not available/);
  assert.match(ask("git --git-dir=/x/.git worktree remove wt-3", opts()), /--git-dir/);
});

test("Windows paths: a backslash cwd with a drive letter matches the forward-slash paths git prints", () => {
  const winRepo = "C:\\Users\\me\\WORK\\repo";
  const wt = "C:/Users/me/WORK/repo/.claude/worktrees/wt-1";
  const worktrees = [{ path: "C:/Users/me/WORK/repo" }, { path: wt }];
  const g = stubGit({ worktrees, ignored: { [wt]: [".env"] } });
  const win = { home: "C:\\Users\\me", cwd: winRepo, root: winRepo, git: g };
  assert.match(dangerAskReason("git worktree remove .claude/worktrees/wt-1", win), /`\.env`/);
  assert.deepEqual(g.calls[0], ["worktrees", "C:/Users/me/WORK/repo"]);
  assert.match(dangerAskReason("git worktree remove C:/Users/me/WORK/repo/.claude/worktrees/wt-1", win), /`\.env`/);
  assert.match(dangerAskReason("cd .claude/worktrees && rm -rf wt-1", win), /ExitWorktree/);
  assert.match(dangerAskReason('rm -rf "C:\\Users\\me\\WORK\\repo\\.claude\\worktrees\\wt-1"', win), /ExitWorktree/);
  assert.equal(dangerAskReason("rm -rf src", { ...win, cwd: `${winRepo}\\.claude\\worktrees\\wt-1` }), "");
});

test("git branch -D asks when the branch has commits on no remote; a protected branch stays denied", () => {
  const g = stubGit({ counts: { "refs/heads/feature/x": 3 } });
  assert.match(ask("git branch -D feature/x", opts(g)), /`git branch -D feature\/x` deletes 3 commits that no remote has\. Push the branch first/);
  assert.deepEqual(g.calls.filter((c) => c[0] === "countRevs"), [["countRevs", repo, "refs/heads/feature/x --not --remotes"]]);
  assert.match(ask("git branch -d --force feature/x", opts(stubGit({ counts: { "refs/heads/feature/x": 1 } }))), /1 commit that/);
  assert.match(ask("git branch --delete -f feature/x", opts(stubGit({ counts: { "refs/heads/feature/x": 1 } }))), /1 commit that/);
  assert.match(ask("git branch -D a b", opts(stubGit({ counts: { "refs/heads/b": 4 } }))), /`git branch -D b` deletes 4/);
  assert.equal(ask("git branch -D feature/x", opts(stubGit({ counts: { "refs/heads/feature/x": 0 } }))), "");
  assert.equal(ask("git branch -D gone", opts(stubGit({ refs: { "refs/heads/gone": false } }))), "");
  assert.match(ask("git branch -D x", opts(stubGit({ refs: { "refs/heads/x": null } }))), /`git rev-parse` failed/);
  assert.match(ask("git branch -D x", opts(stubGit({ counts: { "refs/heads/x": null } }))), /`git rev-list` failed/);
  assert.match(ask("git branch -D $B", opts()), /branch name/);
  assert.equal(ask("git branch -d feature/x", opts(stubGit({ counts: { "refs/heads/feature/x": 5 } }))), "");
  assert.equal(ask("git branch -D main", opts(stubGit({ counts: { "refs/heads/main": 5 } }))), "");
  assert.match(dangerReason("git branch -D main", { home }), /protected branch `main` is denied/);
  assert.equal(ask("bash -c \"git branch -D feature/x\"", opts(stubGit({ counts: { "refs/heads/feature/x": 5 } }))), "");
});

function hookRun(command, { mode = "default", env = {}, git = stubGit() } = {}) {
  const raw = JSON.stringify({ session_id: "s1", cwd: repo, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, permission_mode: mode });
  return runHook({ raw, env: isolatedEnv({ CLAUDE_PROJECT_DIR: repo, HOME: home, ...env }), deps: { git } });
}

const decisionOf = (out) => out?.hookSpecificOutput?.permissionDecision ?? "passed";

test("the hook answers ask, denies under bypassPermissions, and the escape lifts it", () => {
  for (const dgMode of ["ask", "deny-once", "warn", "off"]) assert.equal(decisionOf(hookRun("git worktree remove -f .claude/worktrees/wt-1", { env: { CLAUDE_PLUGIN_OPTION_MODE: dgMode } })), "ask", dgMode);
  const bypass = hookRun("rm -rf .claude/worktrees/wt-1", { mode: "bypassPermissions" });
  assert.equal(decisionOf(bypass), "deny");
  assert.match(bypass.hookSpecificOutput.permissionDecisionReason, /bypassPermissions.*danger_guard denies it/);
  assert.equal(decisionOf(hookRun("rm -rf .claude/worktrees/wt-1", { mode: "bypassPermissions" })), "deny");
  assert.equal(hookRun("git worktree remove -f .claude/worktrees/wt-1", { env: { CY_ALLOW_DANGER: "1" } }), null);
  assert.equal(hookRun("git worktree remove -f .claude/worktrees/wt-1", { env: { CLAUDE_PLUGIN_OPTION_DANGER_GUARD: "false" } }), null);
  assert.equal(decisionOf(hookRun("git branch -D feature/x", { git: stubGit({ counts: { "refs/heads/feature/x": 2 } }) })), "ask");
});

test("a deny in the same command wins over a danger ask", () => {
  assert.equal(decisionOf(hookRun("git worktree remove -f .claude/worktrees/wt-1; rm -rf /")), "deny");
  assert.equal(decisionOf(hookRun("git worktree remove -f .claude/worktrees/wt-1 && pkill node")), "deny");
});

test("real git: ignored files, a detached HEAD commit and an unpushed branch are found through git.mjs", () => {
  const main = join(tempDir(), "main");
  gitInit(main);
  gitCommit(main);
  writeFileSync(join(main, ".gitignore"), ".env\nnode_modules/\n");
  runGit(main, "add", ".gitignore");
  runGit(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "ignore");
  const wt = join(main, ".claude", "worktrees", "wt-1");
  runGit(main, "worktree", "add", "-q", "--detach", wt);
  const g = makeGit();
  const o = { home: "", cwd: main, root: main, git: g };
  assert.equal(dangerAskReason("git worktree remove .claude/worktrees/wt-1", o), "");
  mkdirSync(join(wt, "node_modules", "x"), { recursive: true });
  writeFileSync(join(wt, "node_modules", "x", "i.js"), "x");
  assert.equal(dangerAskReason("git worktree remove .claude/worktrees/wt-1", o), "");
  writeFileSync(join(wt, ".env"), "SECRET=1\n");
  assert.match(dangerAskReason("git worktree remove .claude/worktrees/wt-1", o), /`\.env`/);
  writeFileSync(join(wt, "f.txt"), "changed\n");
  runGit(wt, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "detached work");
  assert.match(dangerAskReason("git worktree remove .claude/worktrees/wt-1", o), /1 commit reachable only from its detached HEAD/);
  runGit(main, "branch", "feature/x");
  assert.match(dangerAskReason("git branch -D feature/x", o), /deletes 2 commits that no remote has/);
  assert.equal(dangerAskReason("git branch -D no-such-branch", o), "");
  assert.equal(g.refExists(main, "refs/heads/no-such-branch"), false);
  assert.equal(g.refExists(join(tempDir(), "nowhere"), "refs/heads/x"), null);
});
