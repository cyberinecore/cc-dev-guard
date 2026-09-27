import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "../scripts/lib/config.mjs";
import { decide } from "../scripts/lib/decide.mjs";
import { envLine, git, gitCommit, gitInit, hookInput, isolatedEnv, scopeFixture, tempDir, writeTranscript } from "./helpers.mjs";

const withTranscript = () => ({ ...defaultConfig(), readTranscript: true });

function run({ cwd, root = "", target, key, transcript = "", env = isolatedEnv(), config = transcript ? withTranscript() : defaultConfig(), extra, deps }) {
  return decide(hookInput({ cwd, target, key, transcript, extra }), { sessionRoot: root, env, config, deps });
}

function wantPass(name, v) {
  assert.equal(v.action, "pass", `${name}: want pass, got ${v.action} (${v.why})`);
}

function wantCross(name, v) {
  assert.equal(v.action, "cross", `${name}: want cross, got ${v.action} (${v.why})`);
}

test("same repo, loose dirs and gitignored targets pass; other repos cross", () => {
  const root = tempDir();
  const a = join(root, "a");
  const b = join(root, "b");
  gitInit(a);
  gitInit(b);
  writeFileSync(join(b, ".gitignore"), ".local/\n");
  symlinkSync(b, join(a, "linked"));

  wantPass("same repo", run({ cwd: a, target: join(a, "x.md") }));
  wantPass("same repo new subdir", run({ cwd: a, target: join(a, "new", "deep", "x.md") }));
  wantPass("no repo", run({ cwd: a, target: join(root, "loose", "x.md") }));
  wantPass("gitignored in other", run({ cwd: a, target: join(b, ".local", "note.md") }));

  wantCross("other repo", run({ cwd: a, target: join(b, "x.md") }));
  wantCross("via symlink", run({ cwd: a, target: join(a, "linked", "y.md") }));
  wantCross("other repo new", run({ cwd: a, target: join(b, "new", "z.md") }));
});

test("allow_ignored false makes a gitignored target in another repo cross", () => {
  const f = scopeFixture();
  writeFileSync(join(f.b, ".gitignore"), ".local/\n");
  const config = { ...defaultConfig(), allowIgnored: false };
  wantCross("ignored with allowIgnored false", run({ cwd: f.a, target: join(f.b, ".local", "n.md"), config }));
});

test("session root anchors the session repo, not the hook cwd", () => {
  const f = scopeFixture();
  wantCross("root A, cwd B, target B", run({ cwd: f.b, root: f.a, target: join(f.b, "x.md") }));
  wantPass("root A, cwd B, target A", run({ cwd: f.b, root: f.a, target: join(f.a, "x.md") }));
  wantCross("root A, cwd non-git, target B", run({ cwd: f.plain, root: f.a, target: join(f.b, "x.md") }));
  wantPass("root unset falls back to cwd B", run({ cwd: f.b, target: join(f.b, "x.md") }));
  wantPass("relative root ignored, cwd B", run({ cwd: f.b, root: "rel/dir", target: join(f.b, "x.md") }));
  wantPass("non-git session root allows all", run({ cwd: f.plain, root: f.plain, target: join(f.b, "x.md") }));
});

test("a worktree of the session repo is the same repo", () => {
  const f = scopeFixture();
  gitCommit(f.a);
  const wt = join(f.a, ".claude", "worktrees", "w1");
  git(f.a, "worktree", "add", "-q", "-b", "w1", wt);
  wantPass("worktree root, write into main checkout", run({ cwd: wt, root: wt, target: join(f.a, "x.md") }));
  wantPass("main root, write into worktree", run({ cwd: f.a, root: f.a, target: join(wt, "x.md") }));
  wantCross("worktree root, write into other repo", run({ cwd: wt, root: wt, target: join(f.b, "x.md") }));
});

