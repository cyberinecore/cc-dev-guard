import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { realPathOr } from "./paths.mjs";

const SAFE_CONFIG = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"];

const PASSED_ENV = ["PATH", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "XDG_CONFIG_HOME", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"];

const PATCH_EQUIVALENT_REFS = 12;
const PATCH_EQUIVALENT_BUDGET_MS = 3500;

function gitEnv() {
  const env = {};
  for (const k of PASSED_ENV) if (typeof process.env[k] === "string") env[k] = process.env[k];
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

export function makeGit(onGit) {
  const env = gitEnv();
  const run = (dir, args, timeout = 5000) => {
    onGit?.(args);
    try {
      return { ok: true, out: execFileSync("git", [...SAFE_CONFIG, "-C", dir, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout, windowsHide: true }) };
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
    dotGitTop(dir) {
      const top = dotGitAncestor(dir);
      return top ? realPathOr(top) : "";
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
    strictToplevel(dir) {
      const r = run(dir, ["rev-parse", "--show-toplevel"]);
      return r.ok && r.out.trim() ? realPathOr(r.out.trim()) : "";
    },
    ignoreState(dir, path) {
      const r = run(dir, ["check-ignore", "-q", "--", path]);
      if (r.ok) return true;
      return r.status === 1 ? false : null;
    },
    trackedUnder(dir, rel) {
      const r = run(dir, ["ls-files", "-z", "--cached", "--", rel]);
      return r.ok ? r.out.split("\0").filter(Boolean) : null;
    },
    isGitlink(top, rel) {
      const r = run(top, ["ls-files", "--stage", "-z", "--", rel]);
      if (!r.ok) return false;
      const want = rel.split(sep).join("/");
      return r.out.split("\0").some((e) => {
        const tab = e.indexOf("\t");
        return tab > 0 && e.slice(tab + 1) === want && /^160000 [0-9a-f]+ 0$/.test(e.slice(0, tab));
      });
    },
    isUntracked(top, rel) {
      const idx = run(top, ["ls-files", "-z", "--cached", "--", rel]);
      if (!idx.ok || idx.out !== "") return false;
      if (!run(top, ["rev-parse", "--verify", "-q", "HEAD"]).ok) return true;
      const head = run(top, ["ls-tree", "-z", "HEAD", "--", rel]);
      return head.ok && head.out === "";
    },
    mainRoot(dir) {
      const r = run(dir, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"]);
      if (!r.ok) return "";
      const [top, gitDir, commonDir] = r.out.replace(/\n+$/, "").split("\n");
      if (!top || !gitDir || !commonDir) return "";
      if (gitDir === commonDir) return realPathOr(top);
      const first = parseWorktreeList(run(dir, ["worktree", "list", "--porcelain"]).out)[0]?.path;
      if (!first) return realPathOr(top);
      const viaGitDir = run(dir, ["--git-dir", first, "rev-parse", "--show-toplevel"]);
      return realPathOr(viaGitDir.ok && viaGitDir.out.trim() ? viaGitDir.out.trim() : first);
    },
    worktrees(dir) {
      const r = run(dir, ["worktree", "list", "--porcelain"]);
      return r.ok ? parseWorktreeList(r.out) : null;
    },
    isAncestor(dir, a, b) {
      return run(dir, ["merge-base", "--is-ancestor", a, b]).ok;
    },
    ignoredPaths(dir, under = "") {
      const args = under ? ["ls-files", "--others", "--ignored", "--exclude-standard", "--", under] : ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"];
      const r = run(dir, args);
      return r.ok ? r.out.split("\n").filter(Boolean) : null;
    },
    countRevs(dir, args) {
      const r = run(dir, ["rev-list", "--count", ...args]);
      const n = Number(r.out.trim());
      return r.ok && r.out.trim() !== "" && Number.isInteger(n) ? n : null;
    },
    unpushedCommits(dir, ref) {
      const first = run(dir, ["rev-list", ref, "--not", "--remotes"]);
      if (!first.ok) return null;
      let left = first.out.split("\n").filter(Boolean);
      if (left.length === 0) return 0;
      const refs = run(dir, ["for-each-ref", "--format=%(refname)", "refs/remotes"]);
      if (!refs.ok) return left.length;
      const preferred = run(dir, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
      const target = preferred.ok ? preferred.out.trim() : "";
      const names = refs.out.split("\n").filter((n) => n && !n.endsWith("/HEAD"));
      const ordered = [...names.filter((n) => n === target), ...names.filter((n) => n !== target)].slice(0, PATCH_EQUIVALENT_REFS);
      const deadline = Date.now() + PATCH_EQUIVALENT_BUDGET_MS;
      for (const remote of ordered) {
        const budget = deadline - Date.now();
        if (budget < 200) break;
        const r = run(dir, ["rev-list", "--cherry-pick", "--right-only", remote + "..." + ref], Math.min(5000, budget));
        if (!r.ok) break;
        const unique = new Set(r.out.split("\n").filter(Boolean));
        left = left.filter((sha) => unique.has(sha));
        if (left.length === 0) return 0;
      }
      return left.length;
    },
    refExists(dir, ref) {
      const r = run(dir, ["rev-parse", "--verify", "--quiet", ref]);
      if (r.ok) return true;
      return r.status === 1 ? false : null;
    },
    defaultBranch(dir) {
      const r = run(dir, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
      return r.ok ? r.out.trim() : "";
    },
  };
}

export function parseWorktreeList(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || "").split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice(9), head: "", branch: "", bare: false, detached: false, locked: null, prunable: null };
      out.push(cur);
    } else if (!cur || line === "") {
      continue;
    } else if (line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "bare") cur.bare = true;
    else if (line === "detached") cur.detached = true;
    else if (line === "locked" || line.startsWith("locked ")) cur.locked = line.slice(7);
    else if (line === "prunable" || line.startsWith("prunable ")) cur.prunable = line.slice(9);
  }
  return out;
}

export function isSubmoduleOf(targetRepo, sessionRepo) {
  if (!targetRepo || !sessionRepo || targetRepo.startsWith("unverified:")) return false;
  return targetRepo.startsWith(join(sessionRepo, "modules") + sep);
}
