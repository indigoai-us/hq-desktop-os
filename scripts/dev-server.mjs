/**
 * Persistent browser preview for HQ Desktop OS.
 * Owns 127.0.0.1:4173 with strictPort, records URL / PID / log for the session.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratchDir = join(root, '.scratch');
const ownershipPath = join(scratchDir, 'dev-preview.json');
const logPath = join(scratchDir, 'dev-preview.log');
const host = '127.0.0.1';
const port = 4173;
const url = `http://${host}:${port}`;

mkdirSync(scratchDir, { recursive: true });

const startedAt = new Date().toISOString();
const ownership = {
  url,
  host,
  port,
  strictPort: true,
  pid: process.pid,
  startedAt,
  ownershipPath,
  logPath,
  command: 'pnpm dev',
  note: 'This process owns the shared renderer preview. Stop it before another session reuses 4173.',
};

writeFileSync(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`);
appendFileSync(
  logPath,
  `[${startedAt}] start pid=${process.pid} url=${url} ownership=${ownershipPath}\n`,
);

function logLine(stream, chunk) {
  const text = chunk.toString();
  process[stream].write(text);
  appendFileSync(logPath, text);
}

const child = spawn(
  process.execPath,
  [
    join(root, 'node_modules/vite/bin/vite.js'),
    '--host',
    host,
    '--port',
    String(port),
    '--strictPort',
  ],
  {
    cwd: root,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  },
);

ownership.vitePid = child.pid;
writeFileSync(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`);
appendFileSync(logPath, `[${new Date().toISOString()}] vite pid=${child.pid}\n`);

child.stdout.on('data', (chunk) => logLine('stdout', chunk));
child.stderr.on('data', (chunk) => logLine('stderr', chunk));

const shutdown = (signal) => {
  appendFileSync(
    logPath,
    `[${new Date().toISOString()}] shutdown signal=${signal} pid=${process.pid}\n`,
  );
  if (!child.killed) child.kill(signal);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
  appendFileSync(
    logPath,
    `[${new Date().toISOString()}] vite exit code=${code} signal=${signal ?? ''}\n`,
  );
  process.exit(code ?? (signal ? 1 : 0));
});
