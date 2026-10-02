import { strict as assert } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { runHook } from "../scripts/lib/cli.mjs";
import { mcpWriteTargets } from "../scripts/lib/mcpfs.mjs";
import { isolatedEnv, scopeFixture } from "./helpers.mjs";

test("filesystem MCP tools are matched by name and by the documented input schema", () => {
  assert.deepEqual(mcpWriteTargets("mcp__filesystem__write_file", { path: "/b/x", content: "" }), [{ path: "/b/x", isDir: false }]);
  assert.deepEqual(mcpWriteTargets("mcp__fs__edit_file", { path: "/b/x", edits: [] }), [{ path: "/b/x", isDir: false }]);
  assert.deepEqual(mcpWriteTargets("mcp__fs__edit_file", { path: "/b/x", edits: [], dryRun: true }), [], "a dry run writes nothing");
  assert.deepEqual(mcpWriteTargets("mcp__fs__create_directory", { path: "/b/d" }), [{ path: "/b/d", isDir: true }]);
  assert.deepEqual(mcpWriteTargets("mcp__fs__move_file", { source: "/b/a", destination: "/c/b" }).map((t) => t.path), ["/b/a", "/c/b"]);
  assert.equal(mcpWriteTargets("mcp__other__write_file", { file: "/b/x" }), null, "same name, different schema");
  assert.equal(mcpWriteTargets("mcp__fs__create_directory", { path: "/b/d", recursive: true }), null, "extra keys mean a different server");
  assert.equal(mcpWriteTargets("mcp__fs__read_file", { path: "/b/x" }), null);
  assert.equal(mcpWriteTargets("Write", { path: "/b/x", content: "" }), null);
});

test("an MCP filesystem write into another repository asks; inside the session repository it passes", () => {
  const f = scopeFixture();
  const env = isolatedEnv({ CLAUDE_PROJECT_DIR: f.a });
  const call = (tool, tool_input, extra = {}) => runHook({ raw: JSON.stringify({ session_id: "s", cwd: f.a, tool_name: tool, tool_input, ...extra }), env });
  assert.equal(call("mcp__filesystem__write_file", { path: join(f.b, "x.md"), content: "x" }).hookSpecificOutput.permissionDecision, "ask");
  assert.equal(call("mcp__filesystem__create_directory", { path: f.b }, { permission_mode: "bypassPermissions" }).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(call("mcp__filesystem__move_file", { source: join(f.b, "a"), destination: join(f.a, "a") }).hookSpecificOutput.permissionDecision, "ask", "moving a file out of another repository changes it");
  assert.equal(call("mcp__filesystem__write_file", { path: join(f.a, "x.md"), content: "x" }), null);
  assert.equal(call("mcp__filesystem__read_file", { path: join(f.b, "x.md") }), null);
});
