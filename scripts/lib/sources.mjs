import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { configDirOf, homeOf } from "./allowances.mjs";
import { namedEnv } from "./environment.mjs";
import { expandHome, resolveDir } from "./paths.mjs";

const SESSION_RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function managedSettingsPath(platform = process.platform) {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
  return "/etc/claude-code/managed-settings.json";
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function settingsFiles({ env = {}, sessionRoot }) {
  const files = [
    { scope: "managed", path: managedSettingsPath(), base: "" },
    { scope: "user", path: join(configDirOf(env), "settings.json"), base: homeOf(env) },
  ];
  if (typeof sessionRoot === "string" && isAbsolute(sessionRoot)) {
    files.push({ scope: "project", path: join(sessionRoot, ".claude", "settings.json"), base: sessionRoot });
    files.push({ scope: "local", path: join(sessionRoot, ".claude", "settings.local.json"), base: sessionRoot });
  }
  return files;
}

export function settingsDirs(ctx) {
  const home = homeOf(ctx.env || {});
  const out = [];
  for (const { scope, path, base } of settingsFiles(ctx)) {
    const dirs = readJson(path)?.permissions?.additionalDirectories;
    if (!Array.isArray(dirs)) continue;
    for (const d of dirs) {
      if (typeof d !== "string" || d === "") continue;
      const expanded = expandHome(d, home);
      const abs = isAbsolute(expanded) ? expanded : base ? resolve(base, expanded) : "";
      if (abs) out.push({ source: `${scope} settings`, dir: abs });
    }
  }
  return out;
}

function sessionRecordPath(env, sessionId) {
  if (!isAbsolute(env.CLAUDE_PLUGIN_DATA || "")) return "";
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(sessionId)) return "";
  return join(env.CLAUDE_PLUGIN_DATA, "sessions", `${sessionId}.json`);
}

export function sessionDirs({ env = {}, input = {} }) {
  const p = sessionRecordPath(env, input.session_id);
  const dirs = p ? readJson(p)?.dirs : null;
  if (!Array.isArray(dirs)) return [];
  return dirs.filter((d) => typeof d === "string" && isAbsolute(d)).map((dir) => ({ source: "/add-dir", dir }));
}

export function pruneSessionRecords(env, now = Date.now()) {
  if (!isAbsolute(env.CLAUDE_PLUGIN_DATA || "")) return;
  const dir = join(env.CLAUDE_PLUGIN_DATA, "sessions");
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const p = join(dir, name);
    try {
      if (now - statSync(p).mtimeMs > SESSION_RECORD_TTL_MS) rmSync(p, { force: true });
    } catch {}
  }
}

export function recordDirectoryAdded(input, env = namedEnv(process.env)) {
  const p = sessionRecordPath(env, input?.session_id);
  const dir = input?.directory;
  if (!p || typeof dir !== "string" || !isAbsolute(dir)) return false;
  pruneSessionRecords(env);
  const current = readJson(p)?.dirs;
  const dirs = Array.isArray(current) ? current.filter((d) => typeof d === "string") : [];
  if (!dirs.includes(dir)) dirs.push(dir);
  mkdirSync(join(env.CLAUDE_PLUGIN_DATA, "sessions"), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify({ dirs }) + "\n", { mode: 0o600 });
  return true;
}

export function parseAddDirs(argv, cwd) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") break;
    if (a.startsWith("--add-dir=")) {
      out.push(a.slice("--add-dir=".length));
      continue;
    }
    if (a !== "--add-dir") continue;
    while (i + 1 < argv.length && !argv[i + 1].startsWith("-")) out.push(argv[++i]);
  }
  return out.filter(Boolean).map((d) => (isAbsolute(d) ? d : cwd ? resolve(cwd, d) : "")).filter(Boolean);
}

function processArgv(pid) {
  if (!/^[0-9]+$/.test(String(pid))) return null;
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return { argv: raw.split("\u0000").filter(Boolean), exact: true };
  } catch {}
  if (process.platform === "win32") return null;
  try {
    const line = execFileSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
    return line ? { argv: line.split(/\s+/), exact: false } : null;
  } catch {
    return null;
  }
}

function launchCwd(env, pid) {
  const meta = readJson(join(configDirOf(env), "sessions", `${pid}.json`));
  if (typeof meta?.cwd === "string" && isAbsolute(meta.cwd)) return meta.cwd;
  try {
    return realpathSync.native(`/proc/${pid}/cwd`);
  } catch {}
  return isAbsolute(env.CLAUDE_PROJECT_DIR || "") ? env.CLAUDE_PROJECT_DIR : "";
}

export function cliDirs({ env = {}, deps = {} }) {
  const pid = env.CLAUDE_PID;
  if (!pid) return [];
  const got = (deps.processArgv || processArgv)(pid);
  if (!got) return [];
  return parseAddDirs(got.argv, launchCwd(env, pid)).map((dir) => ({ source: got.exact ? "--add-dir" : "--add-dir (from ps)", dir }));
}

export function scopeDirs(ctx) {
  const entries = [...settingsDirs(ctx), ...sessionDirs(ctx), ...cliDirs(ctx)];
  const seen = new Set();
  const dirs = [];
  const sources = [];
  for (const e of entries) {
    const r = resolveDir(e.dir);
    if (!r) continue;
    sources.push({ source: e.source, dir: r });
    if (!seen.has(r)) {
      seen.add(r);
      dirs.push(r);
    }
  }
  return { ok: true, dirs, sources, via: "settings, /add-dir and --add-dir" };
}