test("relative targets join the hook cwd; notebook_path is checked", () => {
  const f = scopeFixture();
  wantCross("relative into B", run({ cwd: f.a, root: f.a, target: "../b/x.md" }));
  wantPass("relative inside A", run({ cwd: f.a, root: f.a, target: "new/x.md" }));
  wantCross("relative resolved against cwd, not root", run({ cwd: f.b, root: f.a, target: "x.md" }));
  wantCross("notebook_path into B", run({ cwd: f.a, root: f.a, key: "notebook_path", target: join(f.b, "n.ipynb") }));
  wantCross("relative notebook_path into B", run({ cwd: f.a, root: f.a, key: "notebook_path", target: "../b/n.ipynb" }));
  wantPass("empty target", run({ cwd: f.a, root: f.a, target: "" }));
  wantCross("NUL byte in target inside B", run({ cwd: f.a, root: f.a, target: join(f.b, "x\u0000y.md") }));
  wantCross("relative target with no absolute cwd", run({ cwd: "", root: f.a, target: "x.md" }));
});

test("every path key is checked, not only the first", () => {
  const f = scopeFixture();
  const input = hookInput({ cwd: f.a, target: join(f.a, "ok.md") });
  input.tool_input.notebook_path = join(f.b, "n.ipynb");
  wantCross("second key crosses", decide(input, { sessionRoot: f.a, env: isolatedEnv(), config: defaultConfig() }));
});

test("allowed dirs from the transcript snapshot", () => {
  const f = scopeFixture();
  const sub = join(f.b, "sub");
  const transcript = writeTranscript(envLine(sub));
  const c = (target) => run({ cwd: f.a, root: f.a, transcript, target });

  wantPass("inside allowed dir", c(join(sub, "x.md")));
  wantPass("new subdir inside allowed dir", c(join(sub, "new", "deep", "x.md")));
  wantCross("sibling of allowed dir in the same repo", c(join(f.b, "other", "x.md")));
  wantCross("prefix is separator-aware", c(join(f.b, "subx", "x.md")));

  const trailing = writeTranscript(envLine(sub + "/"));
  wantPass("trailing slash on allowed dir", run({ cwd: f.a, root: f.a, transcript: trailing, target: join(sub, "x.md") }));

  const gone = join(f.b, "gone");
  const trGone = writeTranscript(envLine(gone));
  wantPass("allowed dir that does not exist yet", run({ cwd: f.a, root: f.a, transcript: trGone, target: join(gone, "x.md") }));
  wantCross("case variant of a missing allowed dir", run({ cwd: f.a, root: f.a, transcript: trGone, target: join(f.b, "GONE", "x.md") }));

  const alias = join(f.root, "alias");
  symlinkSync(sub, alias);
  const trAlias = writeTranscript(envLine(alias));
  wantPass("allowed dir listed through a symlink", run({ cwd: f.a, root: f.a, transcript: trAlias, target: join(sub, "x.md") }));

  const open = join(f.root, "open");
  mkdirSync(open);
  symlinkSync(f.b, join(open, "esc"));
  const trOpen = writeTranscript(envLine(open));
  wantCross("symlink escaping an allowed dir into another repo", run({ cwd: f.a, root: f.a, transcript: trOpen, target: join(open, "esc", "x.md") }));
});

test("the transcript is not read unless read_transcript is on", () => {
  const f = scopeFixture();
  const transcript = writeTranscript(envLine(join(f.b, "sub")));
  let reads = 0;
  const deps = { readAllowedDirs: () => { reads += 1; return { ok: true, dirs: [] }; } };
  wantCross("default config ignores the snapshot", run({ cwd: f.a, root: f.a, transcript, target: join(f.b, "sub", "x.md"), config: defaultConfig(), deps }));
  assert.equal(reads, 0);
});

test("a case variant of an existing allowed dir follows the filesystem", () => {
  const f = scopeFixture();
  const sub = join(f.b, "sub");
  const transcript = writeTranscript(envLine(sub));
  let insensitive = true;
  try {
    statSync(join(f.b, "SUB"));
  } catch {
    insensitive = false;
  }
  const v = run({ cwd: f.a, root: f.a, transcript, target: join(f.b, "SUB", "x.md") });
  if (insensitive) wantPass("same directory on a case-insensitive filesystem", v);
  else wantCross("different directory on a case-sensitive filesystem", v);
});

