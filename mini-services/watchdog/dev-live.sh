#!/usr/bin/env bash
# CereBree uSMS — Self-restarting dev launcher
# Wraps `bun run dev` in a restart loop so the server auto-recovers from OOM/crash.
# The in-process watchdog (src/lib/watchdog.ts) runs inside the server every 60s.

cd /home/z/my-project
echo "[$(date -Iseconds)] dev:live: starting self-restarting dev server..." >> mini-services/watchdog/devlive.log

while true; do
  NODE_OPTIONS="--max-old-space-size=1536" bun run dev
  EXIT=$?
  echo "[$(date -Iseconds)] dev:live: server exited (code $EXIT), restarting in 3s..." >> mini-services/watchdog/devlive.log
  # Clear any stale state
  pkill -9 -f "next-server" 2>/dev/null
  sleep 3
done
