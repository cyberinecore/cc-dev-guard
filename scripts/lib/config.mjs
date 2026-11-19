import { lstatSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { DEFAULT_MODE, DEFAULT_PROFILE, LOCAL_OPTION_PREFIX, MODES, OPTION_PREFIX, PROFILES, REPO_CONFIG_FILE } from "./constants.mjs";
import { parseAllowCommands, parseAppList } from "./allowlist.mjs";
import { DEFAULT_PROTECTED_BRANCHES } from "./dangerguard.mjs";
import { makeGit } from "./git.mjs";
import { realPathOr } from "./paths.mjs";

const defaultMode = DEFAULT_MODE;
const modeList = MODES.join(", ");
const optionPrefix = OPTION_PREFIX;

export const DEFAULT_RELAUNCH_LIMIT = 10;

const WIDENING_KEYS = new Set(["extraAllowedDirs", "extra_allowed_dirs", "hubRepos", "hub_repos", "regenerablePaths", "regenerable_paths", "outputPaths", "output_paths", "allowedDirs", "allowed_dirs", "additionalDirectories"]);

export function defaultConfig() {
  return {
    mode: DEFAULT_MODE,
    profile: DEFAULT_PROFILE,
    extraAllowedDirs: [],
    hubRepos: [],
    regenerablePaths: [],
    allowIgnored: true,
    allowIgnoredNestedRepos: true,
    logDecisions: false,
    logStops: true,
    logLevel: "stops",
    readTranscript: false,
    worktreeGuard: true,
    isolateWorktrees: false,
    bashGuard: true,
    dangerGuard: true,
    liveGuard: true,
    liveGuardDesktop: false,
    relaunchLimit: DEFAULT_RELAUNCH_LIMIT,
    relaunchExemptApps: [],
    allowCommands: [],
    sessionHint: true,
    bypassStrict: false,
    protectedBranches: [...DEFAULT_PROTECTED_BRANCHES],
    denyAwsS3Deletes: true,
    allowDangerEnv: "",
    protect: [],
    localOptions: [],
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

export const OPTION_KEYS = ["mode", "profile", "extra_allowed_dirs", "hub_repos", "allow_ignored", "log_decisions", "log_level", "read_transcript", "worktree_guard", "isolate_worktrees", "bash_guard", "danger_guard", "session_hint", "protected_branches", "deny_aws_s3_deletes", "allow_danger_env", "bypass_strict", "allow_ignored_nested_repos", "live_guard", "live_guard_desktop", "relaunch_limit", "regenerable_paths", "output_paths", "allow_commands", "relaunch_exempt_apps"];

export function repoSetOptionKeys(sessionRoot) {
  if (typeof sessionRoot !== "string" || !isAbsolute(sessionRoot)) return [];
  return OPTION_KEYS.filter((k) => repoSetsEnv(sessionRoot, OPTION_PREFIX + k.toUpperCase()));
}

const LOCAL_SETTINGS = [".claude", "settings.local.json"];
const NEVER_FROM_LOCAL = new Set(["allow_danger_env", "allow_commands"]);
const USER_ONLY_FILE_KEYS = new Map([["allowCommands", "exempt commands from the guards"], ["allow_commands", "exempt commands from the guards"], ["relaunchExemptApps", "exempt apps from the relaunch budget"], ["relaunch_exempt_apps", "exempt apps from the relaunch budget"]]);
const REPO_RELATIVE_LISTS = ["regenerable_paths", "output_paths"];

function settingsEnv(root, file) {
  try {
    const env = JSON.parse(readFileSync(join(root, ".claude", file), "utf8"))?.env;
    return env && typeof env === "object" && !Array.isArray(env) ? env : {};
  } catch {
    return {};
  }
}

function localSettingsAreTheUsers(root, git) {
  const path = join(root, ...LOCAL_SETTINGS);
  try {
    if (!lstatSync(join(root, LOCAL_SETTINGS[0])).isDirectory() || !lstatSync(path).isFile()) return false;
    return git.isUntracked(root, LOCAL_SETTINGS.join("/")) && git.isIgnored(root, path);
  } catch {
    return false;
  }
}

function localOptionEntries(root) {
  const env = settingsEnv(root, LOCAL_SETTINGS[1]);
  const valueOf = (k) => [LOCAL_OPTION_PREFIX, OPTION_PREFIX].map((prefix) => env[prefix + k.toUpperCase()]).find((v) => typeof v === "string");
  const out = {};
  for (const k of OPTION_KEYS) {
    if (NEVER_FROM_LOCAL.has(k)) continue;
    const v = valueOf(k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function trustedOptionEntries(root, git) {
  const entries = localOptionEntries(root);
  if (!Object.keys(entries).length || !localSettingsAreTheUsers(root, git)) return {};
  for (const k of REPO_RELATIVE_LISTS) if (entries[k] !== undefined) entries[k] = entries[k].split(",").map((s) => s.trim()).filter(Boolean).map((p) => (isAbsolute(p) ? p : join(root, p))).join(",");
  return entries;
}

function linkedWorktreeMainGuess(sessionRoot) {
  let cur = sessionRoot;
  for (;;) {
    const dotGit = join(cur, ".git");
    try {
      const st = lstatSync(dotGit);
      if (!st.isFile()) return "";
      const m = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(readFileSync(dotGit, "utf8"));
      if (!m) return "";
      const gitDir = resolve(cur, m[1]);
      const common = dirname(dirname(gitDir));
      return basename(dirname(gitDir)) === "worktrees" && basename(common) === ".git" ? dirname(common) : "";
    } catch (e) {
      if (e?.code !== "ENOENT" && e?.code !== "ENOTDIR") return "";
    }
    const parent = dirname(cur);
    if (parent === cur) return "";
    cur = parent;
  }
}

export function localOptionValues(sessionRoot, git = null) {
  if (typeof sessionRoot !== "string" || !isAbsolute(sessionRoot)) return {};
  let made = git;
  const gitOf = () => (made ||= makeGit());
  const own = trustedOptionEntries(sessionRoot, gitOf());
  const guess = linkedWorktreeMainGuess(sessionRoot);
  if (!guess || !Object.keys(localOptionEntries(guess)).length) return own;
  const g = gitOf();
  if (typeof g.mainRoot !== "function") return own;
  const main = g.mainRoot(sessionRoot);
  if (!main || main === realPathOr(sessionRoot)) return own;
  return { ...trustedOptionEntries(main, g), ...own };
}

function ignoredLocalOnlyWarnings(sessionRoot) {
  if (typeof sessionRoot !== "string" || !isAbsolute(sessionRoot)) return [];
  const env = settingsEnv(sessionRoot, LOCAL_SETTINGS[1]);
  return [...NEVER_FROM_LOCAL].filter((k) => typeof env[LOCAL_OPTION_PREFIX + k.toUpperCase()] === "string").map((k) => `${LOCAL_OPTION_PREFIX}${k.toUpperCase()} in .claude/settings.local.json is ignored: ${k} can only be set in /config`);
}

export function repoSetsEnv(sessionRoot, name) {
  if (typeof sessionRoot !== "string" || !isAbsolute(sessionRoot)) return false;
  for (const file of ["settings.json", "settings.local.json"]) {
    try {
      const env = JSON.parse(readFileSync(join(sessionRoot, ".claude", file), "utf8"))?.env;
      if (env && typeof env === "object" && Object.prototype.hasOwnProperty.call(env, name)) return true;
    } catch {}
  }
  return false;
}

function option(env, optionName) {
  const v = env[OPTION_PREFIX + optionName.toUpperCase()];
  return v === undefined ? undefined : String(v);
}

function resolveLogLevel(level, legacy, warnings) {
  if (level !== undefined && level !== "") {
    const v = level.trim().toLowerCase();
    if (v === "off" || v === "stops" || v === "all") return v;
    warnings.push(`option log_level: "${level}" is not off, stops or all; ignored`);
  }
  if (legacy === "true") return "all";
  if (legacy === "false") return "off";
  if (legacy !== undefined && legacy !== "") warnings.push(`option log_decisions: "${legacy}" is not true or false; ignored`);
  return "stops";
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

function parseLimit(raw, optionName, fallback, warnings) {
  if (raw === undefined || raw === "") return fallback;
  if (/^\d+$/.test(raw.trim())) return Number(raw.trim());
  warnings.push(`option ${optionName}: "${raw}" is not a whole number; using ${fallback}`);
  return fallback;
}

export function tightensLimit(current, next) {
  return Number.isInteger(next) && next >= 1 && (current === 0 || next < current);
}

export function parseNameList(raw) {
  if (raw === undefined) return undefined;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
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
    } else if (optionName === "profile") {
      if (value === "strict") c.profile = "strict";
      else if (value === "assist") {
        if (c.profile === "strict") w.push(`${where} profile "assist" is ignored: a repository file can only make the guard stricter`);
      } else w.push(`${where} profile must be "assist" or "strict"; ignored`);
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
    } else if (optionName === "dangerGuard") {
      if (value === true) c.dangerGuard = true;
      else if (value === false) w.push(`${where} dangerGuard false is ignored: a repository file can only make the guard stricter`);
      else w.push(`${where} dangerGuard must be true or false; ignored`);
    } else if (optionName === "liveGuard" || optionName === "liveGuardDesktop") {
      if (value === true) c[optionName] = true;
      else if (value === false) {
        if (c[optionName]) w.push(`${where} ${optionName} false is ignored: a repository file can only make the guard stricter`);
      } else w.push(`${where} ${optionName} must be true or false; ignored`);
    } else if (optionName === "relaunchLimit") {
      if (tightensLimit(c.relaunchLimit, value)) c.relaunchLimit = value;
      else w.push(`${where} relaunchLimit ${JSON.stringify(value)} is ignored: a repository file can only lower it to a whole number of at least 1`);
    } else if (optionName === "allowIgnoredNestedRepos") {
      if (value === false) c.allowIgnoredNestedRepos = false;
      else if (value === true) {
        if (!c.allowIgnoredNestedRepos) w.push(`${where} allowIgnoredNestedRepos true is ignored: a repository file cannot turn it back on`);
      } else w.push(`${where} allowIgnoredNestedRepos must be true or false; ignored`);
    } else if (optionName === "bypassStrict") {
      if (value === true) c.bypassStrict = true;
      else if (value === false) {
        if (c.bypassStrict) w.push(`${where} bypassStrict false is ignored: a repository file can only make the guard stricter`);
      } else w.push(`${where} bypassStrict must be true or false; ignored`);
    } else if (optionName === "denyAwsS3Deletes") {
      if (value === true) c.denyAwsS3Deletes = true;
      else if (value === false) w.push(`${where} denyAwsS3Deletes false is ignored: a repository file can only make the guard stricter`);
      else w.push(`${where} denyAwsS3Deletes must be true or false; ignored`);
    } else if (optionName === "protectedBranches") {
      if (!Array.isArray(value) || value.some((b) => typeof b !== "string" || b.trim() === "")) w.push(`${where} protectedBranches must be a list of branch names; ignored`);
      else for (const b of value) if (!c.protectedBranches.includes(b.trim())) c.protectedBranches.push(b.trim());
    } else if (optionName === "allowDangerEnv") {
      w.push(`${where} allowDangerEnv is ignored: a repository file cannot name an escape hatch`);
    } else if (optionName === "isolateWorktrees") {
      if (value === true) c.isolateWorktrees = true;
      else if (value === false) {
        if (c.isolateWorktrees) w.push(`${where} isolateWorktrees false is ignored: a repository file can only make the guard stricter`);
      } else w.push(`${where} isolateWorktrees must be true or false; ignored`);
    } else if (USER_ONLY_FILE_KEYS.has(optionName)) {
      w.push(`${where} ${optionName} is ignored: a repository file cannot ${USER_ONLY_FILE_KEYS.get(optionName)}`);
    } else if (WIDENING_KEYS.has(optionName)) {
      w.push(`${where} ${optionName} is ignored: a repository file cannot widen what the session may write`);
    } else {
      w.push(`${where} unknown key "${optionName}"; ignored`);
    }
  }
}

export function loadConfig({ env = {}, sessionRoot, git = null } = {}) {
  const c = defaultConfig();
  const w = c.warnings;
  const local = localOptionValues(sessionRoot, git);
  c.localOptions = Object.keys(local);
  w.push(...ignoredLocalOnlyWarnings(sessionRoot));
  const untrusted = repoSetOptionKeys(sessionRoot).filter((k) => !(k in local));
  if (c.localOptions.length) {
    env = { ...env };
    for (const k of c.localOptions) env[OPTION_PREFIX + k.toUpperCase()] = local[k];
  }
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
  const profile = option(env, "profile");
  if (profile !== undefined && profile !== "") {
    if (PROFILES.includes(profile)) c.profile = profile;
    else w.push(`option profile: "${profile}" is not one of ${PROFILES.join(", ")}; using ${DEFAULT_PROFILE}`);
  }
  c.extraAllowedDirs = parseDirList(option(env, "extra_allowed_dirs"), "extra_allowed_dirs", w);
  c.hubRepos = parseDirList(option(env, "hub_repos"), "hub_repos", w);
  c.regenerablePaths = [...parseDirList(option(env, "regenerable_paths"), "regenerable_paths", w), ...parseDirList(option(env, "output_paths"), "output_paths", w)];
  c.allowIgnored = parseBool(option(env, "allow_ignored"), "allow_ignored", true, w);
  c.allowIgnoredNestedRepos = parseBool(option(env, "allow_ignored_nested_repos"), "allow_ignored_nested_repos", true, w);
  c.logLevel = resolveLogLevel(option(env, "log_level"), option(env, "log_decisions"), w);
  c.logDecisions = c.logLevel === "all";
  c.logStops = c.logLevel !== "off";
  c.readTranscript = parseBool(option(env, "read_transcript"), "read_transcript", false, w);
  c.worktreeGuard = parseBool(option(env, "worktree_guard"), "worktree_guard", true, w);
  c.bashGuard = parseBool(option(env, "bash_guard"), "bash_guard", true, w);
  c.isolateWorktrees = parseBool(option(env, "isolate_worktrees"), "isolate_worktrees", false, w);
  c.dangerGuard = parseBool(option(env, "danger_guard"), "danger_guard", true, w);
  c.liveGuard = parseBool(option(env, "live_guard"), "live_guard", true, w);
  c.liveGuardDesktop = parseBool(option(env, "live_guard_desktop"), "live_guard_desktop", false, w);
  c.relaunchLimit = parseLimit(option(env, "relaunch_limit"), "relaunch_limit", DEFAULT_RELAUNCH_LIMIT, w);
  c.relaunchExemptApps = parseAppList(option(env, "relaunch_exempt_apps"));
  c.allowCommands = parseAllowCommands(option(env, "allow_commands"), "allow_commands", w);
  c.sessionHint = parseBool(option(env, "session_hint"), "session_hint", true, w);
  c.denyAwsS3Deletes = parseBool(option(env, "deny_aws_s3_deletes"), "deny_aws_s3_deletes", true, w);
  c.bypassStrict = parseBool(option(env, "bypass_strict"), "bypass_strict", false, w);
  const branches = parseNameList(option(env, "protected_branches"));
  if (branches !== undefined) c.protectedBranches = branches;
  const escapeName = option(env, "allow_danger_env");
  if (escapeName) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(escapeName)) c.allowDangerEnv = escapeName;
    else w.push(`option allow_danger_env: "${escapeName}" is not an environment variable name; ignored`);
  }
  if (untrusted.length) applyRepoEnv(c, repoEnv, join(sessionRoot, ".claude", "settings.json or settings.local.json"));
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
    else if (optionName === "profile" && raw === "strict") c.profile = "strict";
    else if (optionName === "allow_ignored" && raw === "false") c.allowIgnored = false;
    else if (optionName === "allow_ignored_nested_repos" && raw === "false") c.allowIgnoredNestedRepos = false;
    else if (optionName === "worktree_guard" && raw === "true") c.worktreeGuard = true;
    else if (optionName === "isolate_worktrees" && raw === "true") c.isolateWorktrees = true;
    else if (optionName === "bash_guard" && raw === "true") c.bashGuard = true;
    else if (optionName === "danger_guard" && raw === "true") c.dangerGuard = true;
    else if (optionName === "session_hint" && raw === "true") c.sessionHint = true;
    else if (optionName === "live_guard" && raw === "true") c.liveGuard = true;
    else if (optionName === "live_guard_desktop" && raw === "true") c.liveGuardDesktop = true;
    else if (optionName === "relaunch_limit" && /^\d+$/.test(raw ?? "") && tightensLimit(c.relaunchLimit, Number(raw))) c.relaunchLimit = Number(raw);
    else if (optionName === "bypass_strict" && raw === "true") c.bypassStrict = true;
    else if (optionName === "deny_aws_s3_deletes" && raw === "true") c.denyAwsS3Deletes = true;
    else w.push(`${where} sets ${optionPrefix}${optionName.toUpperCase()}="${raw}"; ignored: a repository can only make the guard stricter`);
  }
}
