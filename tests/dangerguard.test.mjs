import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dangerReason } from "../scripts/lib/dangerguard.mjs";
import { ALLOWS, CASE_HOME as home, DENIES, DEVGUARD_ALLOWS, DEVGUARD_DENIES } from "./fixtures/bashguard-cases.mjs";

test("every deny case of the Go bash guard's TestBashGuardDenies is denied", () => {
  for (const c of DENIES) assert.notEqual(dangerReason(c, { home }), "", `expected deny for ${JSON.stringify(c)}`);
});

test("every allow case of the Go bash guard's TestBashGuardAllows passes", () => {
  for (const c of ALLOWS) assert.equal(dangerReason(c, { home }), "", `expected allow for ${JSON.stringify(c)}`);
});

test("text-only heredoc bodies, lowercase truncate outside SQL and $(mktemp) targets pass (divergences from the Go table)", () => {
  for (const c of DEVGUARD_ALLOWS) assert.equal(dangerReason(c, { home }), "", `expected allow for ${JSON.stringify(c)}`);
});

test("heredocs fed to a shell or SQL client, SQL truncate and climbing $(mktemp) targets still deny", () => {
  for (const c of DEVGUARD_DENIES) assert.notEqual(dangerReason(c, { home }), "", `expected deny for ${JSON.stringify(c)}`);
});

test("protected branches come from the option", () => {
  assert.equal(dangerReason("git push -f origin feature/abc-12", { home, protectedBranches: ["feature/abc-12"] }), "force-push to protected branch `feature/abc-12` is denied.");
  assert.equal(dangerReason("git push -f origin main", { home, protectedBranches: ["trunk"] }), "");
  assert.notEqual(dangerReason("git push -f", { home, protectedBranches: [] }), "");
});

test("aws s3 deletes are denied only while the option is on", () => {
  assert.notEqual(dangerReason("aws s3 rm s3://bucket/key", { home }), "");
  assert.equal(dangerReason("aws s3 rm s3://bucket/key", { home, awsS3: false }), "");
  assert.equal(dangerReason("aws s3api delete-bucket --bucket b", { home, awsS3: false }), "");
});

test("an empty or non-string command passes", () => {
  assert.equal(dangerReason("", { home }), "");
  assert.equal(dangerReason(undefined, { home }), "");
});

test("a per-account profile's expanded jobs dir is a tmp target when CLAUDE_CONFIG_DIR names that profile", () => {
  const configDir = `${home}/.claude-profiles/ktt`;
  assert.equal(dangerReason(`rm -rf ${configDir}/jobs/abc123/tmp/x`, { home, configDir }), "");
  assert.equal(dangerReason(`rm -rf ${configDir}/jobs/abc123/tmp/x`, { home, configDir: configDir + "/" }), "");
  assert.notEqual(dangerReason(`rm -rf ${configDir}/jobs/abc123/tmp/x`, { home }), "");
  assert.notEqual(dangerReason(`rm -rf ${home}/.claude-profiles/ft/jobs/abc123/x`, { home, configDir }), "");
  assert.notEqual(dangerReason(`rm -rf ${configDir}/projects`, { home, configDir }), "");
  assert.notEqual(dangerReason(`rm -rf ${configDir}/jobs/../settings.json`, { home, configDir }), "");
  assert.notEqual(dangerReason("rm -rf /jobs/x", { home, configDir: "/" }), "");
  assert.notEqual(dangerReason(`rm -rf ${home}/jobs/x`, { home, configDir: home }), "");
  assert.notEqual(dangerReason("rm -rf /relative/dir/jobs/x", { home, configDir: "relative/dir" }), "");
});

