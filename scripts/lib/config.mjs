import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { DEFAULT_MODE, MODES, OPTION_PREFIX, REPO_CONFIG_FILE } from "./constants.mjs";

const defaultMode = DEFAULT_MODE;
const modeList = MODES.join(", ");
const optionPrefix = OPTION_PREFIX;

const WIDENING_KEYS = new Set(["extraAllowedDirs", "extra_allowed_dirs", "hubRepos", "hub_repos", "allowedDirs", "allowed_dirs", "additionalDirectories"]);

export function defaultConfig() {
  return {
    mode: DEFAULT_MODE,
    extraAllowedDirs: [],
    hubRepos: [],
    allowIgnored: true,
    logDecisions: false,
    readTranscript: false,
    worktreeGuard: true,
    isolateWorktrees: false,
    bashGuard: true,
    protect: [],
    repoFile: null,
    warnings: [],
  };
}

export function isConfigFile(p) {
  return typeof p === "string" && basename(p) === REPO_CONFIG_FILE && basename(dirname(p)) === ".claude";
}

export function isClaudeSettingsFile(p, configDir) {
  if (typeof p !== "string") return false;
  const name = basename(p);
  if (name !== "settings.json" && name !== "settings.local.json") return false;
  return basename(dirname(p)) === ".claude" || (typeof configDir === "string" && dirname(p) === configDir);
}

export const OPTION_KEYS = ["mode", "extra_allowed_dirs", "hub_repos", "allow_ignored", "log_decisions", "read_transcript", "worktree_guard", "isolate_worktrees", "bash_guard"];

export function repoSetOptionKeys(sessionRoot) {
  if (typeof sessionRoot !== "string" || !isAbsolute(sessionRoot)) return [];
  try {
    const env = JSON.parse(readFileSync(join(sessionRoot, ".claude", "settings.json"), "utf8"))?.env;
    if (!env || typeof env !== "object") return [];
    return OPTION_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(env, OPTION_PREFIX + k.toUpperCase()));
  } catch {
    return [];
  }
}

function option(env, optionName) {
  const v = env[OPTION_PREFIX + optionName.toUpperCase()];
  return v === undefined ? undefined : String(v);
}

function parseBool(raw, optionName, fallback, warnings) {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  warnings.push(`option ${optionName}: "${raw}" is not true or false; using ${fallback}`);
  return fallback;
}

function parseDirList(raw, optionName, warnings) {
  if (raw === undefined || raw === "") return [];
  const out = [];
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (isAbsolute(part)) out.push(part);
    else warnings.push(`option ${optionName}: "${part}" is not an absolute path; ignored`);
  }
  return out;
}

export function modeRank(mode) {
  return MODES.indexOf(mode);
}

