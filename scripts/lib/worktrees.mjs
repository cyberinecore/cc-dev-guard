import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { WORKTREES_DIR } from "./bashguard.mjs";
import { isUnder, realPathOr } from "./paths.mjs";

const GH_ENV = ["PATH", "HOME", "USERPROFILE", "XDG_CONFIG_HOME", "GH_CONFIG_DIR", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "PATHEXT", "TEMP", "TMP", "TMPDIR"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".claude", "vendor", "dist", "build", ".venv"]);

function ghEnv() {
  const childEnv = {};
  for (const k of GH_ENV) if (typeof process.env[k] === "string") childEnv[k] = process.env[k];
  childEnv.GH_PROMPT_DISABLED = "1";
  childEnv.NO_COLOR = "1";
  return childEnv;
}

export function makeGh() {
  const env = ghEnv();
  return {
    prState(dir, branch) {
      try {
        const out = execFileSync("gh", ["pr", "view", branch, "--json", "state,mergedAt,number"], { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000, windowsHide: true });
        const pr = JSON.parse(out);
        return { ok: true, state: pr.state, mergedAt: pr.mergedAt || "", number: pr.number };
      } catch (e) {
        if (e && e.code === "ENOENT") return { ok: false, missing: true };
        const err = String(e?.stderr || "");
        if (/no pull requests? found/i.test(err)) return { ok: true, state: "NONE" };
        return { ok: false, reason: err.trim().split("\n")[0] || "gh failed" };
      }
    },
  };
}

export function findRepos(dir, git, depth = 3) {
  const root = git.mainRoot(dir);
  if (root) return [root];
  const out = [];
  const walk = (d, left) => {
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      const p = join(d, e.name);
      let isRepo = false;
      try {
        isRepo = statSync(join(p, ".git")).isDirectory();
      } catch {}
      if (isRepo) out.push(realPathOr(p));
      else if (left > 1) walk(p, left - 1);
    }
  };
  walk(dir, depth);
  return out.sort();
}

export function scanRepo(root, { git, gh = null }) {
  const list = git.worktrees(root);
  if (!list) return { root, error: "git worktree list failed" };
  const worktreesDir = join(root, WORKTREES_DIR);
  const base = git.defaultBranch(root);
  const findings = [];
  let ghMissing = false;
  let ghError = "";
  for (const wt of list.slice(1)) {
    const issues = [];
    if (wt.prunable !== null) issues.push(`prunable${wt.prunable ? ": " + wt.prunable : ""}`);
    else if (!existsSync(wt.path)) issues.push("directory missing");
    const real = realPathOr(wt.path);
    if (!isUnder(real, worktreesDir) && !isUnder(wt.path, worktreesDir)) issues.push("outside .claude/worktrees/");
    let merged = "";
    if (wt.branch) {
      if (gh && !ghMissing && !ghError) {
        const pr = gh.prState(root, wt.branch);
        if (pr.missing) ghMissing = true;
        else if (!pr.ok) ghError = pr.reason;
        else if (pr.state === "MERGED") merged = `merged: PR #${pr.number}${pr.mergedAt ? " at " + pr.mergedAt : ""}`;
      }
      if (!merged && base && wt.head && git.isAncestor(root, wt.head, base)) merged = `merged or empty: no commits beyond ${base}`;
      if (merged) issues.push(merged);
    }
    findings.push({ ...wt, issues });
  }
  return { root, total: list.length - 1, findings, ghMissing, ghError };
}

export function formatScan(results, { gh }) {
  const lines = [];
  let flagged = 0;
  for (const r of results) {
    if (r.error) {
      lines.push(`${r.root}: ${r.error}`);
      continue;
    }
    const bad = r.findings.filter((f) => f.issues.length);
    flagged += bad.length;
    lines.push(`${r.root}: ${r.total} linked worktree(s), ${bad.length} flagged`);
    for (const f of r.findings) {
      if (!f.issues.length) continue;
      const what = f.branch ? `[${f.branch}]` : f.detached ? "[detached]" : "";
      lines.push(`  ${f.path} ${what}`.trimEnd());
      for (const i of f.issues) lines.push(`    - ${i}`);
      if (f.locked !== null) lines.push(`    - locked${f.locked ? ": " + f.locked : ""}`);
    }
    if (r.findings.some((f) => f.issues.some((i) => i.startsWith("prunable") || i === "directory missing"))) lines.push(`  to clear records whose directory is gone: git -C "${r.root}" worktree prune`);
    if (r.ghError) lines.push(`  gh failed (${r.ghError}): merged branches were checked only against the default branch, which misses squash merges; check gh auth status for this repository's account`);
    if (r.ghMissing) lines.push("  gh not found: merged branches were checked only against the default branch, which misses squash merges");
  }
  if (!gh) lines.push("gh check skipped (--no-gh): merged branches were checked only against the default branch, which misses squash merges");
  lines.push(`${flagged} flagged worktree(s) in ${results.length} repositor${results.length === 1 ? "y" : "ies"}. Nothing was changed; remove one with git worktree remove <path> once you have checked it.`);
  return lines.join("\n");
}