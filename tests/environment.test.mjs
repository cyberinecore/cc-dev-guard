import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { NAMED_ENV_KEYS, namedEnv } from "../scripts/lib/environment.mjs";

const lib = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "lib");

test("namedEnv keeps only the listed variables", () => {
  const picked = namedEnv({ HOME: "/h", CLAUDE_PLUGIN_DATA: "/d", CLAUDE_PLUGIN_OPTION_MODE: "warn", UNLISTED_VALUE: "x", PATH: "/bin" });
  assert.deepEqual(picked, { HOME: "/h", CLAUDE_PLUGIN_DATA: "/d", CLAUDE_PLUGIN_OPTION_MODE: "warn" });
});

test("every environment variable the engine reads is on the named list", () => {
  for (const f of readdirSync(lib).filter((n) => n.endsWith(".mjs") && n !== "git.mjs")) {
    for (const m of readFileSync(join(lib, f), "utf8").matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) {
      assert.ok(NAMED_ENV_KEYS.includes(m[1]), `${f} reads ${m[1]}, which namedEnv drops`);
    }
  }
});
