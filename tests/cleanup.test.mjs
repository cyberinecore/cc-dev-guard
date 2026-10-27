import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dangerReason } from "../scripts/lib/dangerguard.mjs";
import { liveCheck } from "../scripts/lib/liveguard.mjs";

const home = "/Users/t";
const repo = `${home}/WORK/app`;
const tagged = new Set([`${repo}/target`, `${home}/WORK/other/target`]);
const repos = new Set([repo, `${home}/WORK/other`, `${home}/WORK/dist`]);
const opts = { home, root: repo, cwd: repo, isCacheDir: (d) => tagged.has(d), isRepoRoot: (d) => repos.has(d) };
const deny = (cmd, o = opts) => assert.notEqual(dangerReason(cmd, o), "", cmd);
const pass = (cmd, o = opts) => assert.equal(dangerReason(cmd, o), "", cmd);

test("a path below a directory carrying a CACHEDIR.TAG may be deleted, up to the repository root", () => {
  pass(`rm -rf "${repo}/target/debug/bundle/macos/Gapreel.app"`);
  pass(`rm -rf ${repo}/target/debug`);
  pass(`rm -rf ${home}/WORK/other/target/release`);
  deny(`rm -rf ${repo}/src/target-notes`);
  deny(`rm -rf ${repo}/src`);
});

test("a path below a regenerable-named directory may be deleted, but not past the repository, home or a .git", () => {
  pass(`rm -rf ${repo}/tmp/exp1`);
  pass(`rm -rf ${repo}/.local/tmp/exp1`);
  pass(`rm -rf ${repo}/node_modules/.cache/x`);
  deny(`rm -rf ${home}/tmp/thesis`);
  deny(`rm -rf ${repo}/.git/dist/x`);
  deny(`rm -rf ${home}/WORK/dist/src`);
  deny(`rm -rf "${repo}/tmp/../src"`);
});

test("the regenerable-name allowance skips a folder directly in home, inside .git, or a repository root (kqgce)", () => {
  deny(`rm -rf ${home}/node_modules`);
  deny(`rm -rf ${repo}/.git/dist`);
  deny(`rm -rf ${home}/WORK/dist`);
  pass(`rm -rf ${repo}/node_modules`);
  pass(`rm -rf ${repo}/dist`);
  pass("rm -rf node_modules");
  deny("rm -rf ../dist", { ...opts, cwd: `${home}/WORK/app` });
});

test("destructive text in a quoted argument of a prose CLI is not scanned", () => {
  pass(`cyberine tasks add --do "Run rm -rf '${home}/precious' later"`);
  pass(`linear issue create --title "drop table users in staging"`);
  deny(`bash -c "rm -rf ${home}/precious"`);
});

test("a stderr redirect after a CACHEDIR.TAG argument is not a tag write; a real one still is", () => {
  pass(`ls -la ${repo}/target/CACHEDIR.TAG 2>&1 | head -1`);
  pass(`ls -la ${repo}/target/CACHEDIR.TAG 2>/dev/null`);
  deny(`echo x > ${repo}/tmp/CACHEDIR.TAG`);
  deny(`printf 'Signature: 8a477f597d28d172789f06886806bc55' >> "$d/CACHEDIR.TAG"`);
  deny(`echo CACHEDIR.TAG > "$f"`);
});

test("a denial names the heredoc body or the quoted string it matched in", () => {
  const body = dangerReason(`python3 - <<'EOF'\nopen('t.ts','w').write('db.raw.run("DELETE FROM oauth_grants")')\nEOF`, opts);
  assert.match(body, /heredoc body fed to an interpreter/);
  const quoted = dangerReason(`ssh box "rm -rf /srv/data"`, opts);
  assert.match(quoted, /quoted string handed to `ssh`/);
  const plain = dangerReason(`rm -rf /srv/data`, opts);
  assert.doesNotMatch(plain, /heredoc|quoted string/);
});

test("live_guard lets the read-only sfltool dumpbtm through and still asks for other sfltool commands", () => {
  assert.equal(liveCheck("sfltool dumpbtm > /tmp/btm.txt").finding, null);
  assert.equal(liveCheck("sfltool dumpbtm").finding, null);
  assert.notEqual(liveCheck("sfltool resetbtm").finding, null);
});