// 0.8.0 hardening (D40): shapes the Go table never covered, probed against dangerReason before the change (every one passed).
const HARDEN_DENIES = [
  // rm reached through a path or a backslash escape
  "\\rm -rf /Users/me",
  "/bin/rm -rf /Users/me",
  "/usr/bin/rm -rf /Users/me/WORK/x",
  "sudo /bin/rm -rf /Users/me",
  // find -delete / -exec rm -r under an absolute, ~ or variable root; xargs rm -r
  "find / -name '*.log' -delete",
  "find /Users/me -delete",
  "find ~ -type f -delete",
  "find \"$DIR\" -delete",
  "find * -delete",
  "find .. -delete",
  "sudo find /var/log -type f -name '*.gz' -delete",
  "find /Users/me -exec rm -rf {} \;",
  "find /var/lib -execdir rm -r {} +",
  "find /Users/me/WORK/x -name node_modules -type d -prune -exec rm -rf {} +",
  "cat list | xargs rm -rf",
  "xargs rm -r < list",
  "find . -name node_modules -prune -print0 | xargs -0 rm -rf",
  // database CLIs
  "dropdb mydb",
  "mysqladmin drop mydb",
  "mysqladmin -f drop mydb",
  "mysqladmin -u root -psecret drop mydb",
  "redis-cli FLUSHALL",
  "redis-cli -h h flushdb",
  "redis-cli <<EOF\nFLUSHALL\nEOF",
  "mongosh --eval 'db.dropDatabase()'",
  "mongo mydb --eval 'db.users.drop()'",
  "mongosh --eval 'db.users.deleteMany({})'",
  "mongosh --eval 'db.users.remove({})'",
  "mongosh <<'EOF'\nuse app\ndb.users.drop()\nEOF",
  "npx prisma migrate reset",
  "prisma db push --force-reset",
  "npx prisma db push --force-reset --skip-generate",
  "rails db:drop",
  "bin/rails db:reset",
  "rails db:schema:load",
  "rake db:drop",
  "bundle exec rake db:schema:load",
  "php artisan migrate:fresh",
  "php artisan db:wipe",
  "npx sequelize db:drop",
  "typeorm schema:drop",
  // managed databases
  "wrangler d1 delete mydb",
  "aws rds delete-db-instance --db-instance-identifier x",
  "aws rds delete-db-cluster --db-cluster-identifier x",
  "aws --profile p rds delete-db-cluster --db-cluster-identifier c",
  "aws dynamodb delete-table --table-name t",
  "az sql db delete -n x",
  "az cosmosdb sql database delete -n x",
  "az cosmosdb delete -n acct -g rg",
  "gcloud sql instances delete x",
  "gcloud beta sql instances delete x",
  "gcloud sql databases delete x --instance=y",
  // containers
  "docker rm -v mysql",
  "docker rm --volumes mysql",
  "docker rm -fv mysql",
  "docker container rm --volumes db",
  "kubectl delete statefulset mysql",
  "kubectl delete sts/mysql",
  // SQL DELETE without WHERE
  "psql -c 'DELETE FROM users'",
  "mysql -e 'DELETE FROM users;'",
  "psql -c \"DELETE FROM a WHERE x=1; DELETE FROM b\"",
  "psql <<'EOF'\nDELETE FROM a WHERE x; DELETE FROM b\nEOF",
  "docker exec db psql -c 'DELETE FROM users'",
  // block devices
  "dd if=/dev/zero of=/dev/sda",
  "dd if=/dev/zero of=/dev/disk2 bs=1m",
  "mkfs.ext4 /dev/sdb1",
  "mkfs -t ext4 /dev/sdb1",
  "sudo mkfs.ext4 /dev/sdb1",
  "wipefs -a /dev/sdb",
  // git
  "git branch -D main",
  "git branch -Df main",
  "git branch --delete --force main",
  "git branch -d -f master",
  "git branch -df production",
  "git stash clear",
  // .git
  "rm -rf .git",
  "rm -rf .git/",
  "rm -rf /Users/me/WORK/repo/.git",
  "rm -rf node_modules/pkg/.git",
  // through wrappers
  "bash -c 'redis-cli FLUSHALL'",
  "ssh host 'dropdb mydb'",
  "ssh h \"bash -c 'mysqladmin -u root drop app'\"",
  "timeout 30 bash -c 'find / -delete'",
  "eval \"git stash clear\"",
  "env RAILS_ENV=test rails db:drop",
  "kubectl exec pod -- sh -c 'rm -rf .git'",
  "xargs -I{} sh -c 'dropdb {}' < list",
  "docker exec -it db mongosh --eval 'db.dropDatabase()'",
];

