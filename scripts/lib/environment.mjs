import { OPTION_KEYS } from "./config.mjs";
import { OPTION_PREFIX } from "./constants.mjs";

export const NAMED_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_PLUGIN_DATA",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_PID",
  "CLAUDE_JOB_DIR",
  "CLAUDE_COWORK_MEMORY_PATH_OVERRIDE",
  ...OPTION_KEYS.map((k) => OPTION_PREFIX + k.toUpperCase()),
];

export function namedEnv(source) {
  const picked = {};
  for (const k of NAMED_ENV_KEYS) if (typeof source[k] === "string") picked[k] = source[k];
  return picked;
}
