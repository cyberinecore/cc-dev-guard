import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig, isConfigFile, loadConfig } from "../scripts/lib/config.mjs";
import { gitInit, tempDir } from "./helpers.mjs";

function repoWithConfig(content) {
  const root = tempDir();
  const repo = join(root, "repo");
  gitInit(repo);
  if (content !== undefined) {
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude", "cyberine-devguard.json"), typeof content === "string" ? content : JSON.stringify(content));
  }
  return repo;
}

test("defaults", () => {
  const c = loadConfig({ env: {}, sessionRoot: repoWithConfig() });
  const d = defaultConfig();
  assert.equal(c.mode, "ask");
  assert.equal(c.allowIgnored, true);
  assert.equal(c.logDecisions, false);
  assert.deepEqual(c.extraAllowedDirs, []);
  assert.deepEqual(c.hubRepos, []);
  assert.deepEqual(c.protect, []);
  assert.deepEqual(c.warnings, []);
  assert.equal(c.repoFile, null);
  assert.equal(d.mode, "ask");
});

test("userConfig arrives through CLAUDE_PLUGIN_OPTION_<KEY>", () => {
  const env = {
    CLAUDE_PLUGIN_OPTION_MODE: "warn",
    CLAUDE_PLUGIN_OPTION_EXTRA_ALLOWED_DIRS: "/a/one,/b/two",
    CLAUDE_PLUGIN_OPTION_HUB_REPOS: "/hub",
    CLAUDE_PLUGIN_OPTION_ALLOW_IGNORED: "false",
    CLAUDE_PLUGIN_OPTION_LOG_DECISIONS: "true",
  };
  const c = loadConfig({ env, sessionRoot: repoWithConfig() });
  assert.equal(c.mode, "warn");
  assert.deepEqual(c.extraAllowedDirs, ["/a/one", "/b/two"]);
  assert.deepEqual(c.hubRepos, ["/hub"]);
  assert.equal(c.allowIgnored, false);
  assert.equal(c.logDecisions, true);
});

test("bad userConfig values fall back to defaults with a warning", () => {
  const env = {
    CLAUDE_PLUGIN_OPTION_MODE: "yolo",
    CLAUDE_PLUGIN_OPTION_ALLOW_IGNORED: "maybe",
    CLAUDE_PLUGIN_OPTION_EXTRA_ALLOWED_DIRS: "relative/dir,,/abs",
  };
  const c = loadConfig({ env, sessionRoot: repoWithConfig() });
  assert.equal(c.mode, "ask");
  assert.equal(c.allowIgnored, true);
  assert.deepEqual(c.extraAllowedDirs, ["/abs"]);
  assert.ok(c.warnings.some((w) => w.includes("yolo")));
  assert.ok(c.warnings.some((w) => w.includes("maybe")));
  assert.ok(c.warnings.some((w) => w.includes("relative/dir")));
});

test("the repo file is found at or above the session root", () => {
  const repo = repoWithConfig({ mode: "ask" });
  const deep = join(repo, "a", "b");
  mkdirSync(deep, { recursive: true });
  const c = loadConfig({ env: { CLAUDE_PLUGIN_OPTION_MODE: "warn" }, sessionRoot: deep });
  assert.equal(c.repoFile, join(repo, ".claude", "cyberine-devguard.json"));
  assert.equal(c.mode, "ask");
});

test("the repo file may only tighten", () => {
  const repo = repoWithConfig({ mode: "off", allowIgnored: true, extraAllowedDirs: ["/x"], hubRepos: ["/y"], protect: ["infra", "../escape", "/abs"], colour: "red" });
  const c = loadConfig({ env: { CLAUDE_PLUGIN_OPTION_MODE: "deny-once", CLAUDE_PLUGIN_OPTION_ALLOW_IGNORED: "false" }, sessionRoot: repo });
  assert.equal(c.mode, "deny-once", "off from a repo file is rejected");
  assert.equal(c.allowIgnored, false, "a repo file cannot turn allowIgnored back on");
  assert.deepEqual(c.extraAllowedDirs, []);
  assert.deepEqual(c.hubRepos, []);
  assert.deepEqual(c.protect, [join(repo, "infra")]);
  for (const needle of ["off", "allowIgnored", "extraAllowedDirs", "hubRepos", "../escape", "/abs", "colour"]) {
    assert.ok(c.warnings.some((w) => w.includes(needle)), `warning mentions ${needle}: ${c.warnings.join(" | ")}`);
  }
});

test("the repo file can raise the mode and turn allowIgnored off", () => {
  const repo = repoWithConfig({ mode: "ask", allowIgnored: false });
  const c = loadConfig({ env: { CLAUDE_PLUGIN_OPTION_MODE: "warn" }, sessionRoot: repo });
  assert.equal(c.mode, "ask");
  assert.equal(c.allowIgnored, false);
  assert.deepEqual(c.warnings, []);
});

test("the repo file cannot lower the mode", () => {
  const repo = repoWithConfig({ mode: "warn" });
  const c = loadConfig({ env: {}, sessionRoot: repo });
  assert.equal(c.mode, "ask");
  assert.ok(c.warnings.some((w) => w.includes("warn")));
});

test("a repo file may switch a user's off back on, since that tightens", () => {
  const repo = repoWithConfig({ mode: "ask" });
  const c = loadConfig({ env: { CLAUDE_PLUGIN_OPTION_MODE: "off" }, sessionRoot: repo });
  assert.equal(c.mode, "ask", "a repo may opt a user back in: raising is tightening");
});

test("a malformed repo file is ignored with a warning", () => {
  for (const content of ["{not json", "[1,2]", "null"]) {
    const c = loadConfig({ env: {}, sessionRoot: repoWithConfig(content) });
    assert.equal(c.mode, "ask");
    assert.ok(c.warnings.length > 0, `warning for ${content}`);
  }
});

test("isConfigFile matches .claude/cyberine-devguard.json anywhere", () => {
  assert.equal(isConfigFile("/r/.claude/cyberine-devguard.json"), true);
  assert.equal(isConfigFile("/home/u/.claude/cyberine-devguard.json"), true);
  assert.equal(isConfigFile("/r/cyberine-devguard.json"), false);
  assert.equal(isConfigFile("/r/.claude/cyberine-devguard.json.bak"), false);
});
