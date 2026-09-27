import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig, loadConfig } from "../scripts/lib/config.mjs";
import { decide } from "../scripts/lib/decide.mjs";
import { git, gitInit, hookInput, isolatedEnv, scopeFixture, tempDir } from "./helpers.mjs";

function run({ cwd, root = cwd, target, env = isolatedEnv(), config = defaultConfig() }) {
  return decide(hookInput({ cwd, target }), { sessionRoot: root, env, config });
}

test("dot-dot segments are collapsed before the repo check", () => {
  const f = scopeFixture();
  const v = run({ cwd: f.a, target: join(f.a, "..", "b", "x.md") });
  assert.equal(v.action, "cross");
  assert.equal(run({ cwd: f.a, target: `${f.a}/sub/../x.md` }).action, "pass");
});

test("GIT_DIR and GIT_WORK_TREE in the hook environment cannot redirect the repo check", () => {
  const f = scopeFixture();
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  process.env.GIT_DIR = join(f.a, ".git");
  process.env.GIT_WORK_TREE = f.a;
  try {
    assert.equal(run({ cwd: f.a, target: join(f.b, "x.md") }).action, "cross");
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("a target repo's core.fsmonitor command never runs", { skip: process.platform === "win32" }, () => {
  const f = scopeFixture();
  const marker = join(tempDir(), "fsmonitor-ran");
  writeFileSync(join(f.b, "tracked.md"), "x\n");
  git(f.b, "add", "tracked.md");
  git(f.b, "config", "core.fsmonitor", `touch ${marker}`);
  assert.equal(run({ cwd: f.a, target: join(f.b, "tracked.md") }).action, "cross");
  assert.equal(existsSync(marker), false);
});

test("a repo git cannot read still counts as a repo", () => {
  const f = scopeFixture();
  const broken = join(f.root, "broken");
  mkdirSync(broken);
  writeFileSync(join(broken, ".git"), "gitdir: /nonexistent/elsewhere\n");
  const v = run({ cwd: f.a, target: join(broken, "x.md") });
  assert.equal(v.action, "cross");
  assert.match(v.targetRepo, /^unverified:/);
});

test("Claude Code settings files always cross, in any repo", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  for (const target of [join(f.a, ".claude", "settings.json"), join(f.a, ".claude", "settings.local.json"), join(env.CLAUDE_CONFIG_DIR, "settings.json")]) {
    const v = run({ cwd: f.a, target, env });
    assert.equal(v.action, "cross", target);
    assert.equal(v.why, "settings-file", target);
  }
  assert.equal(run({ cwd: f.a, target: join(f.a, "config", "settings.json") }).action, "pass");
});

test("session transcripts always cross", () => {
  const f = scopeFixture();
  const env = isolatedEnv();
  const v = run({ cwd: f.a, target: join(env.CLAUDE_CONFIG_DIR, "projects", "-x", "abc.jsonl"), env });
  assert.equal(v.why, "transcript");
});

test("a repository's settings env cannot loosen devguard options", () => {
  const root = tempDir();
  gitInit(root);
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ env: { CLAUDE_PLUGIN_OPTION_MODE: "off", CLAUDE_PLUGIN_OPTION_EXTRA_ALLOWED_DIRS: "/other", CLAUDE_PLUGIN_OPTION_ALLOW_IGNORED: "false" } }));
  const env = { CLAUDE_PLUGIN_OPTION_MODE: "off", CLAUDE_PLUGIN_OPTION_EXTRA_ALLOWED_DIRS: "/other", CLAUDE_PLUGIN_OPTION_ALLOW_IGNORED: "false" };
  const c = loadConfig({ env, sessionRoot: root });
  assert.equal(c.mode, "ask");
  assert.deepEqual(c.extraAllowedDirs, []);
  assert.equal(c.allowIgnored, false, "tightening from the repo still applies");
  assert.ok(c.warnings.some((w) => w.includes("CLAUDE_PLUGIN_OPTION_MODE")));
  assert.ok(c.warnings.some((w) => w.includes("CLAUDE_PLUGIN_OPTION_EXTRA_ALLOWED_DIRS")));
});

test("other spellings of another repo still cross", () => {
  const f = scopeFixture();
  const cafe = join(f.b, "café");
  mkdirSync(cafe);
  let insensitive = true;
  try {
    statSync(join(f.root, "B"));
  } catch {
    insensitive = false;
  }
  if (insensitive) assert.equal(run({ cwd: f.a, target: join(f.root, "B", "x.md") }).action, "cross", "case variant");
  const nfd = join(f.b, "café");
  let normInsensitive = true;
  try {
    statSync(nfd);
  } catch {
    normInsensitive = false;
  }
  if (normInsensitive) assert.equal(run({ cwd: f.a, target: join(nfd, "x.md") }).action, "cross", "NFD spelling");
  assert.equal(run({ cwd: f.a, target: `${f.root}//b///x.md` }).action, "cross", "doubled separators");
  if (process.platform === "darwin") {
    for (const prefix of ["/.nofollow", "/.resolve/1"]) {
      let ok = true;
      try {
        statSync(prefix + f.b);
      } catch {
        ok = false;
      }
      if (ok) assert.equal(run({ cwd: f.a, target: `${prefix}${f.b}/x.md` }).action, "cross", prefix);
    }
  }
});
