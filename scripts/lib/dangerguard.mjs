export const DEFAULT_PROTECTED_BRANCHES = ["main", "master", "production", "prod", "development", "develop", "dev", "release", "staging"];
export const ESCAPE_ENV = "CY_ALLOW_DANGER";

const reAwsS3Delete = /\baws\s+(?:[-\w]+\s+)*?s3\s+(rm|rb)\b/i;
const reAwsS3ApiDel = /\baws\s+(?:[-\w]+\s+)*?s3api\s+delete-(bucket|object|objects)\b/i;
const reSQLDrop = /\bDROP\s+(DATABASE|SCHEMA|TABLE)/i;
const reSQLTruncate = /\btruncate\s+(?:table\s+|only\s+)?(?:"[^"]+"|`[^`]+`|[A-Za-z_][\w.$]*)(?=[\s;'"`)\\,/*]|--|$)/i;
const reHeredoc = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/g;
const reBareMktemp = /(["']?)\$\(mktemp(?:\s+[-\w./]+)*\s*\)\1(?=\s|$)/g;
const reTerraformDestroy = /\bterraform\s+(?:[-\w]+\s+)*?destroy\b/;
const reKubectlDelete = /\bkubectl\s+(?:[-\w]+\s+)*?delete\s+(?:[-\w]+\s+)*?(namespace|ns|pv|pvc|--all|-A)\b/;
const reDockerPrune = /\bdocker\s+(system\s+prune|volume\s+(rm|prune))\b/;
const reComposeDownV = /\bdocker\s+compose\b[^\n;&|]*\bdown\b[^\n;&|]*(\s-v\b|\s--volumes\b)/;
const reGitResetHard = /\bgit\s+(?:-C\s+\S+\s+)?reset\s+(?:[-\w]+\s+)*?--hard\b/;
const reGitDiscard = /\bgit\s+(?:-C\s+\S+\s+)?(checkout\s+--\s+\.|checkout\s+\.\s*$|restore\s+\.\s*$|restore\s+(?:--worktree\s+)?--\s+\.)/;
const reGitClean = /\bgit\s+(?:-C\s+\S+\s+)?clean\s+(?:[-\w]+\s+)*?-[a-zA-Z]*f/;
const reGitPush = /\bgit\s+(?:-C\s+\S+\s+)?push\b([^\n;&|]*)/g;
const reForceFlag = /(^|\s)(--force|-f|-[a-eg-zA-Z]*f[a-zA-Z]*)(\s|$)/;
const reMacTmpDir = /^(\/private)?\/var\/folders\/[^/]+\/[^/]+\/T\/[^/]/;
const reRm = /(^|\s|;|&&|\|\|)\s*(sudo\s+)?rm\s+([^\n;&|]*)/g;

const REGENERABLE_DIRS = new Set(["node_modules", "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache", "coverage", "target", "__pycache__", ".pytest_cache", ".mypy_cache", ".venv", "venv", ".parcel-cache", ".vite", ".svelte-kit", "tmp", ".tmp", "temp", ".DS_Store"]);
const TEXT_TOOLS = new Set(["echo", "printf", "grep", "rg", "egrep", "fgrep", "ugrep", "sed", "awk", "cat", "head", "tail", "less", "more", "wc", "sort", "uniq", "cut", "tr", "diff", "comm", "tee", "jq", "yq", "column", "fold", "nl", "od", "xxd"]);
const GIT_TEXT_SUBCOMMANDS = new Set(["log", "grep", "show", "diff", "blame"]);
const WRAPPER_BINS = new Set(["ssh", "bash", "sh", "zsh", "eval", "xargs", "sudo", "nohup", "timeout", "gtimeout", "caffeinate", "env", "script"]);
const QUOTED_ARG_BINS = new Set(["git", "gh", "jira", "curl"]);
const HEREDOC_SINK_BINS = new Set(["cat", "tee"]);

const fields = (s) => s.split(/\s+/).filter(Boolean);
const baseName = (p) => {
  const t = p.replace(/\/+$/, "");
  if (t === "") return p.startsWith("/") ? "/" : ".";
  return t.slice(t.lastIndexOf("/") + 1);
};
const isAssignment = (t) => t.includes("=") && !t.startsWith("=");

function splitSubcommands(cmd) {
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

function isTextOnly(sub) {
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

function quotedStrings(sub) {
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

function unquotedAt(line, index) {
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

function stripTextHeredocs(cmd) {
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

function stripCommentLines(cmd) {
  return cmd
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
}

export function dangerReason(command, { home = "", protectedBranches = DEFAULT_PROTECTED_BRANCHES, awsS3 = true } = {}) {
  if (typeof command !== "string" || command === "") return "";
  const opts = { home, protectedBranches: new Set(protectedBranches), awsS3 };
  return guardDepth(command, 0, opts);
}

function guardDepth(cmd, depth, opts) {
  if (depth > 3) return "";
  for (const sub of splitSubcommands(stripCommentLines(stripTextHeredocs(cmd)))) {
    if (isTextOnly(sub)) continue;
    const [bin] = firstBin(sub);
    const scan = QUOTED_ARG_BINS.has(bin) ? stripQuotedArgs(sub) : sub;
    const r = subcommandReason(scan, opts);
    if (r) return r;
    if (isWrapper(sub)) {
      for (const inner of quotedStrings(sub)) {
        const ri = guardDepth(inner, depth + 1, opts);
        if (ri) return ri;
      }
    }
  }
  return "";
}

function subcommandReason(s, opts) {
  if (opts.awsS3 && (reAwsS3Delete.test(s) || reAwsS3ApiDel.test(s))) return "`aws s3 rm/rb` and `aws s3api delete-*` are denied (they delete buckets or objects).";
  if (reSQLDrop.test(s) || reSQLTruncate.test(s)) return "DROP DATABASE/SCHEMA/TABLE and TRUNCATE are denied.";
  if (reTerraformDestroy.test(s)) return "`terraform destroy` is denied.";
  if (reKubectlDelete.test(s)) return "`kubectl delete` of a namespace, pv/pvc, or --all is denied.";
  if (reDockerPrune.test(s) || reComposeDownV.test(s)) return "`docker system prune`, `docker volume rm/prune` and `docker compose down -v` are denied (they delete volumes).";
  if (reGitResetHard.test(s) || reGitDiscard.test(s) || reGitClean.test(s)) return "`git reset --hard`, `git checkout -- .`, `git restore .` and `git clean -f` discard uncommitted work; denied.";
  return gitPushReason(s, opts) || rmReason(s, opts) || "";
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

function rmReason(cmd, { home }) {
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
    for (const t of targets) {
      const r = rmTargetReason(t, home);
      if (r) return r;
    }
  }
  return "";
}

const VAR_OK = ["$CLAUDE_JOB_DIR", "$TMPDIR", "${CLAUDE_JOB_DIR", "${TMPDIR"];

function rmTargetReason(raw, home) {
  const t = raw.replace(/^["']+|["']+$/g, "");
  if (t === "") return "";
  if (t.startsWith("$") && !VAR_OK.some((p) => t.startsWith(p))) return `recursive rm of \`${raw}\` is denied: the target is a shell variable the guard cannot resolve; write the literal path.`;
  if (t === "*" || t === "." || t === ".." || t === "/" || t === "~" || t === "~/" || t.startsWith("../") || (t.endsWith("/*") && (t.startsWith("/") || t.startsWith("~")) && !isTmpPath(t, home))) return `recursive rm of \`${raw}\` is denied.`;
  const base = baseName(t.endsWith("/") ? t.slice(0, -1) : t);
  if (REGENERABLE_DIRS.has(base) || isTmpPath(t, home) || t.includes("/.claude/worktrees/")) return "";
  if (!t.startsWith("/") && !t.startsWith("~") && !t.startsWith("$")) return "";
  const expanded = t.startsWith("~") ? home + t.slice(1) : t;
  if (home && (expanded === home || expanded === home + "/")) return "recursive rm of the home directory is denied.";
  return `recursive rm of absolute path \`${raw}\` is denied (only tmp dirs, .claude/worktrees, and regenerable build/cache dirs are allowed).`;
}

function isTmpPath(t, home) {
  if (t === ".." || t.startsWith("../") || t.endsWith("/..") || t.includes("/../")) return false;
  if (reMacTmpDir.test(t)) return true;
  const prefixes = ["/tmp/", "/private/tmp/", "/var/tmp/", "/private/var/tmp/", "$TMPDIR", "${TMPDIR", "$CLAUDE_JOB_DIR", "${CLAUDE_JOB_DIR", "~/.claude/jobs/"];
  if (home) prefixes.push(home + "/.claude/jobs/");
  return prefixes.some((p) => t.startsWith(p));
}
