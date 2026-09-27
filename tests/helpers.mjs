import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempDir() {
  return realpathSync.native(mkdtempSync(join(tmpdir(), "devguard-test-")));
}

export function git(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function gitInit(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
}

export function gitCommit(dir) {
  writeFileSync(join(dir, "f.txt"), "x\n");
  git(dir, "add", ".");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
}

export function envLine(...dirs) {
  return JSON.stringify({
    type: "attachment",
    attachment: {
      type: "environment",
      snapshot: { additionalWorkingDirectories: dirs, workingDirectory: "/nowhere" },
    },
  });
}

export function writeTranscript(...lines) {
  const p = join(tempDir(), "session.jsonl");
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
}

export function writeRaw(content) {
  const p = join(tempDir(), "session.jsonl");
  writeFileSync(p, content);
  return p;
}

export function scopeFixture() {
  const root = tempDir();
  const f = { root, a: join(root, "a"), b: join(root, "b"), plain: join(root, "plain") };
  gitInit(f.a);
  gitInit(f.b);
  mkdirSync(f.plain, { recursive: true });
  mkdirSync(join(f.b, "sub"), { recursive: true });
  return f;
}

export function hookInput({ cwd, target, key = "file_path", transcript = "", session = "s1", tool = "Write", extra = {} }) {
  return {
    session_id: session,
    cwd,
    transcript_path: transcript,
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: { [key]: target },
    ...extra,
  };
}

export function isolatedEnv(overrides = {}) {
  const home = tempDir();
  return { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), ...overrides };
}