export function findRepoFile(start) {
  if (typeof start !== "string" || !isAbsolute(start)) return null;
  let cur = normalize(start);
  for (;;) {
    const candidate = join(cur, ".claude", REPO_CONFIG_FILE);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function applyRepoFile(c, file) {
  const w = c.warnings;
  const where = `${file}:`;
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    w.push(`${where} not valid JSON (${e.message}); ignored`);
    return;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    w.push(`${where} must hold a JSON object; ignored`);
    return;
  }
  const repoRoot = dirname(dirname(file));
  for (const [optionName, value] of Object.entries(data)) {
    if (optionName === "mode") {
      if (!MODES.includes(value)) w.push(`${where} mode "${value}" is not one of ${modeList}; ignored`);
      else if (value === "off") w.push(`${where} mode "off" is ignored: a repository file can only make the guard stricter`);
      else if (modeRank(value) < modeRank(c.mode)) w.push(`${where} mode "${value}" is looser than "${c.mode}"; ignored`);
      else c.mode = value;
    } else if (optionName === "allowIgnored") {
      if (value === false) c.allowIgnored = false;
      else if (value === true && !c.allowIgnored) w.push(`${where} allowIgnored true is ignored: a repository file cannot turn it back on`);
      else if (typeof value !== "boolean") w.push(`${where} allowIgnored must be true or false; ignored`);
    } else if (optionName === "protect") {
      if (!Array.isArray(value)) {
        w.push(`${where} protect must be a list of paths relative to the repository; ignored`);
        continue;
      }
      for (const p of value) {
        if (typeof p !== "string" || p === "" || isAbsolute(p)) {
          w.push(`${where} protect entry "${p}" must be a relative path; ignored`);
          continue;
        }
        const abs = join(repoRoot, p);
        const rel = relative(repoRoot, abs);
        if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) w.push(`${where} protect entry "${p}" leaves the repository; ignored`);
        else c.protect.push(abs.endsWith(sep) ? abs.slice(0, -1) : abs);
      }
    } else if (optionName === "worktreeGuard") {
      if (value === true) c.worktreeGuard = true;
      else if (value === false) w.push(`${where} worktreeGuard false is ignored: a repository file can only make the guard stricter`);
      else w.push(`${where} worktreeGuard must be true or false; ignored`);
    } else if (optionName === "bashGuard") {
      if (value === true) c.bashGuard = true;
      else if (value === false) w.push(`${where} bashGuard false is ignored: a repository file can only make the guard stricter`);
      else w.push(`${where} bashGuard must be true or false; ignored`);
    } else if (optionName === "isolateWorktrees") {
      if (value === true) c.isolateWorktrees = true;
      else if (value === false) {
        if (c.isolateWorktrees) w.push(`${where} isolateWorktrees false is ignored: a repository file can only make the guard stricter`);
      } else w.push(`${where} isolateWorktrees must be true or false; ignored`);
    } else if (WIDENING_KEYS.has(optionName)) {
      w.push(`${where} ${optionName} is ignored: a repository file cannot widen what the session may write`);
    } else {
      w.push(`${where} unknown key "${optionName}"; ignored`);
    }
  }
}

export function loadConfig({ env = {}, sessionRoot } = {}) {
  const c = defaultConfig();
  const w = c.warnings;
  const untrusted = repoSetOptionKeys(sessionRoot);
  const repoEnv = {};
  if (untrusted.length) {
    env = { ...env };
    for (const k of untrusted) {
      repoEnv[k] = option(env, k);
      delete env[OPTION_PREFIX + k.toUpperCase()];
    }
  }
  const mode = option(env, "mode");
  if (mode !== undefined && mode !== "") {
    if (MODES.includes(mode)) c.mode = mode;
    else w.push(`option mode: "${mode}" is not one of ${modeList}; using ${defaultMode}`);
  }
  c.extraAllowedDirs = parseDirList(option(env, "extra_allowed_dirs"), "extra_allowed_dirs", w);
  c.hubRepos = parseDirList(option(env, "hub_repos"), "hub_repos", w);
  c.allowIgnored = parseBool(option(env, "allow_ignored"), "allow_ignored", true, w);
  c.logDecisions = parseBool(option(env, "log_decisions"), "log_decisions", false, w);
  c.readTranscript = parseBool(option(env, "read_transcript"), "read_transcript", false, w);
  c.worktreeGuard = parseBool(option(env, "worktree_guard"), "worktree_guard", true, w);
  c.bashGuard = parseBool(option(env, "bash_guard"), "bash_guard", true, w);
  c.isolateWorktrees = parseBool(option(env, "isolate_worktrees"), "isolate_worktrees", false, w);
  if (untrusted.length) applyRepoEnv(c, repoEnv, join(sessionRoot, ".claude", "settings.json"));
  const file = findRepoFile(sessionRoot);
  if (file) {
    c.repoFile = file;
    applyRepoFile(c, file);
  }
  return c;
}

function applyRepoEnv(c, repoEnv, file) {
  const w = c.warnings;
  const where = `${file} env`;
  for (const [optionName, raw] of Object.entries(repoEnv)) {
    if (optionName === "mode" && MODES.includes(raw) && raw !== "off" && modeRank(raw) >= modeRank(c.mode)) c.mode = raw;
    else if (optionName === "allow_ignored" && raw === "false") c.allowIgnored = false;
    else if (optionName === "worktree_guard" && raw === "true") c.worktreeGuard = true;
    else if (optionName === "isolate_worktrees" && raw === "true") c.isolateWorktrees = true;
    else if (optionName === "bash_guard" && raw === "true") c.bashGuard = true;
    else w.push(`${where} sets ${optionPrefix}${optionName.toUpperCase()}="${raw}"; ignored: a repository can only make the guard stricter`);
  }
}
