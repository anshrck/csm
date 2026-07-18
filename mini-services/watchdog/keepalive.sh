#!/usr/bin/env bash
# CereBree uSMS — Server Keepalive (tiny, ~2MB, survives OOM)
# Pings the dev server every 30s; restarts it if dead.
# The in-process watchdog (inside the server) handles reviews/lint.

PROJECT="/home/z/my-project"
LOG="$PROJECT/mini-services/watchdog/keepalive.log"
PORT=3000
HEALTH="http://localhost:$PORT/api/auth/me"

while true; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH" 2>/dev/null)
  if [ "$CODE" != "200" ]; then
    echo "[$(date -Iseconds)] keepalive: server down (http=$CODE), restarting..." >> "$LOG"
    # Kill any stale next processes
    pkill -9 -f "next-server" 2>/dev/null
    pkill -9 -f "next dev" 2>/dev/null
    sleep 2
    cd "$PROJECT"
    NODE_OPTIONS="--max-old-space-size=1536" setsid bun run dev > dev.log 2>&1 < /dev/null &
    echo "[$(date -Iseconds)] keepalive: restart issued, waiting for boot..." >> "$LOG"
    # Wait up to 90s for it to come up
    for i in $(seq 1 30); do
      sleep 3
      CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$HEALTH" 2>/dev/null)
      if [ "$CODE" = "200" ]; then
        echo "[$(date -Iseconds)] keepalive: server back up after ${i}x3s" >> "$LOG"
        break
      fi
    done
  fi
  sleep 30
done
