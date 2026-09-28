import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FALLBACK_MARKER_DIR, NAME, VERSION } from "../scripts/lib/constants.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);

test("versions agree across plugin.json, package.json and VERSION", () => {
  assert.equal(readJson(".claude-plugin/plugin.json").version, VERSION);
  assert.equal(readJson("package.json").version, VERSION);
});

test("the manifest carries the metadata the directory reads", () => {
  const m = readJson(".claude-plugin/plugin.json");
  assert.equal(m.name, NAME);
  assert.match(m.name, /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);
  for (const key of ["description", "version", "license", "homepage", "repository"]) assert.ok(m[key], `plugin.json ${key}`);
  assert.ok(m.author?.name, "plugin.json author.name");
  assert.equal(m.hooks, undefined, "hooks/hooks.json loads automatically and must not be listed");
  for (const s of [m.displayName, m.author.name]) assert.match(s, /^[\x20-\x7e]+$/, "ASCII only");
  const market = readJson(".claude-plugin/marketplace.json");
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, NAME);
  assert.equal(market.plugins[0].source, "./");
});

test("userConfig options are well-formed", () => {
  const { userConfig } = readJson(".claude-plugin/plugin.json");
  const allowed = new Set(["type", "title", "description", "required", "default", "multiple", "sensitive", "min", "max"]);
  for (const [key, opt] of Object.entries(userConfig)) {
    assert.match(key, /^[a-z_][a-z0-9_]*$/, `${key} becomes CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`);
    for (const k of Object.keys(opt)) assert.ok(allowed.has(k), `${key}.${k} is not a userConfig field`);
    for (const k of ["type", "title", "description"]) assert.ok(opt[k] !== undefined, `${key}.${k}`);
  }
  assert.equal(userConfig.mode.default, "ask");
});

test("hooks.json runs node on a file inside the plugin, exec form, with a timeout", () => {
  const h = readJson("hooks/hooks.json");
  assert.deepEqual(Object.keys(h), ["hooks"]);
  assert.deepEqual(Object.keys(h.hooks).sort(), ["DirectoryAdded", "PreToolUse", "SessionStart"]);
  assert.deepEqual(h.hooks.DirectoryAdded[0].hooks[0].args, ["${CLAUDE_PLUGIN_ROOT}/scripts/devguard.mjs", "directory-added"]);
  const [start] = h.hooks.SessionStart[0].hooks;
  assert.equal(start.command, "node");
  assert.deepEqual(start.args, ["${CLAUDE_PLUGIN_ROOT}/scripts/devguard.mjs", "session-start"]);
  const entries = h.hooks.PreToolUse;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].matcher, "Write|Edit|NotebookEdit");
  const [cmd] = entries[0].hooks;
  assert.equal(cmd.type, "command");
  assert.equal(cmd.command, "node");
  assert.deepEqual(cmd.args, ["${CLAUDE_PLUGIN_ROOT}/scripts/devguard.mjs", "hook"]);
  assert.ok(existsSync(join(root, "scripts", "devguard.mjs")));
  assert.ok(Number.isInteger(cmd.timeout) && cmd.timeout > 0);
});

test("README and LICENSE satisfy the directory", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8").replace(/```[\s\S]*?```/g, "");
  assert.ok(readme.split(/\s+/).filter(Boolean).length >= 40, "README has at least 40 words outside code blocks");
  assert.match(readFileSync(join(root, "LICENSE"), "utf8"), /MIT License/);
});

test("tracked files follow the directory's file rules", () => {
  assert.ok(tracked.length <= 512, `${tracked.length} files`);
  const seen = new Map();
  const device = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
  for (const f of tracked) {
    assert.ok(!f.startsWith("bin/"), "no top-level bin/");
    assert.ok(!/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(\/|$)/.test(f), `system file ${f}`);
    assert.ok(!/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|bun\.lockb?|\.npmrc|bunfig\.toml|uv\.toml)$/.test(f), `lockfile or registry config ${f}`);
    for (const part of f.split("/")) {
      assert.ok(!/[:<>"|?*\\]/.test(part), `invalid character in ${f}`);
      assert.ok(!/[. ]$/.test(part), `trailing dot or space in ${f}`);
      assert.ok(!device.test(part), `device name in ${f}`);
    }
    const lower = f.toLowerCase();
    assert.ok(!seen.has(lower) || seen.get(lower) === f, `case-only duplicate ${f} vs ${seen.get(lower)}`);
    seen.set(lower, f);
    const p = join(root, f);
    if (!existsSync(p)) continue;
    assert.ok(!lstatSync(p).isSymbolicLink(), `symlink ${f}`);
    const isImage = /\.(png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/i.test(f);
    if (!isImage) assert.ok(statSync(p).size < 256 * 1024, `${f} is over 256 KiB`);
    if (!isImage) assert.ok(!readFileSync(p).includes(0), `${f} is binary`);
  }
});

test("no .gitattributes rewrites content", () => {
  for (const f of tracked.filter((t) => basename(t) === ".gitattributes")) {
    assert.ok(!/export-ignore|export-subst|filter/.test(readFileSync(join(root, f), "utf8")), f);
  }
});

test("skills have front matter with a single-string description", () => {
  const skills = tracked.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f));
  assert.ok(skills.length >= 2, "status and help skills exist");
  for (const f of skills) {
    const text = readFileSync(join(root, f), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    assert.ok(fm, `${f} has front matter`);
    const desc = /^description: (.+)$/m.exec(fm[1]);
    assert.ok(desc && desc[1].trim().length > 0 && !desc[1].trim().startsWith("-") && !desc[1].trim().startsWith("["), `${f} description is one string`);
    const name = /^name: (.+)$/m.exec(fm[1]);
    assert.equal(name?.[1].trim(), basename(dirname(f)), `${f} name matches its folder`);
  }
});

test("no root CLAUDE.md (strict validation rejects it)", () => {
  assert.ok(!tracked.includes("CLAUDE.md"));
});

test("the fallback marker directory follows the plugin name", () => {
  assert.equal(FALLBACK_MARKER_DIR, NAME + "-markers");
});
