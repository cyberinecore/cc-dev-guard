#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const PASSED_ENV = ["PATH", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "XDG_CONFIG_HOME", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"];

export class HookError extends Error {}

function gitEnv(source) {
  const picked = {};
  for (const k of PASSED_ENV) if (typeof source[k] === "string") picked[k] = source[k];
  picked.GIT_TERMINAL_PROMPT = "0";
  return picked;
}

function realPathOr(p) {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

export function makeGit(source = process.env) {
  const env = gitEnv(source);
  const run = (dir, args) => {
    try {
      return { ok: true, out: execFileSync("git", ["-c", "core.fsmonitor=false", "-C", dir, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000, windowsHide: true }) };
    } catch {
      return { ok: false, out: "" };
    }
  };
  return {
    run,
    env,
    isRepo(dir) {
      return run(dir, ["rev-parse", "--git-dir"]).ok;
    },
    mainRoot(dir) {
      const r = run(dir, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"]);
      if (!r.ok) throw new HookError("resolving git paths in " + dir + " failed");
      const [top, gitDir, commonDir] = r.out.replace(/\n+$/, "").split("\n");
      if (!top || !gitDir || !commonDir) throw new HookError("unexpected git rev-parse output in " + dir);
      if (gitDir === commonDir) return realPathOr(top);
      const list = run(dir, ["worktree", "list", "--porcelain"]);
      const line = list.out.split("\n").find((l) => l.startsWith("worktree "));
      if (!line) return realPathOr(top);
      const first = line.slice(9);
      const viaGitDir = run(dir, ["--git-dir", first, "rev-parse", "--show-toplevel"]);
      return realPathOr(viaGitDir.ok && viaGitDir.out.trim() ? viaGitDir.out.trim() : first);
    },
  };
}

export function validName(name) {
  if (typeof name !== "string" || name === "" || name.length > 200) return false;
  return name.split("/").every((seg) => /^[A-Za-z0-9._-]+$/.test(seg) && seg !== "." && seg !== "..");
}

export function createWorktree(input, { git = makeGit(), stderrFd = 2 } = {}) {
  const name = typeof input?.name === "string" && input.name ? input.name : typeof input?.worktree_path === "string" && input.worktree_path ? basename(input.worktree_path) : "";
  const cwd = typeof input?.cwd === "string" ? input.cwd : "";
  if (!name) throw new HookError("missing .name in input");
  if (!cwd) throw new HookError("missing .cwd in input");
  if (!validName(name)) throw new HookError("worktree name " + JSON.stringify(name) + " has a character outside letters, digits, dot, underscore, dash and slash, or a . or .. segment");
  if (!isAbsolute(cwd) || !existsSync(cwd)) throw new HookError("cannot enter " + cwd);
  if (!git.isRepo(cwd)) throw new HookError(cwd + " is not a git repository");
  const root = git.mainRoot(cwd);
  const path = join(root, ".claude", "worktrees", name);
  const branch = "worktree/" + name;
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(join(path, ".git"))) return path;
  const base = typeof input?.git_ref === "string" && input.git_ref ? input.git_ref : "HEAD";
  const r = spawnSync("git", ["-C", cwd, "worktree", "add", "--no-track", "-B", branch, path, base], { env: git.env, stdio: ["ignore", stderrFd, stderrFd], timeout: 25000, windowsHide: true });
  if (r.status !== 0) throw new HookError("git worktree add failed for " + path);
  return path;
}

export function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.stderr.write("cyberine-worktree: the hook input is not valid JSON\n");
    return 1;
  }
  try {
    process.stdout.write(createWorktree(input) + "\n");
    return 0;
  } catch (e) {
    process.stderr.write("cyberine-worktree: " + (e instanceof HookError ? e.message : e && e.stack ? e.stack : String(e)) + "\n");
    return 1;
  }
}

if (process.argv[1] && realPathOr(process.argv[1]) === realPathOr(fileURLToPath(import.meta.url))) process.exitCode = main();