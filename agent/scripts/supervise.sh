#!/bin/sh
# Keeps the live agent (texts + calls) running: restarts it if it exits, with a growing pause so a hard failure does not spin.
# Usage: pnpm live:forever   (logs to stdout; redirect to a file if you want to keep them)
cd "$(dirname "$0")/.." || exit 1
delay=2
while :; do
  started=$(date +%s)
  pnpm live
  code=$?
  [ "$code" -eq 0 ] && { echo "[supervise] live exited cleanly (0); not restarting"; exit 0; }
  ran=$(( $(date +%s) - started ))
  [ "$ran" -gt 120 ] && delay=2          # it ran a while: this is a fresh failure, not a crash loop
  echo "[supervise] live exited with $code after ${ran}s; restarting in ${delay}s"
  sleep "$delay"
  [ "$delay" -lt 60 ] && delay=$(( delay * 2 ))
done
