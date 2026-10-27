import { isTextOnly, splitSubcommands, stripCommentLines, stripTextHeredocs } from "./dangerguard.mjs";

const lower = (s) => s.toLowerCase();

export const BROAD_PROCESS_NAMES = new Set(
  [
    "node", "nodejs", "bun", "deno", "python", "python3", "ruby", "perl", "java", "php", "go", "npm", "npx", "pnpm", "yarn",
    "cat", "sh", "bash", "zsh", "fish", "dash", "login", "sudo", "ssh", "sshd", "git", "vim", "nvim", "emacs", "less", "tail", "sleep", "make", "cargo",
    "docker", "dockerd", "com.docker.backend", "claude", "code", "code helper", "electron", "chrome", "google chrome", "google chrome helper", "chromium",
    "safari", "firefox", "arc", "brave browser", "slack", "cursor", "terminal", "iterm", "iterm2", "ghostty", "kitty", "alacritty", "wezterm", "wezterm-gui",
    "tmux", "screen", "xcode", "simulator", "activity monitor", "system events",
  ].map(lower),
);

export const SYSTEM_PROCESS_NAMES = new Set(
  ["dock", "finder", "systemuiserver", "windowserver", "cfprefsd", "loginwindow", "controlcenter", "notificationcenter", "launchd", "kernel_task", "coreaudiod", "mds", "mds_stores", "bluetoothd"].map(lower),
);

const TMUX_COMMANDS = [
  "attach-session", "bind-key", "break-pane", "capture-pane", "choose-buffer", "choose-client", "choose-tree", "clear-history", "clear-prompt-history", "clock-mode",
  "command-prompt", "confirm-before", "copy-mode", "customize-mode", "delete-buffer", "detach-client", "display-menu", "display-message", "display-popup", "display-panes",
  "find-window", "has-session", "if-shell", "join-pane", "kill-pane", "kill-server", "kill-session", "kill-window", "last-pane", "last-window", "link-window",
  "list-buffers", "list-clients", "list-commands", "list-keys", "list-panes", "list-sessions", "list-windows", "load-buffer", "lock-client", "lock-server", "lock-session",
  "move-pane", "move-window", "new-session", "new-window", "next-layout", "next-window", "paste-buffer", "pipe-pane", "previous-layout", "previous-window", "refresh-client",
  "rename-session", "rename-window", "resize-pane", "resize-window", "respawn-pane", "respawn-window", "rotate-window", "run-shell", "save-buffer", "select-layout",
  "select-pane", "select-window", "send-keys", "send-prefix", "server-access", "set-buffer", "set-environment", "set-hook", "set-option", "set-window-option", "show-buffer",
  "show-environment", "show-hooks", "show-messages", "show-options", "show-prompt-history", "show-window-options", "source-file", "split-window", "start-server",
  "suspend-client", "swap-pane", "swap-window", "switch-client", "unbind-key", "unlink-window", "wait-for",
];

const TMUX_ALIASES = {
  attach: "attach-session", breakp: "break-pane", detach: "detach-client", joinp: "join-pane", killp: "kill-pane", killw: "kill-window", linkw: "link-window",
  lockc: "lock-client", lock: "lock-server", locks: "lock-session", movep: "move-pane", movew: "move-window", new: "new-session", neww: "new-window",
  pasteb: "paste-buffer", pipep: "pipe-pane", rename: "rename-session", renamew: "rename-window", resizep: "resize-pane", resizew: "resize-window",
  respawnp: "respawn-pane", respawnw: "respawn-window", rotatew: "rotate-window", selectp: "select-pane", selectw: "select-window", send: "send-keys",
  splitw: "split-window", suspendc: "suspend-client", swapp: "swap-pane", swapw: "swap-window", switchc: "switch-client", unlinkw: "unlink-window",
};

