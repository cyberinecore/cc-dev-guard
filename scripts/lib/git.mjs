import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { realPathOr } from "./paths.mjs";

const SAFE_CONFIG = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"];

const PASSED_ENV = ["PATH", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "XDG_CONFIG_HOME", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"];

function gitEnv() {
  const env = {};
  for (const k of PASSED_ENV) if (typeof process.env[k] === "string") env[k] = process.env[k];
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

export function makeGit(onGit) {
  const env = gitEnv();
  const run = (dir, args) => {
    onGit?.(args);
    try {
      return { ok: true, out: execFileSync("git", [...SAFE_CONFIG, "-C", dir, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, windowsHide: true }) };
    } catch (e) {
      return { ok: false, status: typeof e.status === "number" ? e.status : null, out: "" };
    }
  };

  const dotGitAncestor = (dir) => {
    let cur = dir;
    for (;;) {
      if (existsSync(join(cur, ".git"))) return cur;
      const parent = dirname(cur);
      if (parent === cur) return "";
      cur = parent;
    }
  };

  return {
    commonDir(dir) {
      const r = run(dir, ["rev-parse", "--git-common-dir"]);
      if (r.ok && r.out.trim()) return realPathOr(resolve(dir, r.out.trim()));
      const top = dotGitAncestor(dir);
      return top ? "unverified:" + realPathOr(top) : "";
    },
    toplevel(dir) {
      const r = run(dir, ["rev-parse", "--show-toplevel"]);
      if (r.ok && r.out.trim()) return realPathOr(r.out.trim());
      const top = dotGitAncestor(dir);
      return top ? realPathOr(top) : "";
    },
    isIgnored(dir, path) {
      return run(dir, ["check-ignore", "-q", "--", path]).ok;
    },
    isGitlink(top, rel) {
      const r = run(top, ["ls-files", "--stage", "--", rel]);
      return r.ok && r.out.trimStart().startsWith("160000 ");
    },
  };
}

export function isSubmoduleOf(targetRepo, sessionRepo) {
  if (!targetRepo || !sessionRepo || targetRepo.startsWith("unverified:")) return false;
  return targetRepo.startsWith(join(sessionRepo, "modules") + sep);
}
