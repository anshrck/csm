/**
 * CereBree uSMS — Watchdog & Auto-Review Service
 *
 * Runs every 60 seconds (cron-like) and performs a review iteration:
 *   1. Health-check the Next.js dev server (http://localhost:3000)
 *   2. Restart it if dead (with memory cap to avoid OOM)
 *   3. Run `bun run lint` and capture error/warning counts
 *   4. Scan dev.log for new errors (HTTP 5xx, unhandled exceptions, compile fails)
 *   5. Append a structured health report to watchdog.log + watchdog-state.json
 *
 * This simulates a cron job running every minute to keep the system accurate & live.
 */

import { existsSync, appendFileSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = '/home/z/my-project';
const DEV_LOG = join(PROJECT_ROOT, 'dev.log');
const HEALTH_URL = 'http://localhost:3000/api/auth/me';
const INTERVAL_MS = 60_000; // every minute
const NODE_OPTIONS = '--max-old-space-size=2048';

interface IterationResult {
  ts: string;
  iteration: number;
  serverAlive: boolean;
  restarted: boolean;
  restartOk: boolean;
  lintErrors: number;
  lintWarnings: number;
  lintClean: boolean;
  newDevErrors: number;
  http5xx: number;
  responseMs: number | null;
  actions: string[];
}

let iteration = 0;
let lastDevLogSize = 0;
const stateFile = join(PROJECT_ROOT, 'mini-services/watchdog/watchdog-state.json');
const logFile = join(PROJECT_ROOT, 'mini-services/watchdog/watchdog.log');

function log(line: string) {
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${line}`;
  console.log(entry);
  try { appendFileSync(logFile, entry + '\n'); } catch { /* ignore */ }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function httpGet(url: string, timeoutMs = 5000): Promise<{ ok: boolean; status: number; ms: number }> {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return { ok: res.ok, status: res.status, ms: Date.now() - start };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - start };
  }
}

function runShell(cmd: string, timeoutMs = 60000): { stdout: string; exitCode: number | null } {
  try {
    const proc = Bun.spawnSync(['bash', '-c', cmd], { stdout: 'string', stderr: 'string' });
    return {
      stdout: (proc.stdout?.toString() || '') + (proc.stderr?.toString() || ''),
      exitCode: proc.exitCode,
    };
  } catch (e) {
    return { stdout: String(e), exitCode: null };
  }
}

function isServerAlive(): Promise<{ ok: boolean; ms: number }> {
  return httpGet(HEALTH_URL).then((r) => ({ ok: r.ok, ms: r.ms }));
}

function startDevServer(): void {
  try {
    writeFileSync(DEV_LOG, '');
    // Use setsid to fully detach; output to dev.log
    Bun.spawn(['bash', '-c', `cd ${PROJECT_ROOT} && NODE_OPTIONS="${NODE_OPTIONS}" setsid bun run dev > dev.log 2>&1 < /dev/null &`], { stdout: 'ignore', stderr: 'ignore' });
    log('watchdog: issued dev server start command');
  } catch (e) {
    log(`watchdog: failed to start dev server: ${e}`);
  }
}

async function waitForServer(timeoutMs = 90000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { ok } = await isServerAlive();
    if (ok) return true;
    await sleep(3000);
  }
  return false;
}

function runLint(): { errors: number; warnings: number; clean: boolean; exitCode: number | null } {
  const { stdout, exitCode } = runShell(`cd ${PROJECT_ROOT} && bun run lint 2>&1`, 60000);
  // Parse explicit "N error" / "N warning" counts from eslint output
  let errors = 0, warnings = 0;
  for (const line of stdout.split('\n')) {
    const m = line.match(/\s+(\d+)\s+error/);
    const w = line.match(/\s+(\d+)\s+warning/);
    if (m) errors += parseInt(m[1], 10);
    if (w) warnings += parseInt(w[1], 10);
  }
  // Trust the exit code: 0 = clean. null/undefined with no error patterns = treat as clean.
  const hasErrorPatterns = /\berror\b/i.test(stdout) && !/0 error/i.test(stdout);
  const clean = exitCode === 0 || (!hasErrorPatterns && errors === 0);
  if (!clean && errors === 0) errors = 1; // non-zero exit, no explicit count
  return { errors: clean ? 0 : errors, warnings, clean, exitCode };
}

function scanDevLog(): { newErrors: number; http5xx: number; tail: string[] } {
  try {
    const size = statSync(DEV_LOG).size;
    let newContent = '';
    if (size > lastDevLogSize) {
      const full = readFileSync(DEV_LOG, 'utf8');
      newContent = full.slice(lastDevLogSize);
      lastDevLogSize = size;
    } else if (size < lastDevLogSize) {
      // log was truncated (restart) — scan whole thing
      newContent = readFileSync(DEV_LOG, 'utf8');
      lastDevLogSize = size;
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

async function runIteration(): Promise<void> {
  iteration++;
  const actions: string[] = [];
  const { ok: wasAlive, ms } = await isServerAlive();
  let restarted = false;
  let restartOk = false;
  let responseMs: number | null = ms;

  if (!wasAlive) {
    actions.push('server down — restarting');
    log(`iteration ${iteration}: server DOWN, restarting...`);
    startDevServer();
    restarted = true;
    const up = await waitForServer();
    restartOk = up;
    if (up) {
      actions.push('server restarted successfully');
      log(`iteration ${iteration}: server restarted OK`);
      // warm up compile so next health check is fast
      await httpGet('http://localhost:3000/', 40000);
      const recheck = await isServerAlive();
      responseMs = recheck.ms;
    } else {
      actions.push('server failed to restart within timeout');
      log(`iteration ${iteration}: restart FAILED`);
      responseMs = null;
    }
  }

  // Run lint only every 5 iterations (5 min) to avoid memory pressure from eslint.
  // Every minute: lightweight health-check + dev.log scan only.
  const shouldLint = iteration % 5 === 0 || !wasAlive;
  const lint = shouldLint ? runLint() : { errors: 0, warnings: 0, clean: true, exitCode: null };
  const devScan = scanDevLog();

  const result: IterationResult = {
    ts: new Date().toISOString(),
    iteration,
    serverAlive: wasAlive || restartOk,
    restarted,
    restartOk,
    lintErrors: lint.errors,
    lintWarnings: lint.warnings,
    lintClean: lint.clean,
    newDevErrors: devScan.newErrors,
    http5xx: devScan.http5xx,
    responseMs,
    actions,
  };

  try { writeFileSync(stateFile, JSON.stringify(result, null, 2)); } catch { /* ignore */ }

  const status = result.serverAlive ? 'UP' : 'DOWN';
  const health = lint.clean && devScan.newErrors === 0 && devScan.http5xx === 0 ? 'CLEAN' : 'ISSUES';
  const lintLabel = shouldLint ? `lint=${lint.errors}err/${lint.warnings}warn` : 'lint=skip(next at #'+(Math.ceil(iteration/5)*5)+')';
  log(`iteration ${iteration}: server=${status} (${responseMs ?? '—'}ms) ${lintLabel} devlog=${devScan.newErrors}err/${devScan.http5xx}5xx → ${health}`);

  if (health === 'ISSUES') {
    if (lint.errors > 0) log(`  ⚠ lint errors: ${lint.errors}`);
    if (devScan.newErrors > 0) log(`  ⚠ dev.log new errors: ${devScan.newErrors}`);
    if (devScan.http5xx > 0) log(`  ⚠ HTTP 5xx in dev.log: ${devScan.http5xx}`);
    for (const t of devScan.tail) log(`  dev.log tail: ${t.slice(0, 180)}`);
  }
}

// Bootstrap: initialize lastDevLogSize to current size so we only scan NEW errors
try {
  if (existsSync(DEV_LOG)) {
    lastDevLogSize = statSync(DEV_LOG).size;
  }
} catch { /* ignore */ }

log('=== CereBree uSMS Watchdog started — running every 60s ===');

// Main loop: run immediately, then every minute. All errors caught so the loop never dies.
async function main() {
  // Run immediately
  try { await runIteration(); } catch (e) { log(`iteration ${iteration} threw: ${e}`); }
  // Then every minute
  setInterval(async () => {
    try { await runIteration(); } catch (e) { log(`iteration ${iteration} threw: ${e}`); }
  }, INTERVAL_MS);
}

main();

process.on('SIGTERM', () => { log('watchdog: received SIGTERM, exiting'); process.exit(0); });
process.on('SIGINT', () => { log('watchdog: received SIGINT, exiting'); process.exit(0); });
