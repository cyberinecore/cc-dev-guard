import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runHook } from "../scripts/lib/cli.mjs";
import { namedEnv } from "../scripts/lib/environment.mjs";
import { gitInit, isolatedEnv, tempDir } from "./helpers.mjs";

function session() {
  const a = join(tempDir(), "a");
  gitInit(a);
  return a;
}

function bash(a, command, env, mode = "default") {
  const raw = JSON.stringify({ session_id: "s1", cwd: a, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, permission_mode: mode });
  return runHook({ raw, env: { CLAUDE_PROJECT_DIR: a, ...env } });
}

const decisionOf = (out) => out?.hookSpecificOutput?.permissionDecision ?? "passed";

test("a dangerous command is denied in every permission mode and every devguard mode", () => {
  const a = session();
  for (const mode of ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"]) {
    for (const dgMode of ["ask", "deny-once", "warn", "off"]) {
      const out = bash(a, "git push --force origin main", isolatedEnv({ CLAUDE_PLUGIN_OPTION_MODE: dgMode }), mode);
      assert.equal(decisionOf(out), "deny", `${mode} / ${dgMode}`);
      assert.match(out.hookSpecificOutput.permissionDecisionReason, /force-push to protected branch `main` is denied\. cyberine-devguard denies this in every permission mode\..*CY_ALLOW_DANGER=1/);
    }
  }
});

test("a safe command and a session-repo write pass", () => {
  const a = session();
  assert.equal(bash(a, "git status && ls -la", isolatedEnv()), null);
  assert.equal(bash(a, "rm -rf node_modules", isolatedEnv()), null);
});

test("the escape variable lifts the guard, and allow_danger_env names a second one", () => {
  const a = session();
  assert.equal(bash(a, "git reset --hard HEAD~1", isolatedEnv({ CY_ALLOW_DANGER: "1" })), null);
  assert.equal(decisionOf(bash(a, "git reset --hard HEAD~1", isolatedEnv({ CY_ALLOW_DANGER: "true" }))), "deny");
  const custom = isolatedEnv({ CLAUDE_PLUGIN_OPTION_ALLOW_DANGER_ENV: "NF_ALLOW_DANGER" });
  const denied = bash(a, "git reset --hard HEAD~1", custom);
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /NF_ALLOW_DANGER=1/);
  assert.equal(bash(a, "git reset --hard HEAD~1", { ...custom, NF_ALLOW_DANGER: "1" }), null);
});

test("namedEnv carries the escape variables from the process environment", () => {
  const picked = namedEnv({ CY_ALLOW_DANGER: "1", CLAUDE_PLUGIN_OPTION_ALLOW_DANGER_ENV: "NF_ALLOW_DANGER", NF_ALLOW_DANGER: "1", OTHER: "x" });
  assert.equal(picked.CY_ALLOW_DANGER, "1");
  assert.equal(picked.NF_ALLOW_DANGER, "1");
  assert.equal(picked.OTHER, undefined);
  assert.equal(namedEnv({ CLAUDE_PLUGIN_OPTION_ALLOW_DANGER_ENV: "BAD NAME", "BAD NAME": "1" })["BAD NAME"], undefined);
});

test("an escape variable set by the repository's .claude settings env is ignored", () => {
  for (const file of ["settings.json", "settings.local.json"]) {
    const a = session();
    mkdirSync(join(a, ".claude"), { recursive: true });
    writeFileSync(join(a, ".claude", file), JSON.stringify({ env: { CY_ALLOW_DANGER: "1" } }));
    const out = bash(a, "terraform destroy -auto-approve", isolatedEnv({ CY_ALLOW_DANGER: "1" }));
    assert.equal(decisionOf(out), "deny", file);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /comes from the env block of the repository's \.claude settings and is ignored/);
  }
});

test("danger_guard false turns the guard off; a repository can only turn it on", () => {
  const a = session();
  assert.equal(bash(a, "docker system prune -af", isolatedEnv({ CLAUDE_PLUGIN_OPTION_DANGER_GUARD: "false" })), null);
  mkdirSync(join(a, ".claude"), { recursive: true });
  writeFileSync(join(a, ".claude", "cyberine-devguard.json"), JSON.stringify({ dangerGuard: false }));
  assert.equal(decisionOf(bash(a, "docker system prune -af", isolatedEnv())), "deny");
  writeFileSync(join(a, ".claude", "cyberine-devguard.json"), JSON.stringify({ dangerGuard: true }));
  assert.equal(decisionOf(bash(a, "docker system prune -af", isolatedEnv({ CLAUDE_PLUGIN_OPTION_DANGER_GUARD: "false" }))), "deny");
});

test("a repository file adds protected branches and cannot drop aws s3 deletes or name an escape", () => {
  const a = session();
  mkdirSync(join(a, ".claude"), { recursive: true });
  writeFileSync(join(a, ".claude", "cyberine-devguard.json"), JSON.stringify({ protectedBranches: ["trunk"], denyAwsS3Deletes: false, allowDangerEnv: "HOME" }));
  assert.equal(decisionOf(bash(a, "git push -f origin trunk", isolatedEnv())), "deny");
  assert.equal(decisionOf(bash(a, "git push -f origin main", isolatedEnv())), "deny");
  const out = bash(a, "aws s3 rb s3://bucket --force", isolatedEnv({ HOME: "1" }));
  assert.equal(decisionOf(out), "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /denyAwsS3Deletes false is ignored/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /allowDangerEnv is ignored/);
});

test("protected_branches and deny_aws_s3_deletes are user options", () => {
  const a = session();
  const env = isolatedEnv({ CLAUDE_PLUGIN_OPTION_PROTECTED_BRANCHES: "trunk", CLAUDE_PLUGIN_OPTION_DENY_AWS_S3_DELETES: "false" });
  assert.equal(bash(a, "git push -f origin main", env), null);
  assert.equal(decisionOf(bash(a, "git push -f origin trunk", env)), "deny");
  assert.equal(bash(a, "aws s3 rm s3://bucket/key", env), null);
});

test("the danger check runs before the write-shape check", () => {
  const a = session();
  const out = bash(a, "rm -rf /opt/app", isolatedEnv());
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /recursive rm of absolute path `\/opt\/app` is denied/);
});
