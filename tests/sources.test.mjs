import { strict as assert } from "node:assert";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cliDirs, parseAddDirs, pruneSessionRecords, recordDirectoryAdded, scopeDirs, sessionDirs, settingsDirs } from "../scripts/lib/sources.mjs";
import { isolatedEnv, tempDir } from "./helpers.mjs";

test("parseAddDirs reads every form of --add-dir", () => {
  const argv = ["claude", "-p", "--add-dir", "../b/sub", "/abs/one", "--model", "haiku", "--add-dir=/abs/two", "--add-dir", "rel", "--", "--add-dir", "/after/dashdash"];
  assert.deepEqual(parseAddDirs(argv, "/work/a"), ["/work/b/sub", "/abs/one", "/abs/two", "/work/a/rel"]);
  assert.deepEqual(parseAddDirs(["claude", "--add-dir", "rel"], ""), [], "relative entries need a launch cwd");
});

test("settings additionalDirectories come from user, project and local settings", () => {
  const env = isolatedEnv();
  const root = tempDir();
  mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(env.CLAUDE_CONFIG_DIR, "settings.json"), JSON.stringify({ permissions: { additionalDirectories: ["~/shared", "/abs/user"] } }));
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ permissions: { additionalDirectories: ["../sibling"] } }));
  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({ permissions: { additionalDirectories: ["/abs/local", 7, ""] } }));
  const got = settingsDirs({ env, sessionRoot: root });
  assert.deepEqual(got.map((e) => e.dir), [join(env.HOME, "shared"), "/abs/user", join(root, "..", "sibling"), "/abs/local"]);
  assert.deepEqual([...new Set(got.map((e) => e.source))], ["user settings", "project settings", "local settings"]);
});

test("DirectoryAdded records are per session, deduplicated, and pruned after a week", () => {
  const data = tempDir();
  const env = { CLAUDE_PLUGIN_DATA: data };
  assert.equal(recordDirectoryAdded({ session_id: "s1", directory: "/x/one" }, env), true);
  assert.equal(recordDirectoryAdded({ session_id: "s1", directory: "/x/one" }, env), true);
  assert.equal(recordDirectoryAdded({ session_id: "s1", directory: "/x/two" }, env), true);
  assert.equal(recordDirectoryAdded({ session_id: "../escape", directory: "/x" }, env), false);
  assert.equal(recordDirectoryAdded({ session_id: "s1", directory: "relative" }, env), false);
  assert.deepEqual(sessionDirs({ env, input: { session_id: "s1" } }).map((e) => e.dir), ["/x/one", "/x/two"]);
  assert.deepEqual(sessionDirs({ env, input: { session_id: "s2" } }), []);
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(join(data, "sessions", "s1.json"), old, old);
  pruneSessionRecords(env);
  assert.deepEqual(sessionDirs({ env, input: { session_id: "s1" } }), []);
});

test("cliDirs reads --add-dir from the claude process and resolves it against the launch dir", () => {
  const env = isolatedEnv({ CLAUDE_PID: "999999999", CLAUDE_PROJECT_DIR: "/launch/a" });
  mkdirSync(join(env.CLAUDE_CONFIG_DIR, "sessions"), { recursive: true });
  const deps = { processArgv: (pid) => (pid === "999999999" ? { argv: ["claude", "--add-dir", "../b"], exact: true } : null) };
  assert.deepEqual(cliDirs({ env, deps }).map((e) => e.dir), ["/launch/b"]);
  writeFileSync(join(env.CLAUDE_CONFIG_DIR, "sessions", "999999999.json"), JSON.stringify({ cwd: "/really/started/here" }));
  assert.deepEqual(cliDirs({ env, deps }).map((e) => e.dir), ["/really/started/b"]);
  assert.deepEqual(cliDirs({ env: {}, deps }), [], "no CLAUDE_PID, no CLI dirs");
});

test("scopeDirs merges, resolves and deduplicates every source", () => {
  const env = isolatedEnv({ CLAUDE_PLUGIN_DATA: tempDir() });
  const real = tempDir();
  mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  writeFileSync(join(env.CLAUDE_CONFIG_DIR, "settings.json"), JSON.stringify({ permissions: { additionalDirectories: [real] } }));
  recordDirectoryAdded({ session_id: "s", directory: real + "/" }, env);
  const r = scopeDirs({ env, input: { session_id: "s" }, sessionRoot: tempDir() });
  assert.equal(r.ok, true);
  assert.deepEqual(r.dirs, [real]);
  assert.equal(r.sources.length, 2);
});
