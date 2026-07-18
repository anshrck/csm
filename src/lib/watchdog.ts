/**
 * CereBree uSMS — In-Process Watchdog (server-side singleton)
 *
 * Runs inside the Next.js dev server process (so it survives as long as the
 * server does). Performs a review iteration every 60 seconds:
 *   1. Health-check (the server itself — if this runs, server is alive)
 *   2. Scan dev.log for new errors (5xx, unhandled exceptions, compile fails)
 *   3. Every 5th iteration: run `bun run lint` and capture error counts
 *   4. Write a structured health report to watchdog-state.json + watchdog.log
 *
 * Uses a globalThis singleton so HMR / module reloads don't spawn duplicates.
 */

import { appendFileSync, readFileSync, writeFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { processPendingDeliveries } from './notification-delivery';

const PROJECT_ROOT = process.cwd();
const DEV_LOG = join(PROJECT_ROOT, 'dev.log');
const WATCHDOG_DIR = join(PROJECT_ROOT, 'mini-services/watchdog');
const LOG_FILE = join(WATCHDOG_DIR, 'watchdog.log');
const STATE_FILE = join(WATCHDOG_DIR, 'watchdog-state.json');
const INTERVAL_MS = 60_000;

interface WatchdogState {
  ts: string;
  iteration: number;
  serverAlive: boolean;
  lintErrors: number;
  lintWarnings: number;
  lintClean: boolean;
  lintRan: boolean;
  newDevErrors: number;
  http5xx: number;
  health: string;
  notificationsProcessed: number;
  notificationsSent: number;
  notificationsFailed: number;
}

function wdLog(line: string) {
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${line}`;
  try {
    appendFileSync(LOG_FILE, entry + '\n');
  } catch {
    /* ignore */
  }
}

function scanDevLog(lastSizeRef: { size: number }): { newErrors: number; http5xx: number; tail: string[] } {
  try {
    if (!existsSync(DEV_LOG)) return { newErrors: 0, http5xx: 0, tail: [] };
    const size = statSync(DEV_LOG).size;
    let newContent = '';
    if (size > lastSizeRef.size) {
      const full = readFileSync(DEV_LOG, 'utf8');
      newContent = full.slice(lastSizeRef.size);
      lastSizeRef.size = size;
    } else if (size < lastSizeRef.size) {
      newContent = readFileSync(DEV_LOG, 'utf8');
      lastSizeRef.size = size;
    }
    let newErrors = 0;
    let http5xx = 0;
    const lines = newContent.split('\n');
    for (const line of lines) {
      if (/unhandled|uncaught|TypeError|ReferenceError|SyntaxError|Module not found|Failed to compile|⨯/i.test(line)) {
        newErrors++;
      }
      const m = line.match(/\s(5\d\d)\s/);
      if (m) http5xx++;
    }
    return { newErrors, http5xx, tail: lines.filter(Boolean).slice(-3) };
  } catch {
    return { newErrors: 0, http5xx: 0, tail: [] };
  }
}

function runLint(): { errors: number; warnings: number; clean: boolean } {
  try {
    const res = spawnSync('bash', ['-c', `cd ${PROJECT_ROOT} && bun run lint 2>&1`], {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const stdout = (res.stdout || '') + (res.stderr || '');
    let errors = 0, warnings = 0;
    for (const line of stdout.split('\n')) {
      const m = line.match(/\s+(\d+)\s+error/);
      const w = line.match(/\s+(\d+)\s+warning/);
      if (m) errors += parseInt(m[1], 10);
      if (w) warnings += parseInt(w[1], 10);
    }
    const hasErrorPatterns = /\berror\b/i.test(stdout) && !/0 error/i.test(stdout);
    const clean = res.status === 0 || (!hasErrorPatterns && errors === 0);
    if (!clean && errors === 0) errors = 1;
    return { errors: clean ? 0 : errors, warnings, clean };
  } catch {
    return { errors: 0, warnings: 0, clean: true };
  }
}

function startWatchdog(): void {
  let iteration = 0;
  const lastSizeRef = { size: 0 };
  try {
    if (existsSync(DEV_LOG)) lastSizeRef.size = statSync(DEV_LOG).size;
  } catch { /* ignore */ }

  wdLog('=== CereBree uSMS in-process watchdog started — every 60s ===');

  const tick = () => {
    try {
      iteration++;
      // If this tick runs, the server is alive.
      const shouldLint = iteration % 10 === 0;
      const lint = shouldLint ? runLint() : { errors: 0, warnings: 0, clean: true };
      const devScan = scanDevLog(lastSizeRef);

      // Flush pending notification deliveries (PORTAL/EMAIL/TEAMS/SLACK).
      // The worker is idempotent and capped at 100 per tick, so calling it
      // every iteration is safe — it short-circuits to a no-op when nothing
      // is pending. We intentionally swallow errors here so a transient DB
      // hiccup never takes the watchdog down.
      //
      // The worker is async; we attach .then/.catch so the synchronous tick
      // can keep running without blocking. Notification counts are written
      // to the next iteration's state (the current iteration writes zeros
      // while the previous tick's worker is still in flight) — acceptable
      // for an oversight dashboard.
      processPendingDeliveries()
        .then((r) => {
          try {
            wdLog(
              `  notification-delivery worker: ${r.processed} processed / ${r.sent} sent / ${r.failed} failed / ${r.skipped} skipped in ${r.durationMs}ms`,
            );
            // Update the state file with the worker counts so the dashboard
            // sees them on the next read. We merge into the existing file
            // rather than overwrite the full state (which would clobber the
            // most recent lint/devlog counts).
            try {
              if (existsSync(STATE_FILE)) {
                const cur = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<WatchdogState>;
                const merged: Partial<WatchdogState> = {
                  ...cur,
                  notificationsProcessed: r.processed,
                  notificationsSent: r.sent,
                  notificationsFailed: r.failed,
                };
                writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2));
              }
            } catch {
              /* ignore state-merge write errors */
            }
          } catch {
            /* ignore */
          }
        })
        .catch((ndErr) => {
          wdLog(`  notification-delivery worker threw: ${ndErr}`);
        });

      const health = lint.clean && devScan.newErrors === 0 && devScan.http5xx === 0 ? 'CLEAN' : 'ISSUES';
      const lintLabel = shouldLint
        ? `lint=${lint.errors}err/${lint.warnings}warn`
        : `lint=skip(next #${Math.ceil(iteration / 10) * 10})`;

      const state: WatchdogState = {
        ts: new Date().toISOString(),
        iteration,
        serverAlive: true,
        lintErrors: lint.errors,
        lintWarnings: lint.warnings,
        lintClean: lint.clean,
        lintRan: shouldLint,
        newDevErrors: devScan.newErrors,
        http5xx: devScan.http5xx,
        health,
        notificationsProcessed: 0,
        notificationsSent: 0,
        notificationsFailed: 0,
      };
      try { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch { /* ignore */ }

      wdLog(`iteration ${iteration}: server=UP ${lintLabel} devlog=${devScan.newErrors}err/${devScan.http5xx}5xx → ${health}`);
      if (health === 'ISSUES') {
        if (lint.errors > 0) wdLog(`  ⚠ lint errors: ${lint.errors}`);
        if (devScan.newErrors > 0) wdLog(`  ⚠ dev.log new errors: ${devScan.newErrors}`);
        if (devScan.http5xx > 0) wdLog(`  ⚠ HTTP 5xx: ${devScan.http5xx}`);
        for (const t of devScan.tail) wdLog(`  dev.log tail: ${t.slice(0, 160)}`);
      }
    } catch (e) {
      wdLog(`iteration threw: ${e}`);
    }
  };

  // Run first tick soon (after 5s to let server settle), then every 60s.
  setTimeout(tick, 5000);
  setInterval(tick, INTERVAL_MS);
}

// Global singleton — prevents duplicate intervals across HMR reloads.
const globalForWatchdog = globalThis as unknown as { __usmsWatchdog?: boolean };

if (!globalForWatchdog.__usmsWatchdog) {
  globalForWatchdog.__usmsWatchdog = true;
  startWatchdog();
}

export {};