test("allowed dirs unavailable never grant", () => {
  const f = scopeFixture();
  const target = join(f.b, "x.md");
  for (const [name, transcript] of [
    ["empty transcript path", ""],
    ["missing transcript", join(f.root, "absent.jsonl")],
    ["transcript without snapshot", writeTranscript(`{"type":"user","message":{"content":"hi"}}`)],
  ]) {
    const v = run({ cwd: f.a, root: f.a, transcript, target, config: withTranscript() });
    wantCross(name, v);
    assert.equal(typeof v.allowed.transcriptReason, "string", `${name}: the unreadable transcript is reported`);
    assert.deepEqual(v.allowed.dirs, [], `${name}: nothing is granted from a transcript that cannot be read`);
  }
  const v = run({ cwd: f.a, root: f.a, transcript: writeTranscript(envLine(f.b), envLine()), target });
  wantCross("removed dir no longer allows", v);
  assert.equal(v.allowed.ok, true);
  assert.deepEqual(v.allowed.dirs, []);
});

test("hub submodules pass only for a hub repo the user named", () => {
  const root = tempDir();
  const hub = join(root, "hub");
  const src = join(root, "src");
  gitInit(hub);
  gitInit(src);
  gitCommit(src);
  gitCommit(hub);
  execFileSync("git", ["-C", hub, "-c", "protocol.file.allow=always", "submodule", "add", "-q", src, "pkg"], { stdio: "ignore" });
  const sub = join(hub, "pkg", "tracked.md");
  const hubConfig = { ...defaultConfig(), hubRepos: [hub] };

  wantCross("hub -> submodule without opt-in", run({ cwd: hub, target: sub }));
  wantPass("hub -> submodule tracked file", run({ cwd: hub, target: sub, config: hubConfig }));
  wantPass("hub -> submodule new subdir", run({ cwd: hub, target: join(hub, "pkg", "new", "deep.md"), config: hubConfig }));
  wantCross("submodule -> hub", run({ cwd: join(hub, "pkg"), target: join(hub, "r.md"), config: hubConfig }));
  wantCross("submodule -> unrelated repo", run({ cwd: join(hub, "pkg"), target: join(src, "f.txt"), config: hubConfig }));
  const inRepoFile = { ...defaultConfig(), hubRepos: [] };
  mkdirSync(join(hub, ".claude"), { recursive: true });
  writeFileSync(join(hub, ".claude", "devguard.json"), JSON.stringify({ hubRepos: [hub] }));
  wantCross("a repo file cannot opt its own hub in", run({ cwd: hub, target: sub, config: inRepoFile }));
});

test("old-style submodule layout passes for a named hub", () => {
  const root = tempDir();
  const hub = join(root, "hub");
  gitInit(hub);
  gitCommit(hub);
  const sub = join(hub, "pkg");
  gitInit(sub);
  gitCommit(sub);
  const sha = git(sub, "rev-parse", "HEAD").trim();
  git(hub, "update-index", "--add", "--cacheinfo", `160000,${sha},pkg`);
  const hubConfig = { ...defaultConfig(), hubRepos: [hub] };

  wantCross("hub -> old-style submodule without opt-in", run({ cwd: hub, target: join(sub, "tracked.md") }));
  wantPass("hub -> old-style submodule", run({ cwd: hub, target: join(sub, "tracked.md"), config: hubConfig }));
  wantCross("old-style submodule -> hub", run({ cwd: sub, target: join(hub, "f.txt"), config: hubConfig }));
  const sibling = join(root, "sibling");
  gitInit(sibling);
  gitCommit(sibling);
  wantCross("hub -> unrelated repo", run({ cwd: hub, target: join(sibling, "f.txt"), config: hubConfig }));
});