const TMUX_CLIENT_WIDE = new Set(["switch-client", "attach-session", "kill-server", "detach-client", "suspend-client", "lock-server", "lock-session", "lock-client"]);
const TMUX_TARGETED = new Set([
  "kill-session", "rename-session", "kill-window", "kill-pane", "send-keys", "send-prefix", "respawn-pane", "respawn-window", "select-window", "select-pane",
  "swap-pane", "swap-window", "move-window", "move-pane", "join-pane", "break-pane", "link-window", "unlink-window", "paste-buffer", "pipe-pane",
  "resize-pane", "resize-window", "rename-window", "new-window", "split-window", "rotate-window", "select-layout", "next-window", "previous-window", "last-window", "last-pane",
]);
const TMUX_SOURCE_FLAG = new Set(["swap-pane", "swap-window", "move-window", "move-pane", "join-pane", "break-pane", "link-window"]);

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish"]);
const WRITE_BINS = new Set(["tee", "cp", "mv", "install", "ln", "rsync", "ditto", "dd", "touch", "curl", "wget", "plutil"]);
const DESKTOP_BINS = new Set(["pbcopy", "say", "afplay", "cliclick", "terminal-notifier"]);
const reHostsPath = /(^|[\s'"=>])(\/private)?\/etc\/hosts(?=$|[\s'";|&)])/;
const reLaunchdPath = /\/Library\/Launch(Agents|Daemons)\//;
const reAppleDomain = /^(-g|-globalDomain|NSGlobalDomain|com\.apple\.|\/Library\/Preferences\/|.*\/Library\/Preferences\/(com\.apple\.|\.GlobalPreferences))/;

export function shellWords(text) {
  const out = [];
  let cur = "";
  let quoted = false;
  let started = false;
  let bare = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!started) bare = c !== "'" && c !== '"';
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      cur += end < 0 ? text.slice(i + 1) : text.slice(i + 1, end);
      i = end < 0 ? text.length : end;
      quoted = started = true;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === "\\" && j + 1 < text.length) j++;
        cur += text[j];
      }
      i = j;
      quoted = started = true;
      continue;
    }
    if (c === "$" && text[i + 1] === "(") {
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (text[j] === "(") depth++;
        else if (text[j] === ")" && --depth === 0) break;
      }
      cur += text.slice(i, j + 1);
      i = j;
      started = true;
      continue;
    }
    if (c === "\\" && i + 1 < text.length) {
      cur += text[++i];
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) out.push({ w: cur, q: quoted, bare });
      cur = "";
      quoted = started = false;
      continue;
    }
    cur += c;
    started = true;
  }
  if (started) out.push({ w: cur, q: quoted, bare });
  return out;
}

