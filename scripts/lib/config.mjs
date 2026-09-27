import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { DEFAULT_MODE, MODES, OPTION_PREFIX, REPO_CONFIG_FILE } from "./constants.mjs";

const WIDENING_KEYS = new Set(["extraAllowedDirs", "extra_allowed_dirs", "hubRepos", "hub_repos", "allowedDirs", "allowed_dirs", "additionalDirectories"]);

export function defaultConfig() {
  return {
    mode: DEFAULT_MODE,
    extraAllowedDirs: [],
    hubRepos: [],
    allowIgnored: true,
    logDecisions: false,
    protect: [],
    repoFile: null,
    warnings: [],
  };
}

export function isConfigFile(p) {
  return typeof p === "string" && basename(p) === REPO_CONFIG_FILE && basename(dirname(p)) === ".claude";
}

function option(env, key) {
  const v = env[OPTION_PREFIX + key.toUpperCase()];
  return v === undefined ? undefined : String(v);
}

function parseBool(raw, key, fallback, warnings) {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  warnings.push(`option ${key}: "${raw}" is not true or false; using ${fallback}`);
  return fallback;
}

function parseDirList(raw, key, warnings) {
  if (raw === undefined || raw === "") return [];
  const out = [];
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (isAbsolute(part)) out.push(part);
    else warnings.push(`option ${key}: "${part}" is not an absolute path; ignored`);
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
  for (const [key, value] of Object.entries(data)) {
    if (key === "mode") {
      if (!MODES.includes(value)) w.push(`${where} mode "${value}" is not one of ${MODES.join(", ")}; ignored`);
      else if (value === "off") w.push(`${where} mode "off" is ignored: a repository file can only make the guard stricter`);
      else if (modeRank(value) < modeRank(c.mode)) w.push(`${where} mode "${value}" is looser than "${c.mode}"; ignored`);
      else c.mode = value;
    } else if (key === "allowIgnored") {
      if (value === false) c.allowIgnored = false;
      else if (value === true && !c.allowIgnored) w.push(`${where} allowIgnored true is ignored: a repository file cannot turn it back on`);
      else if (typeof value !== "boolean") w.push(`${where} allowIgnored must be true or false; ignored`);
    } else if (key === "protect") {
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
    } else if (WIDENING_KEYS.has(key)) {
      w.push(`${where} ${key} is ignored: a repository file cannot widen what the session may write`);
    } else {
      w.push(`${where} unknown key "${key}"; ignored`);
    }
  }
}

export function loadConfig({ env = {}, sessionRoot } = {}) {
  const c = defaultConfig();
  const w = c.warnings;
  const mode = option(env, "mode");
  if (mode !== undefined && mode !== "") {
    if (MODES.includes(mode)) c.mode = mode;
    else w.push(`option mode: "${mode}" is not one of ${MODES.join(", ")}; using ${DEFAULT_MODE}`);
  }
  c.extraAllowedDirs = parseDirList(option(env, "extra_allowed_dirs"), "extra_allowed_dirs", w);
  c.hubRepos = parseDirList(option(env, "hub_repos"), "hub_repos", w);
  c.allowIgnored = parseBool(option(env, "allow_ignored"), "allow_ignored", true, w);
  c.logDecisions = parseBool(option(env, "log_decisions"), "log_decisions", false, w);
  const file = findRepoFile(sessionRoot);
  if (file) {
    c.repoFile = file;
    applyRepoFile(c, file);
  }
  return c;
}
