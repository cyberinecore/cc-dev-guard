#!/bin/sh
v=$(node --version 2>/dev/null) || v=""
major=${v#v}
major=${major%%.*}
case "$major" in
  ''|*[!0-9]*) major=0 ;;
esac
if [ "$major" -ge 18 ]; then
  exit 0
fi
if [ -z "$v" ]; then
  found="node was not found on PATH"
else
  found="node $v is older than 18"
fi
printf '{"systemMessage":"devguard: %s, so the devguard write guard is not running in this session. Install Node.js 18 or later and restart Claude Code."}\n' "$found"