const isAssign = (t) => (!t.q || t.bare) && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t.w);
const SHELL_KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{", "(", "time"]);
const VALUE_FLAGS = {
  sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-U", "-T", "--user", "--group", "--host", "--prompt", "--close-from", "--chdir", "--role", "--type", "--other-user", "--command-timeout"]),
  env: new Set(["-u", "-S", "-P", "-C", "--unset", "--split-string", "--chdir"]),
  nice: new Set(["-n"]),
  timeout: new Set(["-s", "-k", "--signal", "--kill-after"]),
  caffeinate: new Set(["-t", "-w"]),
  xargs: new Set(["-I", "-J", "-L", "-n", "-P", "-E", "-s", "-d", "-a"]),
};
const PREFIX_BINS = new Set(["sudo", "env", "nohup", "time", "command", "exec", "builtin", "noglob", "nice", "timeout", "gtimeout", "caffeinate", "xargs", "doas"]);

export function commandOf(tokens, vars) {
  let i = 0;
  let viaXargs = false;
  for (;;) {
    while (i < tokens.length && isAssign(tokens[i])) {
      const eq = tokens[i].w.indexOf("=");
      vars.set(tokens[i].w.slice(0, eq), tokens[i].w.slice(eq + 1));
      i++;
    }
    if (i >= tokens.length) return null;
    if (!tokens[i].q && SHELL_KEYWORDS.has(tokens[i].w)) {
      i++;
      continue;
    }
    const bin = baseOf(tokens[i].w.replace(/^[({]+/, ""));
    if (bin === "export" || bin === "local" || bin === "readonly") {
      for (const t of tokens.slice(i + 1)) {
        const eq = t.w.indexOf("=");
        if (eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.w.slice(0, eq))) vars.set(t.w.slice(0, eq), t.w.slice(eq + 1));
      }
      return null;
    }
    if (!PREFIX_BINS.has(bin)) return { bin, args: tokens.slice(i + 1), viaXargs };
    if (bin === "xargs") viaXargs = true;
    const valueFlags = VALUE_FLAGS[bin === "gtimeout" ? "timeout" : bin === "doas" ? "sudo" : bin] || new Set();
    i++;
    while (i < tokens.length && tokens[i].w.startsWith("-") && tokens[i].w !== "-") {
      if (tokens[i].w === "--") {
        i++;
        break;
      }
      if (valueFlags.has(tokens[i].w)) i++;
      i++;
    }
    if (bin === "env") while (i < tokens.length && isAssign(tokens[i])) i++;
    if ((bin === "timeout" || bin === "gtimeout") && i < tokens.length) i++;
  }
}

function baseOf(p) {
  const t = p.replace(/^\\/, "").replace(/\/+$/, "");
  return t.slice(t.lastIndexOf("/") + 1);
}

function resolveWord(t, vars) {
  if (!t.w.includes("$") && !t.w.includes("`")) return t.w;
  const m = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/.exec(t.w);
  if (!m) return null;
  const v = vars.get(m[1] || m[2]);
  return v === undefined || v.includes("$") ? null : v;
}

const words = (args) => args.map((t) => t.w);
const ask = (key, reason, extra = {}) => ({ level: "ask", key, reason, ...extra });
const deny = (key, reason) => ({ level: "deny", key, reason });

export function liveCheck(command, { desktop = false, owned = new Set(), sessionExists = () => false } = {}) {
  const ctx = { desktop, owned: new Set(owned), sessionExists, created: [], launches: [], findings: [] };
  if (typeof command === "string" && command !== "") scan(command, ctx, 0);
  const finding = ctx.findings.find((f) => f.level === "deny") || ctx.findings[0] || null;
  return { finding, created: ctx.created, launches: ctx.launches };
}

function scan(cmd, ctx, depth) {
  if (depth > 3) return;
  const vars = new Map();
  const text = stripCommentLines(stripTextHeredocs(cmd)).replace(/\\;/g, ";");
  for (const sub of splitSubcommands(text)) {
    const tokens = shellWords(sub);
    const c = commandOf(tokens, vars);
    if (!c) continue;
    if (c.bin === "tell" || c.bin === "quit" || c.bin === "activate") {
      appleScript(sub, ctx);
      continue;
    }
    if (isTextOnly(sub) && !reHostsPath.test(sub) && !reLaunchdPath.test(sub)) continue;
    judge(c, sub, vars, ctx, depth);
  }
}

function judge({ bin, args, viaXargs }, sub, vars, ctx, depth) {
  const push = (f) => f && ctx.findings.push(f);
  const a = words(args);
  if (SHELLS.has(bin)) {
    const ci = a.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w));
    if (ci >= 0 && ci + 1 < a.length) scan(a[ci + 1], ctx, depth + 1);
    return;
  }
  if (bin === "eval") return scan(a.join(" "), ctx, depth + 1);
  if (bin === "ssh") return sshInner(a, ctx, depth);
  if (viaXargs && (bin === "kill" || bin === "pkill" || bin === "killall")) {
    return push(ask(`xargs-${bin}`, `\`${bin}\` through \`xargs\` stops whatever process ids arrive on stdin (often \`lsof -ti\` or \`pgrep\` output), which can include another project's process or one the user started.`));
  }
  switch (bin) {
    case "pkill":
    case "killall":
      return push(nameKill(bin, a));
    case "kill":
      return push(pidKill(a));
    case "fuser":
      if (a.some((w) => /^-[a-zA-Z]*k/.test(w))) push(ask("fuser-k", "`fuser -k` stops every process using a file or port, whoever started it."));
      return;
    case "kill-port":
      return push(ask("kill-port", "`kill-port` stops whatever process listens on a port, which can be another project's server or the user's own."));
    case "npx":
    case "bunx":
    case "pnpx":
      if (a.some((w) => /^kill-port(@|$)/.test(w) || /^fkill(-cli)?(@|$)/.test(w))) push(ask("kill-port", "killing by port or name through a package (`kill-port`, `fkill`) can stop another project's server or the user's own."));
      return;
    case "shutdown":
    case "reboot":
    case "halt":
    case "poweroff":
      return push(deny(`power-${bin}`, `\`${bin}\` shuts down or restarts the machine the user is working on.`));
    case "systemctl":
      return push(systemctl(a));
    case "launchctl":
      return push(launchctl(a));
    case "tmux":
      return tmux(a, vars, ctx);
    case "osascript":
      return osascript(a, ctx);
    case "open":
      return openApp(a, ctx);
    case "defaults":
      return push(defaultsWrite(a));
    case "networksetup":
      if (a.some((w) => /^-(set|remove|create|delete|add|order|switch|import|detect)/i.test(w))) push(ask("networksetup", "`networksetup` changes the Mac's network settings (DNS, proxy, Wi-Fi, services) for every app the user runs."));
      return;
    case "scutil":
      if (a.includes("--set")) push(ask("scutil-set", "`scutil --set` changes the Mac's host or computer name."));
      return;
    case "pmset":
      if (a.length && !a.some((w) => w.startsWith("-g"))) push(ask("pmset", "`pmset` changes power settings or puts the machine or display to sleep."));
      return;
    case "systemsetup":
      if (a.some((w) => /^-set/i.test(w))) push(ask("systemsetup", "`systemsetup -set*` changes a system setting (time, sleep, remote login, startup disk)."));
      return;
    case "tailscale":
      if (["down", "logout", "up", "set", "switch", "login"].includes(firstOperand(a))) push(ask("tailscale", `\`tailscale ${firstOperand(a)}\` changes the VPN the user's machine and other apps rely on.`));
      return;
    case "wg-quick":
      if (["up", "down"].includes(firstOperand(a))) push(ask("wg-quick", "`wg-quick` brings a WireGuard tunnel up or down for the whole machine."));
      return;
    case "pfctl":
      if (a.some((w) => /^-[a-zA-Z]*[edfFkKX]/.test(w) && !/^-s/.test(w))) push(ask("pfctl", "`pfctl` changes the machine's packet filter (firewall) rules."));
      return;
    case "ifconfig":
      if (a.some((w) => ["down", "up", "delete", "-alias", "alias"].includes(w))) push(ask("ifconfig", "`ifconfig` brings a network interface up or down or changes its address."));
      return;
    case "route":
      if (a.some((w) => ["add", "delete", "change", "flush"].includes(w))) push(ask("route", "`route` changes the machine's routing table."));
      return;
    case "crontab":
      return push(crontab(a));
    case "brew":
      if (a[0] === "services" && ["start", "stop", "restart", "run", "kill", "cleanup"].includes(a[1])) push(ask("brew-services", `\`brew services ${a[1]}\` starts or stops a background service through launchd, which outlives this session.`));
      return;
    case "sfltool":
      if (readOnlySfltool(a)) return;
      return push(ask("sfltool", "`sfltool` changes login items and background task records."));
    case "adb":
      return push(adb(a));
    case "xcrun":
      if (a[0] === "devicectl" && a.some((w) => ["uninstall", "--terminate-existing", "reboot", "erase"].includes(w))) push(ask("devicectl", "`xcrun devicectl` here uninstalls, terminates or restarts something on a physical device the user may be carrying; use a simulator or a named test device."));
      return;
    case "ios-deploy":
      if (a.some((w) => ["--uninstall", "--uninstall_only", "-9", "--uninstall_bundle_id"].includes(w))) push(ask("ios-deploy", "`ios-deploy` here uninstalls an app from a physical device the user may be carrying."));
      return;
    case "rsync":
      push(rsyncDelete(a));
      return push(fileShapes(bin, a, sub));
  }
  if (DESKTOP_BINS.has(bin)) {
    if (ctx.desktop) push(ask(`desktop-${bin}`, `\`${bin}\` acts on the user's desktop (clipboard, sound or input) while they may be using it.`));
    return;
  }
  push(fileShapes(bin, a, sub));
}

const DEST_LAST_BINS = new Set(["cp", "install", "ln", "rsync", "ditto"]);

function fileShapes(bin, a, sub) {
  const writes = WRITE_BINS.has(bin) || ((bin === "sed" || bin === "perl") && a.some((w) => /^-[a-zA-Z]*i/.test(w)));
  if (writes && DEST_LAST_BINS.has(bin)) {
    const dest = " " + (a.filter((w) => !w.startsWith("-")).pop() || "");
    const redirect = sub.replace(/^[^>]*/, "");
    if (!reHostsPath.test(dest) && !reLaunchdPath.test(dest) && !reHostsPath.test(redirect) && !reLaunchdPath.test(redirect)) return null;
  }
  if (reHostsPath.test(sub) && (writes || /(^|[^<])>>?\s*['"]?(\/private)?\/etc\/hosts/.test(sub))) return ask("etc-hosts", "this command writes `/etc/hosts`, which changes name resolution for every app on the machine.");
  if (reLaunchdPath.test(sub) && (writes || />>?\s*['"]?[^\s'"]*\/Library\/Launch(Agents|Daemons)\//.test(sub))) return ask("launchd-plist", "this command writes into a LaunchAgents or LaunchDaemons folder, which installs a job that starts on its own and outlives this session.");
  return null;
}

function firstOperand(a) {
  return a.find((w) => !w.startsWith("-")) || "";
}

function sshInner(a, ctx, depth) {
  const valued = new Set(["-p", "-i", "-l", "-o", "-F", "-J", "-L", "-R", "-D", "-b", "-c", "-E", "-e", "-I", "-m", "-O", "-Q", "-S", "-W", "-w", "-B"]);
  let i = 0;
  for (; i < a.length && a[i].startsWith("-"); i++) if (valued.has(a[i])) i++;
  const rest = a.slice(i + 1);
  if (rest.length) scan(rest.join(" "), ctx, depth + 1);
}

function strippedPattern(p) {
  return p.replace(/^\^/, "").replace(/\$$/, "");
}

const isSignalName = (w) => /^(SIG)?[A-Z][A-Z0-9+-]*$|^\d+$/.test(w);
const isNullSignal = (w) => /^(SIG)?0$/.test(w);

function nameKill(bin, a) {
  const valued = bin === "pkill" ? new Set("FGgjMNPtUus") : new Set("utc");
  const patterns = [];
  let full = false;
  let byUser = false;
  for (let i = 0; i < a.length; i++) {
    const w = a[i];
    if (w === "--") {
      patterns.push(...a.slice(i + 1));
      break;
    }
    if (/^-(\d+|SIG[A-Z0-9]+|[A-Z][A-Z0-9]*)$/.test(w) || w === "--signal") {
      const sig = w === "--signal" ? a[++i] || "" : w.slice(1);
      if (isNullSignal(sig)) return null;
      continue;
    }
    if (/^--signal=/.test(w)) {
      if (isNullSignal(w.slice(9))) return null;
      continue;
    }
    if (/^-[a-zA-Z]+$/.test(w)) {
      const letters = w.slice(1);
      if (bin === "pkill" && letters.includes("f")) full = true;
      if (bin === "killall" && letters === "s" && isSignalName(a[i + 1] || "") && i + 2 < a.length) {
        if (isNullSignal(a[++i])) return null;
        continue;
      }
      if (bin === "killall" && /[sl]/.test(letters)) return null;
      if (/[uUG]/.test(letters)) byUser = true;
      if (bin === "killall" && letters.includes("c") && i + 1 < a.length) patterns.push(a[i + 1]);
      if (valued.has(letters[letters.length - 1])) i++;
      continue;
    }
    if (w.startsWith("--")) {
      if (w === "--full") full = true;
      continue;
    }
    patterns.push(w);
  }
  if (!patterns.length) {
    if (byUser) return deny(`${bin}-user`, `\`${bin}\` with a user or group and no name stops every process of that user, including the user's open apps and this session.`);
    return null;
  }
  for (const raw of patterns) {
    const p = lower(strippedPattern(raw));
    if (SYSTEM_PROCESS_NAMES.has(p)) return deny(`${bin}-system`, `\`${bin} ${raw}\` stops a macOS system process, which resets the user's desktop (Dock, Finder windows, menu bar or the whole login session).`);
    if (BROAD_PROCESS_NAMES.has(p) || p.length <= 3 || /^[.*^$|\\[\]()+?]*$/.test(p)) {
      const how = full || bin === "pkill" ? "every process whose name" + (full ? " or command line" : "") + ` contains \`${raw}\`` : `every process named \`${raw}\``;
      return deny(`${bin}-broad`, `\`${bin}${full ? " -f" : ""} ${raw}\` stops ${how} on this machine: other projects' servers, the user's editor and apps, and Claude Code itself.`);
    }
  }
  return ask(`${bin}-name:${patterns.join(" ")}`, `\`${bin}${full ? " -f" : ""} ${patterns.join(" ")}\` stops processes by name or pattern, which can hit another project's process or one the user started. Prefer \`kill <PID>\` of the process this session started.`);
}

function pidKill(a) {
  let i = 0;
  if (a[0] === "-l" || a[0] === "-L") return null;
  const signal = a[0] === "-s" || a[0] === "-n" ? a[1] || "" : /^-[^-]/.test(a[0] || "") ? a[0].slice(1) : "";
  if (isNullSignal(signal)) return null;
  if (a[0] === "-s" || a[0] === "-n") i = 2;
  else if (a[0] && a[0].startsWith("-") && a[0] !== "--") i = 1;
  if (a[i] === "--") i++;
  let found = null;
  for (const t of a.slice(i)) {
    if (t === "-1" || t === "0" || t === "-0") return deny("kill-all", `\`kill ${t}\` signals every process the user owns (or the whole process group), which closes the user's apps and this session.`);
    if (/^-\d+$/.test(t)) found ||= ask(`kill-group:${t}`, `\`kill ${t}\` signals a whole process group, which may belong to the user's terminal or another project.`);
    else if (t.startsWith("$(") || t.startsWith("`")) found ||= substitutionKill(t);
  }
  return found;
}

function substitutionKill(t) {
  const inner = t.replace(/^\$\(|\)$|^`|`$/g, "");
  const toks = shellWords(inner).map((x) => x.w);
  const bin = baseOf(toks[0] || "");
  if (["cat", "head", "tail", "jq", "<"].includes(bin) || inner.startsWith("<")) return null;
  if (bin === "pgrep" || bin === "pidof") {
    const names = toks.slice(1).filter((w) => !w.startsWith("-"));
    if (names.some((n) => BROAD_PROCESS_NAMES.has(lower(strippedPattern(n))) || SYSTEM_PROCESS_NAMES.has(lower(strippedPattern(n))) || strippedPattern(n).length <= 3)) {
      return deny("kill-pgrep-broad", `\`kill ${t}\` stops every process matching a common name, including other projects, the user's apps and Claude Code itself.`);
    }
    return ask(`kill-pgrep:${names.join(" ")}`, `\`kill ${t}\` stops processes found by name, which can include another project's process or one the user started. Prefer the PID this session recorded when it started the process.`);
  }
  if (bin === "lsof") return ask(`kill-port:${inner}`, `\`kill ${t}\` stops whatever process holds that port or file, which can be another project's server or the user's own.`);
  return ask(`kill-subst:${inner}`, `\`kill ${t}\` stops process ids computed at run time, which the guard cannot check.`);
}

function systemctl(a) {
  const sub = firstOperand(a);
  if (["poweroff", "reboot", "halt", "kexec", "suspend", "hibernate", "hybrid-sleep", "rescue", "emergency"].includes(sub)) return deny(`systemctl-${sub}`, `\`systemctl ${sub}\` shuts down, restarts or suspends the machine.`);
  if (["stop", "restart", "disable", "mask", "kill", "isolate", "try-restart", "reload-or-restart", "try-reload-or-restart"].includes(sub)) return ask(`systemctl-${sub}:${a.join(" ")}`, `\`systemctl ${sub}\` stops or restarts a service that the user or other machines may be using.`);
  return null;
}

function launchctl(a) {
  const sub = firstOperand(a);
  if (sub === "reboot") return deny("launchctl-reboot", "`launchctl reboot` restarts the machine or the user's login session.");
  if (["load", "unload", "bootstrap", "bootout", "enable", "disable", "kickstart", "kill", "remove", "submit", "start", "stop"].includes(sub)) {
    return ask(`launchctl-${sub}`, `\`launchctl ${sub}\` installs, removes, starts or stops a launchd job, which outlives this session or stops something the user runs.`);
  }
  return null;
}

function crontab(a) {
  const rest = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "-u") i++;
    else rest.push(a[i]);
  }
  if (rest.length === 1 && rest[0] === "-l") return null;
  return ask("crontab", "`crontab` here replaces or removes the user's cron table, and a job installed there runs after this session ends.");
}

function defaultsWrite(a) {
  let i = 0;
  while (i < a.length && (a[i] === "-currentHost" || a[i] === "-host")) i += a[i] === "-host" ? 2 : 1;
  const sub = a[i];
  if (!["write", "delete", "import", "rename"].includes(sub)) return null;
  const domain = a[i + 1] || "";
  if (!reAppleDomain.test(domain)) return null;
  return ask(`defaults-${domain}`, `\`defaults ${sub} ${domain}\` changes a macOS system or global preference that stays after this session.`);
}

function adb(a) {
  let i = 0;
  let emulator = false;
  for (; i < a.length && a[i].startsWith("-"); i++) {
    if (a[i] === "-e") emulator = true;
    if (a[i] === "-s" || a[i] === "-t" || a[i] === "-H" || a[i] === "-P" || a[i] === "-L") {
      if (a[i] === "-s" && /^emulator-/.test(a[i + 1] || "")) emulator = true;
      i++;
    }
  }
  if (emulator) return null;
  const sub = a[i];
  const rest = a.slice(i + 1).join(" ");
  if (["uninstall", "install", "install-multiple", "reboot", "root", "remount", "disable-verity"].includes(sub)) return ask(`adb-${sub}`, `\`adb ${sub}\` changes a physical device the user may be carrying; use an emulator (\`-e\` or \`-s emulator-...\`) or a named test device.`);
  if (sub === "shell" && /\b(am\s+(force-stop|kill|kill-all)|pm\s+(clear|uninstall|disable)|reboot|svc\s)/.test(rest)) return ask("adb-shell", `\`adb shell ${rest}\` stops an app, clears its data or restarts a physical device the user may be carrying.`);
  return null;
}

const RSYNC_VALUED = new Set([
  "-e", "--rsh", "--exclude", "--include", "--filter", "-f", "--exclude-from", "--include-from", "--files-from", "--log-file", "--log-file-format", "--password-file",
  "--backup-dir", "--suffix", "-T", "--temp-dir", "--compare-dest", "--copy-dest", "--link-dest", "--chmod", "--chown", "--usermap", "--groupmap", "--rsync-path",
  "--timeout", "--contimeout", "--port", "--bwlimit", "--max-size", "--min-size", "--max-delete", "--partial-dir", "-B", "--block-size", "-M", "--remote-option",
  "--out-format", "--skip-compress", "--iconv", "--sockopts", "--address", "--write-batch", "--only-write-batch", "--read-batch", "--checksum-choice", "--compress-choice",
]);

function rsyncDelete(a) {
  const del = a.some((w) => /^--del(ete(-[a-z]+)?)?$|^--remove-source-files$/.test(w));
  if (!del) return null;
  if (a.some((w) => w === "--dry-run" || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w))) return null;
  const operands = [];
  for (let i = 0; i < a.length; i++) {
    if (RSYNC_VALUED.has(a[i])) {
      i++;
      continue;
    }
    if (!a[i].startsWith("-")) operands.push(a[i]);
  }
  const dest = operands[operands.length - 1] || "";
  if (!/^rsync:\/\//.test(dest) && !/^[^/]*[^/\\]:/.test(dest)) return null;
  return ask(`rsync-delete:${dest}`, `\`rsync --delete\` to the remote \`${dest}\` removes files there that the source lacks; run it once with \`-n\` and show the user what would go.`);
}

function tmux(a, vars, ctx) {
  let i = 0;
  let ownSocket = false;
  for (; i < a.length && a[i].startsWith("-"); i++) {
    if (a[i] === "-L" || a[i] === "-S") {
      ownSocket = true;
      i++;
    } else if (a[i] === "-f" || a[i] === "-c" || a[i] === "-T") i++;
  }
  const cmd = resolveTmux(a[i] || "");
  const args = a.slice(i + 1);
  const flag = (f) => {
    const k = args.indexOf(f);
    return k >= 0 ? args[k + 1] : undefined;
  };
  if (cmd === "new-session") {
    const name = flag("-s");
    if (name !== undefined && !ownSocket) {
      const resolved = resolveWord({ w: name }, vars);
      if (resolved && !ctx.owned.has(resolved) && !ctx.sessionExists(resolved)) {
        ctx.created.push(resolved);
        ctx.owned.add(resolved);
      }
    }
    return;
  }
  if (ownSocket || !cmd) return;
  if (TMUX_CLIENT_WIDE.has(cmd)) {
    if (cmd === "attach-session" && args.includes("-r")) return;
    ctx.findings.push(ask(`tmux-${cmd}`, `\`tmux ${cmd}\` acts on the user's tmux client or server: it can move the user's terminal to another session, detach it or end every session. Use your own server (\`tmux -L <name>\`) for sessions this run starts.`));
    return;
  }
  if (!TMUX_TARGETED.has(cmd)) return;
  if (cmd === "kill-session" && args.includes("-a")) {
    ctx.findings.push(ask("tmux-kill-session-a", "`tmux kill-session -a` ends every session except one, including the user's own."));
    return;
  }
  const targets = [flag("-t"), TMUX_SOURCE_FLAG.has(cmd) ? flag("-s") : undefined].filter((t) => t !== undefined);
  if (!targets.length) targets.push("");
  for (const raw of targets) {
    const t = raw === "" ? "" : resolveWord({ w: raw }, vars);
    const session = t ? t.replace(/^=/, "").split(":")[0].split(".")[0] : "";
    if (session && !/^[$@%]/.test(session) && ctx.owned.has(session)) continue;
    const what = raw === "" ? "with no target, so it acts on the user's current session" : t === null ? `on \`${raw}\`, a target the guard cannot resolve` : `on \`${t}\`, a session this session did not create`;
    ctx.findings.push(ask(`tmux-${cmd}:${t ?? raw}`, `\`tmux ${cmd}\` runs ${what}; it can type into, rearrange or close the user's own terminal. Create the session in this run (\`tmux new-session -d -s <name>\`) or use your own server (\`tmux -L <name>\`).`));
    return;
  }
}

function resolveTmux(name) {
  if (!name) return "";
  if (TMUX_COMMANDS.includes(name)) return name;
  if (TMUX_ALIASES[name]) return TMUX_ALIASES[name];
  const hits = TMUX_COMMANDS.filter((c) => c.startsWith(name));
  return hits.length === 1 ? hits[0] : "";
}

function osascript(a, ctx) {
  const scripts = [];
  for (let i = 0; i < a.length; i++) if (a[i] === "-e" && i + 1 < a.length) scripts.push(a[++i]);
  for (const s of scripts) appleScript(s, ctx);
}

function appleScript(s, ctx) {
  const push = (f) => ctx.findings.push(f);
  if (/system events/i.test(s) && /\b(shut\s*down|restart|log\s*out)\b/i.test(s)) return push(deny("osascript-power", "this AppleScript shuts down, restarts or logs out the user's Mac."));
  if (/\bmake\s+(new\s+)?login\s+item\b/i.test(s)) push(ask("osascript-login-item", "this AppleScript adds a login item, which starts on every login after this session."));
  for (const m of s.matchAll(/\btell\s+app(?:lication)?\s+(?:id\s+)?"([^"]+)"[^\n]*?\b(activate|launch|run|reopen|quit)\b/gi)) {
    if (/^system events$/i.test(m[1])) continue;
    if (lower(m[2]) === "quit") push(ask(`osascript-quit:${m[1]}`, `this AppleScript quits \`${m[1]}\`, which the user may have open.`));
    else ctx.launches.push(m[1]);
  }
  for (const m of s.matchAll(/\b(?:quit|activate)\s+app(?:lication)?\s+"([^"]+)"/gi)) {
    if (/^quit/i.test(m[0])) push(ask(`osascript-quit:${m[1]}`, `this AppleScript quits \`${m[1]}\`, which the user may have open.`));
    else ctx.launches.push(m[1]);
  }
  if (!ctx.desktop) return;
  if (/\b(keystroke|key\s+code|click)\b/i.test(s) && /system events/i.test(s)) push(ask("osascript-input", "this AppleScript sends keystrokes or clicks to whatever window the user has in front."));
  else if (/\bdisplay\s+(dialog|alert|notification)\b/i.test(s)) push(ask("osascript-dialog", "this AppleScript shows a dialog or notification on the user's screen."));
  else if (/\bset\s+volume\b/i.test(s)) push(ask("osascript-volume", "this AppleScript changes the user's sound volume."));
  else if (/\bset\s+the\s+clipboard\b/i.test(s)) push(ask("osascript-clipboard", "this AppleScript replaces what the user copied."));
  else if (/\bactivate\b/i.test(s)) push(ask("osascript-activate", "this AppleScript brings an app to the front, taking focus from the user."));
}

function openApp(a, ctx) {
  let app = "";
  let background = false;
  const targets = [];
  for (let i = 0; i < a.length; i++) {
    const w = a[i];
    if (w === "--args") break;
    if (w === "-a" || w === "-b") {
      app = a[++i] || "";
      continue;
    }
    if (w === "--env" || w === "-o" || w === "-i" || w === "--stdout" || w === "--stderr" || w === "--stdin" || w === "-u" || w === "--url") {
      i++;
      continue;
    }
    if (/^-[a-zA-Z]+$/.test(w)) {
      if (w.includes("g") || w.includes("j")) background = true;
      if (w.includes("R")) return;
      if (/[ab]$/.test(w)) app = a[++i] || "";
      continue;
    }
    targets.push(w);
  }
  if (!app) app = targets.map((t) => /([^/]+)\.app\/?$/.exec(t)?.[1]).find(Boolean) || "";
  if (app) ctx.launches.push(app.replace(/\.app\/?$/, "").replace(/^.*\//, ""));
  if (ctx.desktop && !background) ctx.findings.push(ask(`open:${app || targets.join(" ")}`, "`open` brings a window to the front and takes focus from the user; use `open -g` or give the user a link."));
}

export function liveFileReason(path, home = "") {
  if (typeof path !== "string" || path === "") return "";
  const slashed = path.replace(/\\/g, "/");
  const p = slashed.startsWith("~/") && home ? home.replace(/\\/g, "/") + slashed.slice(1) : slashed;
  if (/^(\/private)?\/etc\/hosts$/.test(p)) return "`/etc/hosts` controls name resolution for every app on the machine.";
  if (reLaunchdPath.test(p)) return `\`${path}\` is in a LaunchAgents or LaunchDaemons folder: a job there starts on its own and outlives this session.`;
  if (/^(\/private)?\/(usr\/lib\/cron\/tabs|var\/at\/tabs)\//.test(p)) return `\`${path}\` is a cron table: a job there runs after this session ends.`;
  return "";
}

function readOnlySfltool(args) {
  const plain = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (/^(\d*|&)>>?/.test(w) || /^\d*</.test(w)) {
      if (/^(\d*|&)>>?$/.test(w) || /^\d*<$/.test(w)) i++;
      continue;
    }
    plain.push(w);
  }
  return plain.length > 0 && plain.every((w) => w === "dumpbtm" || w === "-h" || w === "--help");
}
