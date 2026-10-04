import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { findWrites } from "../scripts/lib/bashguard.mjs";
import { runHook } from "../scripts/lib/cli.mjs";
import { isolatedEnv, scopeFixture } from "./helpers.mjs";

const writes = (c) => findWrites(c, { cwd: "/s", home: "/h" }).map((f) => f.how + ":" + f.target);
const r = (p) => resolve(p);

test("obvious Bash write shapes are found with their targets", () => {
  assert.deepEqual(writes("echo hi > ../b/x.txt"), ["redirect:" + r("/b/x.txt")]);
  assert.deepEqual(writes("echo a >> log.txt; make &>all.log"), ["redirect:" + r("/s/log.txt"), "redirect:" + r("/s/all.log")]);
  assert.deepEqual(writes("ls 2>&1 | tee -a out.log other.log"), ["tee:" + r("/s/out.log"), "tee:" + r("/s/other.log")]);
  assert.deepEqual(writes(`sed -i "" s/a/b/ f1 f2; sed -i.bak -e s/a/b/ g1`), ["sed -i:" + r("/s/f1"), "sed -i:" + r("/s/f2"), "sed -i:" + r("/s/g1")]);
  assert.deepEqual(writes("cp -r a b ../dest; mv x y; install -t /opt/d f"), ["cp:" + r("/dest"), "mv:" + r("/s/y"), "install:" + r("/opt/d")]);
  assert.deepEqual(writes("cd ../b && git commit -m x; git -C /r2 add ."), ["git:" + r("/b"), "git:" + r("/r2")]);
  assert.deepEqual(writes("touch t1; mkdir -p d1/d2; rm -rf r1; dd if=/dev/zero of=img bs=1"), ["touch:" + r("/s/t1"), "mkdir:" + r("/s/d1/d2"), "rm:" + r("/s/r1"), "dd:" + r("/s/img")]);
  assert.deepEqual(writes("printf x > ~/notes.md"), ["redirect:" + r("/h/notes.md")]);
});

test("reads, fd duplications, /dev targets, remote copies, variables and heredoc bodies are not writes", () => {
  for (const c of [
    "cat a.txt; grep x < in.txt; git status; git -C /r log",
    "cmd 2>/dev/null >&2 2>&1",
    "sed s/a/b/ file.txt",
    "rsync -av src/ host:/remote/path",
    `cp a "$X"; echo > $OUT; tee $(mktemp)`,
    "cat <<'EOF' | wc -l\nrm -rf /etc\ngit -C /x commit -m y\necho > /b/z\nEOF",
    "echo 'touch /b/quoted' # > /b/commented",
  ]) assert.deepEqual(writes(c), [], c);
  assert.deepEqual(writes("cat > /tmp/f <<EOF\nrm -rf /etc\nEOF\necho done >> log.txt"), ["redirect:" + r("/tmp/f"), "redirect:" + r("/s/log.txt")]);
});

const bash = (command, cwd, extra = {}) => JSON.stringify({ session_id: "s1", cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, ...extra });

test("the Bash hook asks for a write into another repository and stays silent inside the session's scope", () => {
  const f = scopeFixture();
  const env = isolatedEnv({ CLAUDE_PROJECT_DIR: f.a });
  const out = runHook({ raw: bash(`echo x > ${JSON.stringify(join(f.b, "x.md"))}`, f.a), env });
  assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /written by a Bash redirect/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\/add-dir /);
  const bypass = runHook({ raw: bash(`cp a.txt ${JSON.stringify(f.b)}`, f.a, { permission_mode: "bypassPermissions" }), env });
  assert.equal(bypass.hookSpecificOutput.permissionDecision, "deny", "a directory destination is judged by its own repository");
  assert.equal(runHook({ raw: bash(`git -C ${JSON.stringify(f.b)} commit -m x`, f.a), env }).hookSpecificOutput.permissionDecision, "ask");
  assert.equal(runHook({ raw: bash("echo x > notes.md && git add notes.md", f.a), env }), null, "same repository");
  assert.equal(runHook({ raw: bash(`echo x > ${JSON.stringify(join(f.plain, "x.md"))}`, f.a), env }), null, "non-git target");
  assert.equal(runHook({ raw: bash("ls -la && cat x", f.a), env }), null, "no write shape");
  assert.equal(runHook({ raw: bash(`echo x > ${JSON.stringify(join(f.b, "x.md"))}`, f.a), env: { ...env, CLAUDE_PLUGIN_OPTION_BASH_GUARD: "false" } }), null, "bash_guard off");
  assert.ok(runHook({ raw: bash(`echo x > ${JSON.stringify(join(f.b, "x.md"))}`, f.a), env: { ...env, CLAUDE_PLUGIN_OPTION_MODE: "warn" } }).systemMessage, "warn mode");
});

test("cp, mv, ln, install and rsync onto a transcript, settings or guard file ask like a redirect does", () => {
  const f = scopeFixture();
  const env = isolatedEnv({ CLAUDE_PROJECT_DIR: f.a });
  const project = join(env.CLAUDE_CONFIG_DIR, "projects", "-x");
  mkdirSync(project, { recursive: true });
  const transcript = join(project, "s1.jsonl");
  writeFileSync(transcript, "{}\n");
  mkdirSync(join(f.a, ".claude"), { recursive: true });
  const settings = join(f.a, ".claude", "settings.local.json");
  const guard = join(f.a, ".claude", "cyberine-devguard.json");
  for (const [cmd, target, why] of [
    ["cp /tmp/forged.jsonl", transcript, /transcript/],
    ["mv /tmp/forged.jsonl", transcript, /transcript/],
    ["ln -sf /tmp/forged.jsonl", transcript, /transcript/],
    ["install -m 600 /tmp/forged.jsonl", transcript, /transcript/],
    ["rsync /tmp/forged.jsonl", transcript, /transcript/],
    ["cp /tmp/s.json", settings, /settings file/],
    ["cp /tmp/g.json", guard, /configuration file/],
  ]) {
    const out = runHook({ raw: bash(`${cmd} ${JSON.stringify(target)}`, f.a), env });
    assert.equal(out?.hookSpecificOutput?.permissionDecision, "ask", `${cmd} -> ${target}`);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, why, cmd);
  }
  assert.equal(runHook({ raw: bash("cp a.txt ./", f.a), env }), null, "a plain directory destination in the session repository stays silent");
});

test("a Bash write to a settings file asks even inside the session repository", () => {
  const f = scopeFixture();
  mkdirSync(join(f.a, ".claude"), { recursive: true });
  const out = runHook({ raw: bash("echo '{}' > .claude/settings.local.json", f.a), env: isolatedEnv({ CLAUDE_PROJECT_DIR: f.a }) });
  assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /settings file/);
});

test("a repository file cannot switch the Bash guard off", () => {
  const f = scopeFixture();
  mkdirSync(join(f.a, ".claude"), { recursive: true });
  writeFileSync(join(f.a, ".claude", "cyberine-devguard.json"), JSON.stringify({ bashGuard: false }));
  const out = runHook({ raw: bash(`echo x > ${JSON.stringify(join(f.b, "x.md"))}`, f.a), env: isolatedEnv({ CLAUDE_PROJECT_DIR: f.a }) });
  assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /bashGuard false is ignored/);
});
