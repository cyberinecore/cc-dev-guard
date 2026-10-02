#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

export function settingsFiles(env, projectDir) {
  const configDir = isAbsolute(env.CLAUDE_CONFIG_DIR || "") ? env.CLAUDE_CONFIG_DIR : join(env.HOME || env.USERPROFILE || homedir(), ".claude");
  const files = [join(configDir, "settings.json"), join(configDir, "settings.local.json")];
  if (isAbsolute(projectDir || "")) files.push(join(projectDir, ".claude", "settings.json"), join(projectDir, ".claude", "settings.local.json"));
  return [...new Set(files)];
}

export function otherWorktreeHooks(files) {
  const found = [];
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const entries = data?.hooks?.WorktreeCreate;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      for (const h of Array.isArray(entry?.hooks) ? entry.hooks : []) {
        const what = typeof h?.command === "string" ? h.command : typeof h?.url === "string" ? h.url : String(h?.type || "hook");
        found.push({ file, what });
      }
    }
  }
  return found;
}

export function warning(found) {
  if (!found.length) return null;
  const list = found.map((f) => "`" + f.what + "` in " + f.file).join("; ");
  return {
    systemMessage: "cyberine-worktree: another WorktreeCreate hook is configured (" + list + "). Claude Code runs every WorktreeCreate hook in parallel, so a hook that picks a different path or branch leaves an orphan worktree. Remove that entry, or uninstall cyberine-worktree.",
  };
}

export function main(env = process.env) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8")) || {};
  } catch {}
  const projectDir = isAbsolute(env.CLAUDE_PROJECT_DIR || "") ? env.CLAUDE_PROJECT_DIR : typeof input.cwd === "string" ? input.cwd : "";
  const out = warning(otherWorktreeHooks(settingsFiles(env, projectDir)));
  if (out) process.stdout.write(JSON.stringify(out) + "\n");
  return 0;
}

function realPathOr(p) {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

if (process.argv[1] && realPathOr(process.argv[1]) === realPathOr(fileURLToPath(import.meta.url))) process.exitCode = main();