const HARDEN_ALLOWS = [
  "rm -rf node_modules",
  "rm -rf dist",
  "rm -rf /tmp/x",
  "rm -rf src",
  "rm -rf foo.git",
  "rm -rf .github",
  "echo \"rm -rf /\"",
  "grep FLUSHALL notes.md",
  "git commit -m \"drop table users\"",
  "git commit -m 'drop the DELETE FROM users path'",
  "git log -S'DELETE FROM users'",
  "grep -r 'DELETE FROM' src/",
  "echo 'find / -delete'",
  "# rm -rf /\nls",
  "# find / -delete\nls",
  "psql -c 'DELETE FROM users WHERE id = 1'",
  "mysql -e 'DELETE FROM users WHERE created < now()'",
  "psql <<'EOF'\nDELETE FROM users\nWHERE id = 1;\nEOF",
  "node -e \"db.query('DELETE FROM t WHERE id=$1', [1])\"",
  "docker rm mysql",
  "docker rm -f mysql",
  "docker run --rm -v /x:/y img",
  "docker compose down",
  "docker rm mongo",
  "dd if=x of=out.img",
  "dd if=x of=/dev/null",
  "dd if=/dev/zero of=/dev/stdout bs=1 count=1",
  "man mkfs",
  "which mkfs.ext4",
  "find . -name '*.log' -print",
  "find . -name '*.log' -delete",
  "find ./ -type f -name '*.pyc' -delete",
  "find src -name '*.orig' -delete",
  "find /tmp/x -delete",
  "find /Users/me/WORK/x/node_modules -delete",
  "find . -name node_modules -type d -prune -exec rm -rf {} +",
  "find /var/log -name '*.gz' -print",
  "find /Users/me -name x -exec rm {} \;",
  "find /Users/me -name x -exec ls -l {} \;",
  "cat list | xargs rm -f",
  "cat list | xargs ls",
  "git branch -d feature/x",
  "git branch -D feature/x",
  "git branch -d main",
  "git branch -m main trunk",
  "git stash",
  "git stash drop",
  "git stash list",
  "drizzle-kit drop",
  "rails db:migrate",
  "php artisan migrate",
  "prisma migrate dev --name reset",
  "prisma db push",
  "mysqladmin status",
  "redis-cli ping",
  "redis-cli keys '*'",
  "mongosh --eval 'db.users.find()'",
  "mongosh --eval 'db.users.deleteMany({a:1})'",
  "mongosh --eval 'db.users.remove({a:1})'",
  "mongodump --db app",
  "aws rds describe-db-instances",
  "wrangler d1 list",
  "az sql db list",
  "gcloud sql instances list",
  "kubectl delete pod web-1",
  "kubectl get statefulset",
];

test("hardening (0.8.0): rm by path, find -delete/-exec rm, xargs rm -r, database CLIs, DELETE without WHERE, block devices, git branch -D and stash clear, rm of .git are denied", () => {
  for (const c of HARDEN_DENIES) assert.notEqual(dangerReason(c, { home }), "", `expected deny for ${JSON.stringify(c)}`);
});

test("hardening (0.8.0): relative and regenerable targets, text-only mentions, DELETE with WHERE, docker rm without -v, dd to a file and find without -delete pass", () => {
  for (const c of HARDEN_ALLOWS) assert.equal(dangerReason(c, { home }), "", `expected allow for ${JSON.stringify(c)}`);
});

test("hardening (0.8.0): reasons name the command, and a forced delete of a protected branch follows the option", () => {
  assert.match(dangerReason("find / -delete", { home }), /^`find \/ \.\.\. -delete` is denied/);
  assert.match(dangerReason("cat list | xargs rm -rf", { home }), /xargs/);
  assert.match(dangerReason("rm -rf .git", { home }), /history/);
  assert.match(dangerReason("psql -c 'DELETE FROM users'", { home }), /WHERE/);
  assert.equal(dangerReason("git branch -D trunk", { home, protectedBranches: ["trunk"] }), "`git branch -D` of protected branch `trunk` is denied.");
  assert.equal(dangerReason("git branch -D main", { home, protectedBranches: ["trunk"] }), "");
});
