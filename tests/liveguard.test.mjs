import { strict as assert } from "node:assert";
import { test } from "node:test";
import { liveCheck, liveFileReason } from "../scripts/lib/liveguard.mjs";

const level = (cmd, opts) => liveCheck(cmd, opts).finding?.level ?? "pass";

const DENIES = [
  "pkill -f cat",
  "pkill -f \"cat\"",
  "pkill node",
  "pkill -9 node",
  "sudo pkill -x claude",
  "killall node",
  "killall -9 \"Google Chrome\"",
  "killall Dock",
  "killall Finder SystemUIServer",
  "pkill -u me",
  "killall -u me",
  "pkill -f .",
  "pkill -f vi",
  "kill -9 -1",
  "kill -- -1",
  "kill 0",
  "kill -s KILL -1",
  "kill $(pgrep node)",
  "kill -9 $(pgrep -f python)",
  "bash -c \"pkill node\"",
  "ssh homelab 'killall node'",
  "sudo shutdown -h now",
  "reboot",
  "systemctl reboot",
  "launchctl reboot",
  "osascript -e 'tell application \"System Events\" to restart'",
  "nohup pkill node",
  "timeout 5 killall Finder",
];

const ASKS = [
  "pkill -f \"vite --port 4173\"",
  "pkill -f next-server",
  "killall MyApp",
  "kill $(lsof -ti:3000)",
  "kill -9 $(lsof -t -i tcp:5173)",
  "lsof -ti:3000 | xargs kill -9",
  "kill -- -4242",
  "fuser -k 3000/tcp",
  "npx kill-port 3000",
  "tmux switch-client -t other",
  "tmux switchc -t other",
  "tmux attach -t main",
  "tmux kill-server",
  "tmux kill-session -t main",
  "tmux kill-ses -t main",
  "tmux send-keys -t main 'ls' Enter",
  "tmux send-keys 'ls' Enter",
  "tmux kill-session -t \"$NAME\"",
  "tmux kill-session -a -t mine",
  "tmux select-window -t 2",
  "defaults write com.apple.dock autohide -bool true",
  "defaults write -g ApplePressAndHoldEnabled -bool false",
  "defaults -currentHost write NSGlobalDomain x 1",
  "sudo networksetup -setdnsservers Wi-Fi 1.1.1.1",
  "sudo scutil --set HostName box",
  "sudo pmset -a sleep 0",
  "pmset sleepnow",
  "tailscale down",
  "echo '127.0.0.1 app.test' | sudo tee -a /etc/hosts",
  "sudo sh -c 'echo 127.0.0.1 x >> /etc/hosts'",
  "sudo sed -i '' '/app.test/d' /etc/hosts",
  "launchctl load ~/Library/LaunchAgents/x.plist",
  "launchctl bootstrap gui/501 x.plist",
  "cp x.plist ~/Library/LaunchAgents/",
  "cat > ~/Library/LaunchAgents/x.plist <<'EOF'\n<plist/>\nEOF",
  "crontab -",
  "crontab -r",
  "(crontab -l; echo '* * * * * x') | crontab -",
  "brew services start postgresql",
  "adb install -r app.apk",
  "adb uninstall com.x",
  "adb shell am force-stop com.x",
  "adb shell pm clear com.x",
  "adb -s R58M123 reboot",
  "xcrun devicectl device process launch --terminate-existing --device X com.x",
  "xcrun devicectl device uninstall app --device X com.x",
  "rsync -av --delete dist/ homelab:/srv/www/",
  "rsync -a --delete-after ./ user@host:/data",
  "ssh homelab 'sudo systemctl restart caddy'",
  "systemctl stop nginx",
  "osascript -e 'tell application \"Safari\" to quit'",
  "osascript -e 'tell application \"System Events\" to make login item at end with properties {path:\"/A.app\"}'",
];

