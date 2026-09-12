#!/usr/bin/env node
/**
 * US-008 runtime preflight.
 * Verifies pinned public packages, integrity metadata, and that the launch
 * path resolves Electron's embedded Node — never a floating npx or global Node.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'runtime/manifest.json');

function fail(message) {
  console.error(`prepare-runtime: ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(require('node:fs').readFileSync(path, 'utf8'));
}

const manifest = readJson(manifestPath);
const pkg = readJson(join(root, 'package.json'));

const pinnedCloud = pkg.dependencies?.['@indigoai-us/hq-cloud'];
if (pinnedCloud !== manifest.syncEngine.version) {
  fail(`package.json hq-cloud ${pinnedCloud} does not match manifest ${manifest.syncEngine.version}`);
}

if (pkg.dependencies?.['@indigoai-us/hq-cloud']?.includes('^') || pinnedCloud?.includes('~') || pinnedCloud?.includes('x')) {
  fail('hq-cloud must be an exact version pin (no floating range)');
}

let installed;
try {
  installed = readJson(require.resolve('@indigoai-us/hq-cloud/package.json'));
} catch {
  fail('Bundled @indigoai-us/hq-cloud is not installed. Run pnpm install --frozen-lockfile.');
}
if (installed.version !== manifest.syncEngine.version) {
  fail(`Installed hq-cloud ${installed.version} does not match manifest ${manifest.syncEngine.version}`);
}

const lock = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8');
if (!lock.includes(`'@indigoai-us/hq-cloud@${manifest.syncEngine.version}'`)) {
  fail('pnpm-lock.yaml is missing the pinned hq-cloud resolution');
}
if (!lock.includes(manifest.syncEngine.integrity)) {
  fail('pnpm-lock.yaml integrity does not match runtime/manifest.json for hq-cloud');
}

const setupSource = await readFile(join(root, 'src/main/setup.ts'), 'utf8');
const depsSource = await readFile(join(root, 'src/main/setup-dependencies.ts'), 'utf8');
if (!setupSource.includes(`version: '${manifest.hqCoreTemplate.version}'`)) {
  fail('src/main/setup.ts HQ_TEMPLATE.version drifted from manifest');
}
if (!setupSource.includes(manifest.hqCoreTemplate.sha256)) {
  fail('src/main/setup.ts HQ_TEMPLATE.sha256 drifted from manifest');
}
for (const [key, value] of Object.entries({
  node: manifest.setupToolchain.node.version,
  qmd: manifest.setupToolchain.qmd.version,
  hq: manifest.setupToolchain.hqCli.version,
  yq: manifest.setupToolchain.yq.version,
  jq: manifest.setupToolchain.jq.version,
})) {
  if (!depsSource.includes(`${key}: '${value}'`)) {
    fail(`src/main/setup-dependencies.ts TOOL_VERSIONS.${key} drifted from manifest (${value})`);
  }
}

if (/\bnpx\b/.test(setupSource) || /\bnpx\b/.test(depsSource)) {
  fail('Setup sources must not invoke npx');
}

let electronPath;
try {
  electronPath = require('electron');
} catch {
  fail('electron is not installed');
}
try {
  await access(electronPath, constants.X_OK);
} catch {
  fail(`Electron binary is not executable: ${electronPath}`);
}

const probe = spawnSync(
  electronPath,
  ['-e', 'process.stdout.write(JSON.stringify({ node: process.version, pid: process.pid, execPath: process.execPath }))'],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' },
    encoding: 'utf8',
    timeout: 15_000,
  },
);
if (probe.status !== 0) {
  fail(`Electron embedded Node probe failed: ${probe.stderr || probe.error?.message || 'unknown'}`);
}
let resolved;
try {
  resolved = JSON.parse(probe.stdout.trim());
} catch {
  fail(`Electron embedded Node returned non-JSON: ${probe.stdout}`);
}
if (typeof resolved.node !== 'string' || !resolved.node.startsWith('v')) {
  fail(`Unexpected embedded Node version: ${resolved.node}`);
}
if (resolved.execPath !== electronPath) {
  fail('Runtime probe did not execute through the Electron binary (global Node leak)');
}

const major = Number(resolved.node.slice(1).split('.')[0]);
if (!Number.isFinite(major) || major < 22 || major >= 25) {
  fail(`Embedded Node ${resolved.node} is outside the supported >=22 <25 window`);
}

const report = {
  preparedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  syncEngine: { package: manifest.syncEngine.package, version: installed.version },
  host: {
    electron: pkg.devDependencies.electron,
    electronPath,
    embeddedNode: resolved.node,
    probePid: resolved.pid,
  },
  setupToolchain: {
    node: manifest.setupToolchain.node.version,
    hqCli: manifest.setupToolchain.hqCli.version,
    qmd: manifest.setupToolchain.qmd.version,
    yq: manifest.setupToolchain.yq.version,
    jq: manifest.setupToolchain.jq.version,
  },
  rejectedAdapters: manifest.rejectedAdapters.map((item) => item.package),
  chosenAdapter: manifest.chosenAdapter.id,
  platformEvidence: manifest.platformEvidence,
  noGlobalNodeRequired: true,
  noFloatingNpx: true,
};

const outDir = join(root, '.scratch');
await mkdir(outDir, { recursive: true, mode: 0o700 });
const outFile = join(outDir, 'runtime-resolved.json');
await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

console.log(`prepare-runtime: OK — hq-cloud ${installed.version}, Electron Node ${resolved.node}`);
console.log(`prepare-runtime: wrote ${outFile}`);
if (process.platform !== 'linux') {
  console.log(`prepare-runtime: note — child IPC/shutdown evidence on ${process.platform} remains deferred per manifest.platformEvidence`);
}
