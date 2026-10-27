export const DEFAULT_PROTECTED_BRANCHES = ["main", "master", "production", "prod", "development", "develop", "dev", "release", "staging"];
export const ESCAPE_ENV = "CY_ALLOW_DANGER";

const reAwsS3Delete = /\baws\s+(?:[-\w]+\s+)*?s3\s+(rm|rb)\b/i;
const reAwsS3ApiDel = /\baws\s+(?:[-\w]+\s+)*?s3api\s+delete-(bucket|object|objects)\b/i;
const reSQLDrop = /\bDROP\s+(DATABASE|SCHEMA|TABLE)/i;
const sqlIdent = String.raw`(?:"[^"]+"|\`[^\`]+\`|[A-Za-z_][\w.$]*)`;
const sqlIdentList = String.raw`${sqlIdent}(?:\s*,\s*${sqlIdent})*`;
const sqlTruncateOption = String.raw`\s+(?:cascade|restrict|restart|continue)\b`;
const reSQLTruncateTable = new RegExp(String.raw`\btruncate\s+table\s+(?:only\s+)?${sqlIdent}(?=[\s;'"\`)\\,/*]|--|$)`, "im");
const reSQLTruncateLead = new RegExp(String.raw`(?:^|[;'"\`(]|\*/)\s*truncate\s+(?:only\s+)?${sqlIdentList}(?:\s*(?:[;'"\`)\\*]|--|/\*|$)|${sqlTruncateOption})`, "im");
const reSQLTruncateEnd = new RegExp(String.raw`\btruncate\s+(?:only\s+)?${sqlIdentList}(?:\s*(?:[;\\*]|--|/\*|$)|${sqlTruncateOption})`, "im");
const reHeredoc = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/g;
const reBareMktemp = /(["']?)\$\(mktemp(?:\s+[-\w./]+)*\s*\)\1(?=\s|$)/g;
const reTerraformDestroy = /\bterraform\s+(?:[-\w]+\s+)*?destroy\b/;
const reKubectlDelete = /\bkubectl\s+(?:[-\w]+\s+)*?delete\s+(?:[-\w]+\s+)*?(namespace|ns|pv|pvc|statefulsets?|sts|--all|-A)\b/;
const reDockerPrune = /\bdocker\s+(system\s+prune|volume\s+(rm|prune))\b/;
const reComposeDownV = /\bdocker\s+compose\b[^\n;&|]*\bdown\b[^\n;&|]*(\s-v\b|\s--volumes\b)/;
const reGitResetHard = /\bgit\s+(?:-C\s+\S+\s+)?reset\s+(?:[-\w]+\s+)*?--hard\b/;
const reGitDiscard = /\bgit\s+(?:-C\s+\S+\s+)?(checkout\s+--\s+\.|checkout\s+\.\s*$|restore\s+\.\s*$|restore\s+(?:--worktree\s+)?--\s+\.)/;
const reGitClean = /\bgit\s+(?:-C\s+\S+\s+)?clean\s+(?:[-\w]+\s+)*?-[a-zA-Z]*f/;
const reGitPush = /\bgit\s+(?:-C\s+\S+\s+)?push\b([^\n;&|]*)/g;
const reForceFlag = /(^|\s)(--force|-f|-[a-eg-zA-Z]*f[a-zA-Z]*)(\s|$)/;
const reMacTmpDir = /^(\/private)?\/var\/folders\/[^/]+\/[^/]+\/T\/[^/]/;
const reRm = /(^|\s|;|&&|\|\|)\s*(sudo\s+)?(?:\\|[^\s;&|]*\/)?rm\s+([^\n;&|]*)/g;
const reFind = /(^|\s|;|&&|\|\|)\s*(?:sudo\s+)?(?:[^\s;&|]*\/)?find\s+([^\n;&|]*)/g;
const reRmBin = /^(?:\\|[^\s;&|]*\/)?rm$/;
const reDropdb = /(^|\s|\/)dropdb(?:\s|$)/;
const reMysqladminDrop = /\bmysqladmin\s+(?:\S+\s+)*?drop\b/;
const reRedisFlush = /\bredis-cli\b[^\n;&|]*\bflush(?:all|db)\b/i;
const reBareFlush = /^\s*flush(?:all|db)(?:\s+(?:async|sync))?\s*$/i;
const reMongoShell = /(^|\s|\/)mongo(?:sh)?\s/;
const reMongoDestroy = /\.dropDatabase\s*\(|\.drop\s*\(|\.(?:deleteMany|remove)\s*\(\s*\{\s*\}\s*\)/;
const reBareMongo = /^\s*db(?:\.\w+|\[[^\]]+\])*\.(?:dropDatabase\s*\(|drop\s*\(|(?:deleteMany|remove)\s*\(\s*\{\s*\}\s*\))/;
const rePrismaReset = /\bprisma\s+(?:\S+\s+)*?(?:migrate\s+reset\b|db\s+push\b[^\n;&|]*\s--force-reset\b)/;
const reRailsDrop = /\b(?:rails|rake)\s+(?:\S+\s+)*?db:(?:drop|reset|schema:load)\b/;
const reArtisanFresh = /\bartisan\s+(?:\S+\s+)*?(?:migrate:fresh|db:wipe)\b/;
const reSequelizeDrop = /\bsequelize(?:-cli)?\s+(?:\S+\s+)*?db:drop\b/;
const reTypeormDrop = /\btypeorm\s+(?:\S+\s+)*?schema:drop\b/;
const reWranglerD1 = /\bwrangler\s+(?:\S+\s+)*?d1\s+delete\b/;
const reAwsRds = /\baws\s+(?:\S+\s+)*?rds\s+delete-db-(?:instance|cluster)\b/;
const reAwsDynamo = /\baws\s+(?:\S+\s+)*?dynamodb\s+delete-table\b/;
const reAzSqlDb = /\baz\s+(?:\S+\s+)*?sql\s+db\s+delete\b/;
const reAzCosmos = /\baz\s+(?:\S+\s+)*?cosmosdb\b[^\n;&|]*\sdelete\b/;
const reGcloudSql = /\bgcloud\s+(?:\S+\s+)*?sql\s+(?:instances|databases)\s+delete\b/;
const reDockerRm = /\bdocker\s+(?:-\S+\s+)*(?:container\s+|compose\s+(?:\S+\s+)*?)?rm\s+([^\n;&|]*)/;
const reVolumesFlag = /(^|\s)(--volumes|-[a-zA-Z]*v[a-zA-Z]*)(\s|$)/;
const reSQLDelete = /\bDELETE\s+FROM\s+(?:ONLY\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w.$]*)/gi;
const reDdDevice = /\bdd\b[^\n;&|]*\sof=["']?\/dev\/(?!(?:null|zero|full|random|urandom|stdout|stderr)\b|tty|fd\/)/;
const reMkfs = /(^|\s|\/)(?:mkfs(?:\.[\w-]+)?|wipefs)\s/;
const reGitBranch = /\bgit\s+(?:-C\s+\S+\s+)?branch\s+([^\n;&|]*)/;
const reBranchDeleteD = /(^|\s)-[a-zA-Z]*D[a-zA-Z]*(\s|$)/;
const reBranchDelete = /(^|\s)(--delete|-[a-zA-Z]*d[a-zA-Z]*)(\s|$)/;
const reGitStashClear = /\bgit\s+(?:-C\s+\S+\s+)?stash\s+clear\b/;

const reTagMention = /cachedir\.tag/i;
const TAG_WRITE_BINS = new Set(["cp", "mv", "ln", "install", "rsync", "ditto", "tar", "unzip", "dd", "tee", "touch", "curl", "wget", "scp"]);
const REGENERABLE_DIRS =new Set(["node_modules", "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache", "coverage", "target", "__pycache__", ".pytest_cache", ".mypy_cache", ".venv", "venv", ".parcel-cache", ".vite", ".svelte-kit", "tmp", ".tmp", "temp", ".DS_Store"]);
const TEXT_TOOLS = new Set(["echo", "printf", "grep", "rg", "egrep", "fgrep", "ugrep", "sed", "awk", "cat", "head", "tail", "less", "more", "wc", "sort", "uniq", "cut", "tr", "diff", "comm", "tee", "jq", "yq", "column", "fold", "nl", "od", "xxd"]);
const GIT_TEXT_SUBCOMMANDS = new Set(["log", "grep", "show", "diff", "blame"]);
const WRAPPER_BINS = new Set(["ssh", "bash", "sh", "zsh", "eval", "xargs", "sudo", "nohup", "timeout", "gtimeout", "caffeinate", "env", "script"]);
const QUOTED_ARG_BINS = new Set(["git", "gh", "glab", "jira", "linear", "curl", "cyberine"]);
const HEREDOC_SINK_BINS = new Set(["cat", "tee"]);

const fields = (s) => s.split(/\s+/).filter(Boolean);
const baseName = (p) => {
  const t = p.replace(/\/+$/, "");
  if (t === "") return p.startsWith("/") ? "/" : ".";
  return t.slice(t.lastIndexOf("/") + 1);
};
const isAssignment = (t) => t.includes("=") && !t.startsWith("=");

export function splitSubcommands(cmd) {
  const parts = [];
  let cur = "";
  let q = "";
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      cur += c;
      if (c === "\\" && q === '"' && i + 1 < cmd.length) {
        cur += cmd[++i];
        continue;
      }
      if (c === q) q = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      q = c;
      cur += c;
      continue;
    }
    if (c === "|" || c === "&" || c === ";" || c === "\n") {
      if (cur.trim() !== "") parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts;
}

export function isTextOnly(sub) {
  let toks = fields(sub);
  while (toks.length && (isAssignment(toks[0]) || toks[0] === "sudo" || toks[0] === "env" || toks[0] === "time")) toks = toks.slice(1);
  if (!toks.length) return true;
  const bin = baseName(toks[0]);
  if (TEXT_TOOLS.has(bin)) return true;
  if (bin === "git") {
    for (const t of toks.slice(1)) {
      if (t.startsWith("-")) continue;
      return GIT_TEXT_SUBCOMMANDS.has(t);
    }
  }
  return false;
}

function firstBin(sub) {
  let toks = fields(sub);
  while (toks.length && isAssignment(toks[0])) toks = toks.slice(1);
  if (!toks.length) return ["", []];
  return [baseName(toks[0]), toks];
}

function isWrapper(sub) {
  const [bin, toks] = firstBin(sub);
  if (!bin) return false;
  if (WRAPPER_BINS.has(bin) || bin.endsWith(".sh")) return true;
  if ((bin === "docker" || bin === "kubectl") && toks.length > 1) {
    for (const t of toks.slice(1)) {
      if (t.startsWith("-")) continue;
      return t === "exec";
    }
  }
  return false;
}

export function quotedStrings(sub) {
  const out = [];
  let cur = "";
  let q = "";
  for (let i = 0; i < sub.length; i++) {
    const c = sub[i];
    if (q) {
      if (c === "\\" && q === '"' && i + 1 < sub.length) {
        cur += sub[++i];
        continue;
      }
      if (c === q) {
        out.push(cur);
        cur = "";
        q = "";
        continue;
      }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') q = c;
  }
  return out;
}

function stripQuotedArgs(sub) {
  let b = "";
  let q = "";
  for (let i = 0; i < sub.length; i++) {
    const c = sub[i];
    if (q) {
      if (c === "\\" && q === '"' && i + 1 < sub.length) {
        i++;
        continue;
      }
      if (c === q) q = "";
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      continue;
    }
    b += c;
  }
  return b;
}

export function unquotedAt(line, index) {
  const stack = [];
  for (let i = 0; i < index; i++) {
    const c = line[i];
    const top = stack[stack.length - 1];
    if (top === "'") {
      if (c === "'") stack.pop();
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "$" && line[i + 1] === "(") {
      stack.push("(");
      i++;
      continue;
    }
    if (top === "(" && c === ")") {
      stack.pop();
      continue;
    }
    if (top === '"') {
      if (c === '"') stack.pop();
      continue;
    }
    if (c === "'" || c === '"') stack.push(c);
  }
  return !stack.includes("'") && stack[stack.length - 1] !== '"';
}

function heredocSinkOnly(line, m) {
  const before = line.slice(0, m.index);
  const after = line.slice(m.index + m[0].length);
  if (!unquotedAt(line, m.index)) return false;
  if (/[<>]\(/.test(line) || /\\\s*$/.test(line) || /\|/.test(after)) return false;
  if ([...line.matchAll(reHeredoc)].length !== 1) return false;
  const sub = before.lastIndexOf("$(");
  const cut = Math.max(sub, before.lastIndexOf("|"), before.lastIndexOf(";"), before.lastIndexOf("&"));
  if (!HEREDOC_SINK_BINS.has(leadingBin(before.slice(cut + 1).replace(/^\(/, "")))) return false;
  if (cut !== sub || sub < 0) return true;
  const outer = before.slice(0, sub);
  const outerCut = Math.max(outer.lastIndexOf("$("), outer.lastIndexOf("|"), outer.lastIndexOf(";"), outer.lastIndexOf("&"));
  return outerCut < 0 && leadingBin(outer) === "git";
}

function leadingBin(text) {
  let toks = fields(text);
  while (toks.length && (isAssignment(toks[0]) || toks[0] === "sudo")) toks = toks.slice(1);
  return toks.length ? baseName(toks[0]) : "";
}

export function stripTextHeredocs(cmd) {
  const lines = cmd.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const docs = [...line.matchAll(reHeredoc)];
    if (docs.length !== 1 || !heredocSinkOnly(line, docs[0])) continue;
    const m = docs[0];
    const delimiter = m[3];
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if ((m[1] === "-" ? lines[j].replace(/^\t+/, "") : lines[j]) === delimiter) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    const body = lines.slice(i + 1, end);
    if (!m[2] && body.some((l) => l.includes("$(") || l.includes("`"))) continue;
    out.push(lines[end]);
    i = end;
  }
  return out.join("\n");
}

export function stripCommentLines(cmd) {
  return cmd
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
}

export function dangerReason(command, { home = "", configDir = "", protectedBranches = DEFAULT_PROTECTED_BRANCHES, awsS3 = true, isCacheDir = null, isRepoRoot = null, root = "", cwd = "" } = {}) {
  if (typeof command !== "string" || command === "") return "";
  const opts = { home: home.replace(/\/+$/, ""), configDir, protectedBranches: new Set(protectedBranches), awsS3, isCacheDir, isRepoRoot, root, cwd };
  return tagWriteShapeReason(command) || guardDepth(command, 0, opts);
}

export const TAG_WRITE_REASON = "writing a CACHEDIR.TAG file is denied: danger_guard lets a recursive rm through for a directory that carries one, so only the tool that owns the cache may create it.";

export function isCacheDirTagPath(path) {
  return typeof path === "string" && baseName(path.replace(/\\/g, "/")).toUpperCase() === "CACHEDIR.TAG";
}

function tagWriteShapeReason(cmd) {
  for (const sub of splitSubcommands(stripCommentLines(stripTextHeredocs(cmd)))) {
    if (!reTagMention.test(sub)) continue;
    const [bin] = firstBin(sub);
    if (tagRedirect(sub) || TAG_WRITE_BINS.has(bin)) return TAG_WRITE_REASON;
  }
  return "";
}

function tagRedirect(sub) {
  for (let i = sub.indexOf(">"); i >= 0; i = sub.indexOf(">", i + 1)) {
    if (!unquotedAt(sub, i)) continue;
    let j = i + 1;
    if (sub[j] === ">" || sub[j] === "|") j++;
    if (sub[j] === "&") continue;
    const m = /^\s*("[^"]*"|'[^']*'|[^\s;&|<>]+)/.exec(sub.slice(j));
    const target = m ? m[1].replace(/^["']|["']$/g, "") : "";
    if (target === "/dev/null" || target === "/dev/stderr" || target === "/dev/stdout") continue;
    if (target === "") continue;
    if (reTagMention.test(target) || target.includes("$") || target.includes("`")) return true;
  }
  return false;
}

const HEREDOC_NOTE = " The match is in a heredoc body fed to an interpreter; if that text is data written into a file, write the file with a plain cat heredoc first.";
const QUOTED_NOTE = (bin) => ` The match is inside a quoted string handed to \`${bin}\`, which runs it as a command.`;

function guardDepth(cmd, depth, opts) {
  if (depth > 3) return "";
  const stripped = stripCommentLines(stripTextHeredocs(cmd));
  const bodies = depth === 0 ? heredocBodyLines(stripped) : [];
  const inBody = (text) => bodies.some((l) => l.includes(text.trim()));
  const scans = [];
  for (const sub of splitSubcommands(stripped)) {
    if (isTextOnly(sub)) continue;
    const [bin] = firstBin(sub);
    const scan = QUOTED_ARG_BINS.has(bin) ? stripQuotedArgs(sub) : sub;
    scans.push(scan);
    const r = subcommandReason(scan, opts);
    if (r) return inBody(sub) ? r + HEREDOC_NOTE : r;
    if (isWrapper(sub)) {
      for (const inner of quotedStrings(sub)) {
        const ri = guardDepth(inner, depth + 1, opts);
        if (ri) return depth === 0 ? ri + QUOTED_NOTE(bin) : ri;
      }
    }
  }
  const sql = sqlDeleteReason(scans.join("\n"));
  const reDeleteOnce = new RegExp(reSQLDelete.source, "i");
  return sql && bodies.some((l) => reDeleteOnce.test(l)) ? sql + HEREDOC_NOTE : sql;
}

function heredocBodyLines(cmd) {
  const lines = cmd.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = [...lines[i].matchAll(reHeredoc)][0];
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if ((m[1] === "-" ? lines[j].replace(/^\t+/, "") : lines[j]) === m[3]) {
        i = j;
        break;
      }
      out.push(lines[j]);
    }
  }
  return out;
}

function subcommandReason(s, opts) {
  if (opts.awsS3 && (reAwsS3Delete.test(s) || reAwsS3ApiDel.test(s))) return "`aws s3 rm/rb` and `aws s3api delete-*` are denied (they delete buckets or objects).";
  if (reSQLDrop.test(s) || reSQLTruncateTable.test(s) || reSQLTruncateLead.test(s) || reSQLTruncateEnd.test(s)) return "DROP DATABASE/SCHEMA/TABLE and TRUNCATE are denied.";
  if (reTerraformDestroy.test(s)) return "`terraform destroy` is denied.";
  if (reKubectlDelete.test(s)) return "`kubectl delete` of a namespace, pv/pvc, statefulset, or --all is denied.";
  if (reDockerPrune.test(s) || reComposeDownV.test(s)) return "`docker system prune`, `docker volume rm/prune` and `docker compose down -v` are denied (they delete volumes).";
  if (reGitResetHard.test(s) || reGitDiscard.test(s) || reGitClean.test(s)) return "`git reset --hard`, `git checkout -- .`, `git restore .` and `git clean -f` discard uncommitted work; denied.";
  if (reGitStashClear.test(s)) return "`git stash clear` drops every stash entry; denied.";
  if (reDropdb.test(s) || reMysqladminDrop.test(s)) return "`dropdb` and `mysqladmin drop` are denied (they delete a database).";
  if (reRedisFlush.test(s) || reBareFlush.test(s)) return "`redis-cli FLUSHALL`/`FLUSHDB` is denied (it deletes every key).";
  if ((reMongoShell.test(s) && reMongoDestroy.test(s)) || reBareMongo.test(s)) return "`dropDatabase()`, `.drop()`, `deleteMany({})` and `remove({})` in a mongo shell are denied (they delete a database or collection).";
  if (rePrismaReset.test(s) || reRailsDrop.test(s) || reArtisanFresh.test(s) || reSequelizeDrop.test(s) || reTypeormDrop.test(s)) return "database resets through an ORM CLI (`prisma migrate reset`, `prisma db push --force-reset`, `rails db:drop`/`db:reset`/`db:schema:load`, `rake db:drop`, `artisan migrate:fresh`/`db:wipe`, `sequelize db:drop`, `typeorm schema:drop`) are denied.";
  if (reWranglerD1.test(s) || reAwsRds.test(s) || reAwsDynamo.test(s) || reAzSqlDb.test(s) || reAzCosmos.test(s) || reGcloudSql.test(s)) return "deleting a managed database (`wrangler d1 delete`, `aws rds delete-db-instance`/`delete-db-cluster`, `aws dynamodb delete-table`, `az sql db delete`, `az cosmosdb ... delete`, `gcloud sql instances/databases delete`) is denied.";
  if (reDdDevice.test(s) || reMkfs.test(s)) return "`dd of=/dev/<device>`, `mkfs` and `wipefs` are denied (they overwrite a block device).";
  return dockerRmReason(s) || gitBranchReason(s, opts) || gitPushReason(s, opts) || findReason(s, opts) || rmReason(s, opts) || "";
}

function sqlDeleteReason(cmd) {
  for (const m of cmd.matchAll(reSQLDelete)) {
    const end = cmd.indexOf(";", m.index);
    const statement = cmd.slice(m.index, end < 0 ? cmd.length : end);
    if (!/\bWHERE\b/i.test(statement)) return "`DELETE FROM` without a `WHERE` clause is denied (it empties the table).";
  }
  return "";
}

function dockerRmReason(cmd) {
  const m = reDockerRm.exec(cmd);
  if (m && reVolumesFlag.test(m[1])) return "`docker rm -v`/`--volumes` is denied (it deletes the container's volumes).";
  return "";
}

function gitBranchReason(cmd, { protectedBranches }) {
  const m = reGitBranch.exec(cmd);
  if (!m) return "";
  const args = m[1];
  if (!reBranchDeleteD.test(args) && !(reBranchDelete.test(args) && reForceFlag.test(args))) return "";
  for (const t of fields(m[1])) {
    if (!t.startsWith("-") && protectedBranches.has(t)) return `\`git branch -D\` of protected branch \`${t}\` is denied.`;
  }
  return "";
}

function findReason(cmd, opts) {
  for (const m of cmd.matchAll(reFind)) {
    const toks = fields(m[2]);
    const roots = [];
    let i = 0;
    for (; i < toks.length; i++) {
      const t = toks[i];
      if (t === "-H" || t === "-L" || t === "-P" || /^-O\d*$/.test(t)) continue;
      if (t === "-D") {
        i++;
        continue;
      }
      if (t.startsWith("-") || t === "!" || t === "(" || t === "\\(") break;
      roots.push(t);
    }
    if (!roots.length) roots.push(".");
    let destructive = "";
    for (; i < toks.length; i++) {
      if (toks[i] === "-delete") destructive = "-delete";
      if ((toks[i] === "-exec" || toks[i] === "-execdir") && recursiveRmAt(toks, i + 1)) destructive = toks[i] + " rm -r";
    }
    if (!destructive) continue;
    for (const root of roots) {
      if (root === ".") continue;
      const r = rmTargetReason(root, opts);
      if (r) return `\`find ${root} ... ${destructive}\` is denied (${r.replace(/\.$/, "")}).`;
    }
  }
  return "";
}

function recursiveRmAt(toks, i) {
  if (toks[i] === "sudo") i++;
  if (!reRmBin.test(toks[i] || "")) return false;
  for (let j = i + 1; j < toks.length; j++) {
    const t = toks[j];
    if (t === "{}" || t === ";" || t === "\\;" || t === "+") break;
    if (t === "--recursive" || (/^-[a-zA-Z]+$/.test(t) && /[rR]/.test(t))) return true;
  }
  return false;
}

function gitPushReason(cmd, { protectedBranches }) {
  for (const m of cmd.matchAll(reGitPush)) {
    const args = m[1];
    const forced = reForceFlag.test(args) || args.includes(" +");
    if (!forced) continue;
    if (args.includes("--force-with-lease") && !args.includes("--force ") && !reForceFlag.test(args.replaceAll("--force-with-lease", ""))) continue;
    let named = false;
    for (const tok of fields(args)) {
      let t = tok.startsWith("+") ? tok.slice(1) : tok;
      const i = t.lastIndexOf(":");
      if (i >= 0) t = t.slice(i + 1);
      if (t.startsWith("refs/heads/")) t = t.slice("refs/heads/".length);
      if (protectedBranches.has(t)) return `force-push to protected branch \`${t}\` is denied.`;
      if (!tok.startsWith("-")) named = true;
    }
    if (!named) return "force-push with no explicit branch is denied (the current branch may be protected); name the branch.";
  }
  return "";
}

function rmReason(cmd, opts) {
  for (const m of cmd.matchAll(reRm)) {
    let recursive = false;
    const targets = [];
    for (const t of fields(m[3].replace(reBareMktemp, " "))) {
      if (t === "--") continue;
      if (t.startsWith("--")) {
        if (t === "--recursive") recursive = true;
        continue;
      }
      if (t.startsWith("-") && t.length > 1) {
        if (/[rR]/.test(t.slice(1))) recursive = true;
        continue;
      }
      targets.push(t);
    }
    if (!recursive) continue;
    if (leadingBin(cmd.slice(0, m.index)) === "xargs") return "recursive rm through `xargs` is denied: the targets come from stdin and cannot be resolved; write the literal paths.";
    for (const t of targets) {
      const r = rmTargetReason(t, opts);
      if (r) return r;
    }
  }
  return "";
}

const VAR_OK = ["$CLAUDE_JOB_DIR", "$TMPDIR", "${CLAUDE_JOB_DIR", "${TMPDIR"];

function rmTargetReason(raw, { home, configDir, isCacheDir, isRepoRoot, root = "", cwd = "" }) {
  const t = raw.replace(/^["']+|["']+$/g, "");
  if (t === "") return "";
  if (t.startsWith("$") && !VAR_OK.some((p) => t.startsWith(p))) return `recursive rm of \`${raw}\` is denied: the target is a shell variable the guard cannot resolve; write the literal path.`;
  if (t === "*" || t === "." || t === ".." || t === "/" || t === "~" || t === "~/" || t.startsWith("../") || (t.endsWith("/*") && (t.startsWith("/") || t.startsWith("~")) && !isTmpPath(t, home, configDir))) return `recursive rm of \`${raw}\` is denied.`;
  const base = baseName(t.endsWith("/") ? t.slice(0, -1) : t);
  if (base === ".git") return `recursive rm of \`${raw}\` is denied (it destroys the repository's history).`;
  if (isTmpPath(t, home, configDir) || t.includes("/.claude/worktrees/")) return "";
  const relative = !t.startsWith("/") && !t.startsWith("~") && !t.startsWith("$");
  const expanded = t.startsWith("~") ? home + t.slice(1) : t;
  const abs = relative ? (cwd.startsWith("/") ? joinPosix(cwd, t) : "") : expanded.replace(/\/+$/, "") || "/";
  if (REGENERABLE_DIRS.has(base)) {
    const why = abs ? regenerableExclusion(abs, { home, isRepoRoot: cacheDirCandidate(raw, abs) ? isRepoRoot : null }) : "";
    if (!why) return "";
    return `recursive rm of \`${raw}\` is denied: ${why}.`;
  }
  if (relative) return "";
  if (home && (expanded === home || expanded === home + "/")) return "recursive rm of the home directory is denied.";
  if (cacheDirCandidate(raw, expanded)) {
    if (isCacheDir && isCacheDir(abs)) return "";
    if (scratchAncestor(abs, { home, root, isCacheDir, isRepoRoot })) return "";
  }
  return `recursive rm of absolute path \`${raw}\` is denied (only tmp dirs, .claude/worktrees, regenerable build/cache dirs, directories carrying a CACHEDIR.TAG, and paths below one of those inside the repository or home are allowed).`;
}

function joinPosix(dir, rel) {
  const out = dir.replace(/\/+$/, "").split("/");
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/") || "/";
}

const dirNamePosix = (p) => {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
};

function regenerableExclusion(abs, { home, isRepoRoot }) {
  if (abs.split("/").includes(".git")) return "it is inside a `.git` directory";
  if (home && dirNamePosix(abs) === home.replace(/\/+$/, "")) return "a folder directly in the home directory is not treated as a build or cache directory";
  if (isRepoRoot && isRepoRoot(abs)) return "it is the root of a git repository, not a build or cache directory inside one";
  return "";
}

function scratchAncestor(abs, { home, root, isCacheDir, isRepoRoot }) {
  const stops = new Set(["/", home.replace(/\/+$/, ""), root.replace(/\/+$/, "")].filter(Boolean));
  for (let dir = dirNamePosix(abs); !stops.has(dir); dir = dirNamePosix(dir)) {
    if (isRepoRoot && isRepoRoot(dir)) return false;
    if (REGENERABLE_DIRS.has(baseName(dir)) && !regenerableExclusion(dir, { home, isRepoRoot })) return true;
    if (isCacheDir && isCacheDir(dir)) return true;
  }
  return false;
}

function cacheDirCandidate(raw, expanded) {
  if (/^["']/.test(raw) !== /["']$/.test(raw)) return false;
  if (!expanded.startsWith("/") || /[*?[\]{}$`\\]/.test(expanded)) return false;
  return !expanded.split("/").some((seg) => seg === "." || seg === ".." || seg === ".git");
}

function isTmpPath(t, home, configDir = "") {
  if (t === ".." || t.startsWith("../") || t.endsWith("/..") || t.includes("/../")) return false;
  if (reMacTmpDir.test(t)) return true;
  const prefixes = ["/tmp/", "/private/tmp/", "/var/tmp/", "/private/var/tmp/", "$TMPDIR", "${TMPDIR", "$CLAUDE_JOB_DIR", "${CLAUDE_JOB_DIR", "~/.claude/jobs/"];
  if (home) prefixes.push(home + "/.claude/jobs/");
  const cfg = configDir.replace(/\/+$/, "");
  if (cfg.startsWith("/") && cfg !== home) prefixes.push(cfg + "/jobs/");
  return prefixes.some((p) => t.startsWith(p));
}
