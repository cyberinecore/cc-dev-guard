import { realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { configDirOf, matchAllowance } from "./allowances.mjs";
import { defaultConfig, isClaudeSettingsFile, isConfigFile } from "./config.mjs";
import { PATH_KEYS } from "./constants.mjs";
import { isSubmoduleOf, makeGit } from "./git.mjs";
import { isUnder, resolveDir, resolveThroughAncestor } from "./paths.mjs";
import { scopeDirs } from "./sources.mjs";
import { readAllowedDirs, readRelocatedDir } from "./transcript.mjs";

const pass = (why) => ({ action: "pass", why });

export function sessionRootOf(ctxRoot, cwd) {
  if (typeof ctxRoot === "string" && isAbsolute(ctxRoot)) return ctxRoot;
  return typeof cwd === "string" && isAbsolute(cwd) ? cwd : "";
}

export function decide(input, ctx = {}) {
  const env = ctx.env || {};
  const config = ctx.config || defaultConfig();
  const deps = ctx.deps || {};
  const git = deps.git || makeGit(deps.onGit);
  const readDirs = deps.readAllowedDirs || readAllowedDirs;
  const readScope = deps.scopeDirs || scopeDirs;
  const cwd = typeof input?.cwd === "string" ? input.cwd : "";
  const sessionRoot = sessionRootOf(ctx.sessionRoot, cwd);
  const toolInput = input?.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};

  let session = null;
  const sessionInfo = () => {
    if (!session) session = { root: sessionRoot, repo: sessionRoot ? git.commonDir(sessionRoot) : "" };
    return session;
  };

  let last = pass("no-path");
  for (const key of PATH_KEYS) {
    const raw = toolInput[key];
    if (typeof raw !== "string" || raw === "") continue;
    const v = judge(raw, { input, env, config, git, readDirs, readScope, cwd, sessionInfo, deps });
    if (v.action === "cross") return v;
    last = v;
  }
  return last;
}

function isTranscript(resolved, configDir) {
  const projects = join(configDir, "projects");
  return resolved.endsWith(".jsonl") && isUnder(resolved, projects);
}

export function allowedDirsFor({ input, env, config, sessionRoot, readDirs = readAllowedDirs, readScope = scopeDirs, readRelocated = readRelocatedDir, deps = {} }) {
  if (config.readTranscript) {
    const t = readDirs(input?.transcript_path);
    const base = t.ok ? { ...t, via: "transcript" } : { ...readScope({ env, input, sessionRoot, deps }), transcriptReason: t.reason };
    return withRelocated(base, input, env, readRelocated);
  }
  return readScope({ env, input, sessionRoot, deps });
}

function withRelocated(allowed, input, env, readRelocated) {
  const path = input?.transcript_path;
  if (!allowed.ok || typeof path !== "string" || !isAbsolute(path)) return allowed;
  let resolved;
  try {
    resolved = realpathSync.native(path);
  } catch {
    return allowed;
  }
  const configDir = resolveDir(configDirOf(env));
  if (!configDir || !isTranscript(resolved, configDir)) return allowed;
  const dir = readRelocated(resolved, input?.session_id);
  if (!dir) return allowed;
  const sources = [...(allowed.sources || []), { source: "/cd", dir }];
  return { ...allowed, dirs: allowed.dirs.includes(dir) ? allowed.dirs : [...allowed.dirs, dir], sources };
}

function judge(raw, { input, env, config, git, readDirs, readScope, cwd, sessionInfo, deps }) {
  if (raw.includes("\u0000")) return { action: "cross", why: "invalid-path", target: raw.replace(/\u0000/g, "\\0") };
  let target = raw;
  if (!isAbsolute(target)) {
    if (!isAbsolute(cwd)) return { action: "cross", why: "unresolvable", target: raw };
    target = join(cwd, target);
  }
  const r = resolveThroughAncestor(target);
  if (!r) return { action: "cross", why: "unresolvable", target };

  if (isConfigFile(r.resolved) || isConfigFile(target)) return { action: "cross", why: "config-file", target };
  const configDir = resolveDir(configDirOf(env));
  if (isClaudeSettingsFile(r.resolved, configDir) || isClaudeSettingsFile(target, configDir)) return { action: "cross", why: "settings-file", target };
  if (isTranscript(r.resolved, configDir)) return { action: "cross", why: "transcript", target };
  if (isAbsolute(env.CLAUDE_PLUGIN_DATA || "") && isUnder(r.resolved, resolveDir(env.CLAUDE_PLUGIN_DATA))) return { action: "cross", why: "devguard-data", target };
  for (const p of config.protect || []) {
    if (isUnder(r.resolved, resolveDir(p))) return { action: "cross", why: "protected", target };
  }

  const s = sessionInfo();
  if (!s.root) return pass("no-session-root");
  if (!s.repo) return pass("non-git-session");

  const targetRepo = git.commonDir(r.dir);
  if (!targetRepo) return pass("non-git-target");
  let why = "cross-repo";
  if (targetRepo === s.repo) {
    if (!config.isolateWorktrees) return pass("same-repo");
    const ownTop = git.toplevel(s.root);
    const mainTop = git.mainRoot ? git.mainRoot(s.root) : "";
    if (!mainTop || ownTop === mainTop || git.toplevel(r.dir) === ownTop) return pass("same-repo");
    why = "other-worktree";
  }

  const allowance = matchAllowance(r.resolved, { env, input, config, sessionRoot: s.root, git });
  if (allowance) return pass(`allowance:${allowance}`);

  const sessionTop = git.toplevel(s.root);
  if (why === "cross-repo" && (config.hubRepos || []).some((h) => resolveDir(h) === sessionTop)) {
    const targetTop = git.toplevel(r.dir);
    const rel = targetTop ? relative(sessionTop, targetTop) : "";
    const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
    if (inside && (isSubmoduleOf(targetRepo, s.repo) || git.isGitlink(sessionTop, rel))) return pass("hub-submodule");
  }

  if (why === "cross-repo" && config.allowIgnoredNestedRepos && sessionTop) {
    const targetTop = git.toplevel(r.dir);
    const rel = targetTop ? relative(sessionTop, targetTop) : "";
    const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
    if (inside && git.isIgnored(sessionTop, targetTop)) return pass("ignored-nested-repo");
  }

  if (config.allowIgnored && git.isIgnored(r.dir, r.resolved)) return pass("ignored");

  const allowed = allowedDirsFor({ input, env, config, sessionRoot: s.root, readDirs, readScope, deps });
  if (allowed.ok && allowed.dirs.some((d) => isUnder(r.resolved, d))) return pass("allowed-dir");

  return {
    action: "cross",
    why,
    target,
    resolved: r.resolved,
    targetRepo,
    targetTop: git.toplevel(r.dir),
    sessionTop,
    allowed,
  };
}
