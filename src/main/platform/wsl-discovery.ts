import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WSL_DISTRO_NAME } from '../../shared/workspace.js';

const execFileAsync = promisify(execFile);

export type WslDiscoveryStatus = 'ready' | 'missing' | 'stopped' | 'unavailable' | 'error';

export interface WslDistribution {
  name: string;
  version: 1 | 2;
  state: string;
  usable: boolean;
  detail: string;
}

export interface WslDiscoverySnapshot {
  status: WslDiscoveryStatus;
  message: string;
  distributions: WslDistribution[];
  selected: string | null;
}

export type WslCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<{ stdout: Buffer | string; stderr: Buffer | string; code?: number | null }>;

/** Default runner: argument array only, no shell, bounded output. */
export async function defaultWslRunner(
  command: string,
  args: readonly string[],
): Promise<{ stdout: Buffer | string; stderr: Buffer | string; code?: number | null }> {
  try {
    const result = await execFileAsync(command, [...args], {
      encoding: 'buffer',
      timeout: 8_000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
      shell: false,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: Buffer;
      stderr?: Buffer;
      status?: number | null;
      code?: string | number | null;
    };
    if (failure.code === 'ENOENT') throw failure;
    return {
      stdout: failure.stdout ?? Buffer.alloc(0),
      stderr: failure.stderr ?? Buffer.alloc(0),
      code: typeof failure.status === 'number' ? failure.status : 1,
    };
  }
}

function decodeWslListOutput(raw: Buffer | string): string {
  if (typeof raw === 'string') return raw;
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return raw.subarray(2).toString('utf16le');
  }
  // wsl.exe --list --verbose commonly emits UTF-16LE without a BOM.
  if (raw.length >= 4 && raw[1] === 0x00 && raw[3] === 0x00) {
    return raw.toString('utf16le');
  }
  return raw.toString('utf8');
}

/** Parse `wsl.exe --list --verbose` rows. Rejects WSL1 as unsupported targets. */
export function parseWslListVerbose(output: Buffer | string): WslDistribution[] {
  const text = decodeWslListOutput(output).replace(/\r/g, '\n');
  const distributions: WslDistribution[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || /^NAME\s+STATE\s+VERSION/i.test(trimmed)) continue;
    const match = trimmed.match(/^\*?\s*(\S+)\s+(\S+)\s+(\d+)\s*$/);
    if (!match) continue;
    const name = match[1]!;
    if (!WSL_DISTRO_NAME.test(name)) continue;
    const state = match[2]!;
    const version = Number(match[3]) === 1 ? 1 : Number(match[3]) === 2 ? 2 : null;
    if (version === null) continue;
    if (version === 1) {
      distributions.push({
        name,
        version: 1,
        state,
        usable: false,
        detail: 'WSL1 is not supported. Convert this distribution to WSL2, then try again.',
      });
      continue;
    }
    const running = /^running$/i.test(state);
    distributions.push({
      name,
      version: 2,
      state,
      usable: true,
      detail: running
        ? 'WSL2 distribution is available.'
        : 'Distribution is stopped. Start it from Windows, then refresh.',
    });
  }
  return distributions;
}

function unavailableSnapshot(message: string, selected: string | null = null): WslDiscoverySnapshot {
  return { status: 'unavailable', message, distributions: [], selected };
}

/**
 * List WSL2 distributions through bounded argument-array commands.
 * On non-Windows hosts this returns an actionable unavailable state — it does
 * not invent a Linux-side WSL runtime.
 */
export async function discoverWslDistributions(options: {
  platform?: NodeJS.Platform;
  runner?: WslCommandRunner;
  selected?: string | null;
} = {}): Promise<WslDiscoverySnapshot> {
  const platform = options.platform ?? process.platform;
  const selected = options.selected ?? null;
  if (platform !== 'win32') {
    return unavailableSnapshot(
      'WSL environment selection is available on Windows hosts. This Linux install uses native folders only.',
      selected,
    );
  }

  const runner = options.runner ?? defaultWslRunner;
  let listed: { stdout: Buffer | string; stderr: Buffer | string; code?: number | null };
  try {
    listed = await runner('wsl.exe', ['--list', '--verbose']);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        status: 'missing',
        message: 'WSL was not found. Install WSL2 from Microsoft, then reopen HQ to choose a distribution.',
        distributions: [],
        selected,
      };
    }
    return {
      status: 'error',
      message: 'WSL could not be queried. Check that WSL2 is installed, then try again.',
      distributions: [],
      selected,
    };
  }

  if ((listed.code ?? 0) !== 0) {
    const stderr = decodeWslListOutput(listed.stderr).trim();
    if (/not (installed|enabled)|no installed distributions/i.test(stderr) || /0x80070002/i.test(stderr)) {
      return {
        status: 'missing',
        message: 'No WSL distributions are installed. Install a supported Ubuntu WSL2 distro, then refresh.',
        distributions: [],
        selected,
      };
    }
    return {
      status: 'error',
      message: 'WSL did not respond. Start WSL from Windows, then try again.',
      distributions: [],
      selected,
    };
  }

  const distributions = parseWslListVerbose(listed.stdout);
  const usable = distributions.filter((item) => item.usable && item.version === 2);
  if (distributions.length === 0) {
    return {
      status: 'missing',
      message: 'No WSL distributions were reported. Install a supported Ubuntu WSL2 distro, then refresh.',
      distributions,
      selected,
    };
  }
  if (usable.length === 0) {
    return {
      status: 'stopped',
      message: 'WSL is present but no supported WSL2 distribution is usable yet. Convert WSL1 distros or start a stopped WSL2 distro, then refresh.',
      distributions,
      selected,
    };
  }
  const selectedValid = selected && usable.some((item) => item.name === selected) ? selected : null;
  return {
    status: 'ready',
    message: selectedValid
      ? `Using WSL2 distribution ${selectedValid}.`
      : 'Choose a WSL2 distribution for this workspace.',
    distributions,
    selected: selectedValid,
  };
}
