#!/usr/bin/env bash
# CereBree uSMS — Watchdog Supervisor
# Restarts the watchdog (bun index.ts) if it ever exits/crashes.
# This makes the every-minute review loop self-healing.

cd "$(dirname "$0")"
LOG="watchdog-supervisor.log"
WD_LOG="watchdog.log"

while true; do
  echo "[$(date -Iseconds)] supervisor: starting watchdog..." >> "$LOG"
  # Run watchdog; blocks until it exits
  bun index.ts >> watchdog-stdout.log 2>&1
  EXIT=$?
  echo "[$(date -Iseconds)] supervisor: watchdog exited (code $EXIT), restarting in 5s..." >> "$LOG"
  sleep 5
done
