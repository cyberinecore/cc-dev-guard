import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { expandHome, isUnder, resolveDir } from "./paths.mjs";

export function homeOf(env) {
  return env.HOME || env.USERPROFILE || homedir();
}

export function configDirOf(env) {
  const explicit = env.CLAUDE_CONFIG_DIR;
  return isAbsolute(explicit || "") ? explicit : join(homeOf(env), ".claude");
}

function autoMemoryDirIn(settingsPath, home) {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const dir = expandHome(settings?.autoMemoryDirectory, home);
    return isAbsolute(dir) ? dir : "";
  } catch {
    return "";
  }
}

function localAutoMemoryDir(sessionRoot, home, git) {
  if (typeof sessionRoot !== "string" || !isAbsolute(sessionRoot) || !git) return "";
  const path = join(sessionRoot, ".claude", "settings.local.json");
  const dir = autoMemoryDirIn(path, home);
  return dir && git.isIgnored(sessionRoot, path) ? dir : "";
}

export const HUB_GRANT_KEY = "CYBERINE_DEVGUARD_HUB_SUBMODULES";

const HUB_GRANT_FILE = [".claude", "settings.local.json"];

export function localHubGrant(sessionTop, git) {
  if (typeof sessionTop !== "string" || !isAbsolute(sessionTop) || !git?.isUntracked) return "";
  const path = join(sessionTop, ...HUB_GRANT_FILE);
  try {
    if (!lstatSync(join(sessionTop, HUB_GRANT_FILE[0])).isDirectory() || !lstatSync(path).isFile()) return "";
    if (JSON.parse(readFileSync(path, "utf8"))?.env?.[HUB_GRANT_KEY] !== "true") return "";
  } catch {
    return "";
  }
  return git.isUntracked(sessionTop, HUB_GRANT_FILE.join("/")) && git.isIgnored(sessionTop, path) ? path : "";
}

export function allowanceDirs({ env = {}, input = {}, config, sessionRoot, git }) {
  const home = homeOf(env);
  const configDir = configDirOf(env);
  const dirs = [{ kind: "plans", dir: join(configDir, "plans") }];
  const autoMem = autoMemoryDirIn(join(configDir, "settings.json"), home);
  if (autoMem) dirs.push({ kind: "autoMemoryDirectory", dir: autoMem });
  const localMem = localAutoMemoryDir(sessionRoot, home, git);
  if (localMem) dirs.push({ kind: "local-autoMemoryDirectory", dir: localMem });
  const add = (kind, dir) => {
    if (typeof dir === "string" && isAbsolute(dir)) dirs.push({ kind, dir });
  };
  add("cowork-memory", env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE);
  add("scratchpad", input.scratchpad_dir);
  if (typeof env.CLAUDE_JOB_DIR === "string" && isAbsolute(env.CLAUDE_JOB_DIR)) add("job-tmp", join(env.CLAUDE_JOB_DIR, "tmp"));
  for (const d of config?.extraAllowedDirs || []) add("extra_allowed_dirs", d);
  return { configDir, dirs };
}

export function matchAllowance(resolved, ctx) {
  const { configDir, dirs } = allowanceDirs(ctx);
  const projects = resolveDir(join(configDir, "projects"));
  const rel = relative(projects, resolved);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    const parts = rel.split(sep);
    if (parts.length >= 2 && parts[0] !== "" && parts[1] === "memory") return "auto-memory";
  }
  for (const { kind, dir } of dirs) {
    if (isUnder(resolved, resolveDir(dir))) return kind;
  }
  return "";
}
