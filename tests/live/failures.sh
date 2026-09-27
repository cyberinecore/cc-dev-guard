#!/usr/bin/env bash
set -u
here=$(cd "$(dirname "$0")" && pwd -P)
plugin=$(cd "$here/../.." && pwd -P)
model=${PROBE_MODEL:-haiku}
work=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/dgfail.XXXXXX")" && pwd -P)

variant() {
  local name=$1 script=$2 timeout=$3
  local dir="$work/plugins/$name"
  mkdir -p "$dir"
  cp -R "$plugin/.claude-plugin" "$plugin/scripts" "$plugin/hooks" "$dir/"
  if [ -n "$script" ]; then printf '%s\n' "$script" > "$dir/scripts/devguard.mjs"; fi
  if [ "$name" = missing-script ]; then rm "$dir/scripts/devguard.mjs"; fi
  if [ "$name" = engine-fails-to-load ]; then printf 'export const main = ;\n' > "$dir/scripts/lib/cli.mjs"; fi
  node -e 'const f=process.argv[1],t=Number(process.argv[2]);const h=JSON.parse(require("fs").readFileSync(f,"utf8"));h.hooks.PreToolUse[0].hooks[0].timeout=t;require("fs").writeFileSync(f,JSON.stringify(h,null,2))' "$dir/hooks/hooks.json" "$timeout"
  printf '%s\n' "$dir"
}

fixture() {
  local root
  root=$(cd "$(mktemp -d "$work/fx.XXXXXX")" && pwd -P)
  for r in a b; do mkdir -p "$root/$r"; git -C "$root/$r" init -q; done
  printf '%s\n' "$root"
}

row() {
  local label=$1 dir=$2 path_env=$3
  local F; F=$(fixture)
  local t0 t1
  t0=$(date +%s)
  (cd "$F/a" && printf 'Use the Write tool once to create %s/b/x.txt with content "x". If it is refused, do not retry. Reply DONE.\n' "$F" | env PATH="$path_env" claude -p --model "$model" --setting-sources project --plugin-dir "$dir" --dangerously-skip-permissions --debug-file "$work/$label.debug" > "$work/$label.out" 2>&1)
  t1=$(date +%s)
  local written=no
  [ -e "$F/b/x.txt" ] && written=yes
  local seen
  seen=$(grep -m1 -o -E 'Hook PreToolUse[^"]{0,120}(error|timed out|failed|returned)[^"]{0,80}|hook error[^"]{0,120}|timed out[^"]{0,80}' "$work/$label.debug" | head -1)
  printf '| %s | %s | %ss | %s |\n' "$label" "$written" "$((t1 - t0))" "${seen:-(nothing in the debug log)}"
}

claude_bin=$(command -v claude)
base_path="$(dirname "$claude_bin"):/usr/bin:/bin:/usr/sbin:/sbin"
node_path="$(dirname "$(command -v node)"):$base_path"
printf '# devguard failure contract\n\n%s, model %s, bypassPermissions, write into another repository\n\n' "$(claude --version)" "$model"
printf '| case | target written | wall time | what the debug log says |\n|---|---|---|---|\n'
row baseline "$(variant baseline '' 15)" "$node_path"
row missing-node "$(variant missing-node '' 15)" "$base_path"
row missing-script "$(variant missing-script '' 15)" "$node_path"
row entry-crashes-before-output "$(variant crash-before-output 'throw new Error("boom at load");' 15)" "$node_path"
row engine-fails-to-load "$(variant engine-fails-to-load '' 15)" "$node_path"
row malformed-output "$(variant malformed-output 'process.stdout.write("this is not json {\n");' 15)" "$node_path"
row exit-2-stderr "$(variant exit-2-stderr 'process.stderr.write("devguard exit-2 probe\n"); process.exit(2);' 15)" "$node_path"
row timeout "$(variant timeout 'await new Promise((r) => setTimeout(r, 20000));' 2)" "$node_path"
printf '\nwork dir: %s\n' "$work"