const PASSES = [
  "kill 4242",
  "kill -9 4242 4243",
  "kill $SERVER_PID",
  "kill \"$(cat .local/dev.pid)\"",
  "kill %1",
  "kill -l",
  "pgrep -fl node",
  "killall -s node",
  "ps aux | grep node",
  "echo pkill node",
  "git commit -m \"stop using pkill node\"",
  "grep -rn 'tmux kill-server' docs",
  "tmux -L mine kill-server",
  "tmux -S /tmp/sock kill-session -t x",
  "tmux new-session -d -s cx codex",
  "NAME=cx; tmux new-session -d -s \"$NAME\" codex; tmux send-keys -t \"$NAME\" -l hi",
  "tmux capture-pane -p -t main",
  "tmux list-sessions",
  "tmux has-session -t main",
  "tmux attach -r -t main",
  "defaults read com.apple.dock",
  "defaults write com.example.myapp key 1",
  "pmset -g batt",
  "networksetup -listallnetworkservices",
  "tailscale status",
  "cat /etc/hosts",
  "grep app.test /etc/hosts",
  "launchctl list",
  "crontab -l",
  "brew services list",
  "adb devices",
  "adb -e install app.apk",
  "adb -s emulator-5554 uninstall com.x",
  "xcrun simctl uninstall booted com.x",
  "rsync -av --delete dist/ ../backup/",
  "rsync -avn --delete dist/ homelab:/srv/www/",
  "rsync -av --delete --dry-run dist/ homelab:/srv/www/",
  "rsync -av dist/ homelab:/srv/www/",
  "systemctl status nginx",
  "open -a Safari https://example.com",
  "open README.md",
  "pbcopy < x.txt",
  "say done",
  "osascript -e 'display dialog \"hi\"'",
];

test("broad or system-wide process stops and power commands are denied", () => {
  for (const c of DENIES) assert.equal(level(c), "deny", `expected deny for ${JSON.stringify(c)}`);
});

test("kills by name, pattern or port, tmux on foreign sessions, system settings, launchd, cron, devices and remote rsync --delete ask", () => {
  for (const c of ASKS) assert.equal(level(c), "ask", `expected ask for ${JSON.stringify(c)}`);
});

test("PID kills, read-only commands, own tmux sessions, emulators, dry runs and text mentions pass", () => {
  for (const c of PASSES) assert.equal(level(c), "pass", `expected pass for ${JSON.stringify(c)}`);
});

test("a deny wins over an earlier ask in the same command", () => {
  assert.equal(level("tmux send-keys -t main ls; pkill node"), "deny");
});

test("tmux targets created in an earlier call pass when the session owns them", () => {
  assert.equal(level("tmux kill-session -t cx"), "ask");
  assert.equal(level("tmux kill-session -t cx", { owned: new Set(["cx"]) }), "pass");
  assert.equal(level("tmux send-keys -t =cx:0.1 Enter", { owned: new Set(["cx"]) }), "pass");
  assert.equal(level("tmux send-keys -t %3 Enter", { owned: new Set(["cx"]) }), "ask");
  assert.deepEqual(liveCheck("tmux new-session -d -s build-1 make").created, ["build-1"]);
  assert.deepEqual(liveCheck("tmux new-session -d -s \"$N\" make").created, []);
});

test("app launches are reported for the relaunch budget", () => {
  assert.deepEqual(liveCheck("open -a \"Session Deck\"").launches, ["Session Deck"]);
  assert.deepEqual(liveCheck("open -na /Applications/Foo.app").launches, ["Foo"]);
  assert.deepEqual(liveCheck("open ~/Applications/Session\\ Deck.app").launches, ["Session Deck"]);
  assert.deepEqual(liveCheck("osascript -e 'tell application \"Session Deck\" to activate'").launches, ["Session Deck"]);
  assert.deepEqual(liveCheck("open -R ~/Applications/Foo.app").launches, []);
  assert.deepEqual(liveCheck("open README.md").launches, []);
});

test("the desktop pack asks only when it is on", () => {
  for (const c of ["pbcopy < x.txt", "say done", "afplay /System/Library/Sounds/Glass.aiff", "open README.md", "osascript -e 'display dialog \"hi\"'", "osascript -e 'tell application \"System Events\" to keystroke \"v\" using command down'", "osascript -e 'set volume output volume 80'"]) {
    assert.equal(level(c), "pass", c);
    assert.equal(level(c, { desktop: true }), "ask", c);
  }
  assert.equal(level("open -g README.md", { desktop: true }), "pass");
});

test("file-tool targets that install jobs or change name resolution are named", () => {
  const home = "/Users/me";
  assert.notEqual(liveFileReason("/etc/hosts", home), "");
  assert.notEqual(liveFileReason("/private/etc/hosts", home), "");
  assert.notEqual(liveFileReason("/Users/me/Library/LaunchAgents/x.plist", home), "");
  assert.notEqual(liveFileReason("~/Library/LaunchAgents/x.plist", home), "");
  assert.notEqual(liveFileReason("/Library/LaunchDaemons/x.plist", home), "");
  assert.equal(liveFileReason("/Users/me/WORK/app/hosts", home), "");
  assert.equal(liveFileReason("/Users/me/WORK/app/Library/LaunchAgentsX/a", home), "");
  assert.equal(liveFileReason(undefined, home), "");
});
