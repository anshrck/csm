#!/usr/bin/env bash
# CereBree uSMS — Bulletproof self-restarting dev server launcher
# Wraps `next dev` in an infinite restart loop so the server ALWAYS comes back
# after an OOM kill or crash. Started with setsid for full detachment.

cd /home/z/my-project

LOG="/home/z/my-project/dev.log"
RESTART_LOG="/home/z/my-project/mini-services/watchdog/restarts.log"

while true; do
  echo "[$(date -Iseconds)] live: starting dev server..." >> "$RESTART_LOG"
  NODE_OPTIONS="--max-old-space-size=1280" bun run dev > "$LOG" 2>&1
  EXIT=$?
  echo "[$(date -Iseconds)] live: server exited (code $EXIT), restarting in 3s..." >> "$RESTART_LOG"
  # Kill any stale next processes before restart
  pkill -9 -f "next-server" 2>/dev/null
  pkill -9 -f "next dev" 2>/dev/null
  sleep 3
done