test("documented allowances pass, and only those", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const cfg = env.CLAUDE_CONFIG_DIR;
  gitInit(cfg);
  mkdirSync(join(cfg, "projects", "-some-project", "memory"), { recursive: true });
  const c = (target, extra = {}, e = env) => run({ cwd: f.a, root: f.a, target, env: e, extra });

  wantPass("auto-memory dir", c(join(cfg, "projects", "-some-project", "memory", "m.md")));
  wantCross("a transcript next to the memory dir", c(join(cfg, "projects", "-some-project", "s.jsonl")));
  wantPass("plans dir", c(join(cfg, "plans", "p.md")));
  wantCross("settings file in the config dir", c(join(cfg, "settings.json")));

  const data = join(f.root, "pdata");
  gitInit(data);
  const dataVerdict = c(join(data, "x.json"), {}, { ...env, CLAUDE_PLUGIN_DATA: data });
  wantCross("devguard's own data dir", dataVerdict);
  assert.equal(dataVerdict.why, "devguard-data");
  wantPass("scratchpad dir from hook input", c(join(f.b, "scratch", "x.md"), { scratchpad_dir: join(f.b, "scratch") }));
  wantPass("background job tmp dir", c(join(f.b, "job", "tmp", "x.md"), {}, { ...env, CLAUDE_JOB_DIR: join(f.b, "job") }));
  wantCross("background job dir outside tmp", c(join(f.b, "job", "x.md"), {}, { ...env, CLAUDE_JOB_DIR: join(f.b, "job") }));
  wantPass("cowork memory override", c(join(f.b, "mem", "x.md"), {}, { ...env, CLAUDE_COWORK_MEMORY_PATH_OVERRIDE: join(f.b, "mem") }));

  writeFileSync(join(cfg, "settings.json"), JSON.stringify({ autoMemoryDirectory: join(f.b, "automem") }));
  wantPass("autoMemoryDirectory from user settings", c(join(f.b, "automem", "x.md")));

  mkdirSync(join(f.a, ".claude"), { recursive: true });
  writeFileSync(join(f.a, ".claude", "settings.json"), JSON.stringify({ autoMemoryDirectory: join(f.b, "repomem") }));
  wantCross("autoMemoryDirectory from project settings is ignored", c(join(f.b, "repomem", "x.md")));

  const extra = { ...defaultConfig(), extraAllowedDirs: [join(f.b, "shared")] };
  wantPass("extra_allowed_dirs", run({ cwd: f.a, root: f.a, target: join(f.b, "shared", "x.md"), env, config: extra }));
});

test("a tilde autoMemoryDirectory expands against HOME", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  const memRepo = join(env.HOME, "notes");
  gitInit(memRepo);
  writeFileSync(join(env.CLAUDE_CONFIG_DIR, "settings.json"), JSON.stringify({ autoMemoryDirectory: "~/notes/mem" }));
  wantPass("tilde path", run({ cwd: f.a, root: f.a, target: join(memRepo, "mem", "x.md"), env }));
});

test("writes to a devguard config file cross even in the session repo", () => {
  const f = scopeFixture();
  const v = run({ cwd: f.a, root: f.a, target: join(f.a, ".claude", "devguard.json") });
  wantCross("repo config file", v);
  assert.equal(v.why, "config-file");
  wantPass("a devguard.json outside a .claude dir is ordinary", run({ cwd: f.a, root: f.a, target: join(f.a, "devguard.json") }));
});

test("protected paths from the config cross inside the session repo", () => {
  const f = scopeFixture();
  const config = { ...defaultConfig(), protect: [join(f.a, "infra")] };
  const v = run({ cwd: f.a, root: f.a, target: join(f.a, "infra", "prod.tf"), config });
  wantCross("protected", v);
  assert.equal(v.why, "protected");
  wantPass("unprotected sibling", run({ cwd: f.a, root: f.a, target: join(f.a, "infrastructure.md"), config }));
});

test("same-repo fast path reads no transcript and spawns one git per repo", () => {
  const f = scopeFixture();
  const calls = { git: 0, transcript: 0 };
  const deps = {
    onGit: () => {
      calls.git += 1;
    },
    readAllowedDirs: () => {
      calls.transcript += 1;
      return { ok: false, reason: "not expected" };
    },
  };
  wantPass("same repo", run({ cwd: f.a, root: f.a, target: join(f.a, "x.md"), transcript: writeTranscript(envLine()), deps }));
  assert.equal(calls.transcript, 0, "same-repo write must not read the transcript");
  assert.equal(calls.git, 2, "same-repo write spawns git only for the two repo checks");
});

test("the /.vol spelling of another repo still crosses", { skip: process.platform !== "darwin" }, () => {
  const f = scopeFixture();
  const st = statSync(f.b, { bigint: true });
  const vol = join("/.vol", String(st.dev), String(st.ino));
  try {
    statSync(vol);
  } catch {
    return;
  }
  wantCross("/.vol spelling into B", run({ cwd: f.a, root: f.a, target: join(vol, "x.md") }));
});
