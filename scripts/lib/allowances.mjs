import { readFileSync } from "node:fs";
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

function userAutoMemoryDir(configDir, home) {
  try {
    const settings = JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8"));
    const dir = expandHome(settings?.autoMemoryDirectory, home);
    return isAbsolute(dir) ? dir : "";
  } catch {
    return "";
  }
}

export function allowanceDirs({ env = {}, input = {}, config }) {
  const home = homeOf(env);
  const configDir = configDirOf(env);
  const dirs = [{ kind: "plans", dir: join(configDir, "plans") }];
  const autoMem = userAutoMemoryDir(configDir, home);
  if (autoMem) dirs.push({ kind: "autoMemoryDirectory", dir: autoMem });
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
