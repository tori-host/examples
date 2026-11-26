#!/bin/bash
# The entry guards of the examples that import their own dependencies,
# started through a symlink. A guard that compares import.meta.url with a
# path that is not resolved the same way skips its body and exits 0 having
# done nothing, so each has to refuse, by its message, both ways Node can be
# started through a link. Run from the repository root, after `npm ci` in
# misty-heron and mossy-starling.
set -u
link=$(mktemp -d)/examples
ln -s "$PWD" "$link"
status=0
guard() {
  local script=$1 needle=$2; shift 2
  for flags in "" "--preserve-symlinks-main"; do
    if out=$(env -u DATABASE_URL PORT=not-a-port node $flags "$link/$script" "$@" 2>&1); then
      echo "FAIL $script ${flags:-(plain)}: exited 0 through a symlink, so its guard skipped it"; status=1; continue
    fi
    if ! grep -qF "$needle" <<<"$out"; then
      echo "FAIL $script ${flags:-(plain)}: did not refuse with '$needle':"; echo "$out"; status=1; continue
    fi
    echo "ok   $script ${flags:-(plain)}: runs through a symlink and refuses"
  done
}
guard crimson-finch/server.mjs "takes no arguments" --bogus
guard misty-heron/server.js "PORT must be a port number"
guard mossy-starling/server.mjs "PORT must be a port number"
guard mossy-starling/migrate.mjs "DATABASE_URL is not set"
exit $status
