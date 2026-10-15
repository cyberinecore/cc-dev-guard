import { strict as assert } from "node:assert";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CACHEDIR_HEADER, isCacheDir } from "../scripts/lib/cachedir.mjs";
import { runHook } from "../scripts/lib/cli.mjs";
import { dangerReason, isCacheDirTagPath } from "../scripts/lib/dangerguard.mjs";
import { gitInit, isolatedEnv, tempDir } from "./helpers.mjs";

const home = "/Users/me";
const TAG = `${CACHEDIR_HEADER}\n# This file is a cache directory tag created by cargo.\n`;

function tagged(dir, content = TAG) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "CACHEDIR.TAG"), content);
  return dir;
}

test("isCacheDir accepts a directory whose CACHEDIR.TAG starts with the spec header", () => {
  const root = tempDir();
  assert.equal(isCacheDir(tagged(join(root, "rust-out"))), true);
  assert.equal(isCacheDir(tagged(join(root, "swift-out"), CACHEDIR_HEADER)), true);
});

test("isCacheDir rejects a missing, short, wrong or symlinked tag, a file target and a missing directory", () => {
  const root = tempDir();
  mkdirSync(join(root, "plain"));
  assert.equal(isCacheDir(join(root, "plain")), false);
  assert.equal(isCacheDir(tagged(join(root, "empty"), "")), false);
  assert.equal(isCacheDir(tagged(join(root, "short"), CACHEDIR_HEADER.slice(0, 20))), false);
  assert.equal(isCacheDir(tagged(join(root, "wrong"), CACHEDIR_HEADER.replace("8a47", "0000"))), false);
  assert.equal(isCacheDir(tagged(join(root, "late"), " " + CACHEDIR_HEADER)), false);
  const real = tagged(join(root, "real"));
  mkdirSync(join(root, "linked"));
  symlinkSync(join(real, "CACHEDIR.TAG"), join(root, "linked", "CACHEDIR.TAG"));
  assert.equal(isCacheDir(join(root, "linked")), false);
  writeFileSync(join(root, "file"), TAG);
  assert.equal(isCacheDir(join(root, "file")), false);
  assert.equal(isCacheDir(join(root, "missing")), false);
});

test("isCacheDir follows a symlinked directory to the tagged directory it names", () => {
  const root = tempDir();
  const real = tagged(join(root, "real"));
  symlinkSync(real, join(root, "alias"));
  assert.equal(isCacheDir(join(root, "alias")), true);
});

test("isCacheDir never accepts home, an ancestor of home or a path inside .git", () => {
  const root = tempDir();
  const fakeHome = tagged(join(root, "home", "me"));
  assert.equal(isCacheDir(fakeHome, { home: fakeHome }), false);
  assert.equal(isCacheDir(tagged(join(root, "home")), { home: fakeHome }), false);
  assert.equal(isCacheDir(tagged(join(root, "repo", ".git", "cache"))), false);
});

test("a recursive rm of an absolute tagged directory passes; untagged, unbalanced, globbed and climbing targets stay denied", () => {
  const tagDirs = new Set(["/Users/me/WORK/app/rust-out", "/Users/me/WORK/app/.git/swiftcache", "/Users/me/WORK/app/cache dir", "/Users/me/WORK/app/.swift-build"]);
  const isCacheDirStub = (d) => tagDirs.has(d);
  const run = (c) => dangerReason(c, { home, isCacheDir: isCacheDirStub });
  assert.equal(run("rm -rf /Users/me/WORK/app/rust-out"), "");
  assert.equal(run("rm -rf /Users/me/WORK/app/.swift-build/"), "");
  assert.equal(run("rm -rf ~/WORK/app/.swift-build"), "");
  assert.equal(run("find /Users/me/WORK/app/.swift-build -delete"), "");
  assert.match(run("rm -rf /Users/me/WORK/app/src"), /CACHEDIR\.TAG/);
  assert.notEqual(run('rm -rf "/Users/me/WORK/app/cache dir"'), "");
  assert.notEqual(run("rm -rf /Users/me/WORK/app/.swift-build/../src"), "");
  assert.notEqual(run("rm -rf /Users/me/WORK/app/.swift-build/*"), "");
  assert.notEqual(run("rm -rf /Users/me/WORK/app/.git/swiftcache"), "");
  assert.notEqual(run("rm -rf ~"), "");
  assert.notEqual(dangerReason("rm -rf /Users/me/WORK/app/rust-out", { home }), "");
});

test("a Bash command that writes a CACHEDIR.TAG is denied; reading or naming one passes", () => {
  for (const c of [
    "printf 'Signature: 8a477f597d28d172789f06886806bc55' > /x/data/CACHEDIR.TAG",
    "echo sig >> data/cachedir.tag",
    "cp /x/target/CACHEDIR.TAG /x/data/",
    "touch data/CACHEDIR.TAG",
    "tee data/CACHEDIR.TAG < tag.txt",
    "ln -s ../target/CACHEDIR.TAG data/",
  ]) assert.match(dangerReason(c, { home }), /CACHEDIR\.TAG file is denied/, c);
  for (const c of ["cat /x/target/CACHEDIR.TAG", "ls /x/target/CACHEDIR.TAG", 'git commit -m "honor CACHEDIR.TAG"', "grep -rl 'CACHEDIR.TAG > x' src"]) assert.equal(dangerReason(c, { home }), "", c);
});

test("isCacheDirTagPath matches the tag name in any case and only as the last segment", () => {
  assert.equal(isCacheDirTagPath("/x/target/CACHEDIR.TAG"), true);
  assert.equal(isCacheDirTagPath("C:\\x\\cachedir.tag"), true);
  assert.equal(isCacheDirTagPath("/x/CACHEDIR.TAG/notes.md"), false);
  assert.equal(isCacheDirTagPath(undefined), false);
});

function hook(a, tool_name, tool_input, env) {
  const raw = JSON.stringify({ session_id: "s1", cwd: a, hook_event_name: "PreToolUse", tool_name, tool_input, permission_mode: "bypassPermissions" });
  return runHook({ raw, env: { CLAUDE_PROJECT_DIR: a, ...env } });
}

test("Write, Edit, NotebookEdit and filesystem MCP writes of a CACHEDIR.TAG are denied in every devguard mode unless the escape is set", () => {
  const a = join(tempDir(), "a");
  gitInit(a);
  const target = join(a, "data", "CACHEDIR.TAG");
  for (const mode of ["ask", "off"]) {
    const env = isolatedEnv({ CLAUDE_PLUGIN_OPTION_MODE: mode });
    for (const [tool, input] of [["Write", { file_path: target, content: "x" }], ["Edit", { file_path: target, old_string: "a", new_string: "b" }], ["NotebookEdit", { notebook_path: target }], ["mcp__filesystem__write_file", { path: target, content: "x" }]]) {
      const out = hook(a, tool, input, env);
      assert.equal(out?.hookSpecificOutput?.permissionDecision, "deny", `${tool} in mode ${mode}`);
      assert.match(out.hookSpecificOutput.permissionDecisionReason, /CACHEDIR\.TAG/);
    }
  }
  assert.equal(hook(a, "Write", { file_path: target, content: "x" }, isolatedEnv({ CY_ALLOW_DANGER: "1" })), null);
  assert.equal(hook(a, "Write", { file_path: target, content: "x" }, isolatedEnv({ CLAUDE_PLUGIN_OPTION_DANGER_GUARD: "false" })), null);
  assert.equal(hook(a, "Write", { file_path: join(a, "notes.md"), content: "CACHEDIR.TAG" }, isolatedEnv()), null);
});
