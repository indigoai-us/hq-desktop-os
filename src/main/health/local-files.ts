import { openSync, readSync, fstatSync, closeSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLIENT_HEALTH_MAX_ERROR_LINE_COUNT,
  CLIENT_HEALTH_MAX_FILE_AGE_SECONDS,
  CLIENT_HEALTH_MAX_FILE_SIZE_BYTES,
  type ClientHealthLocalFilesOverview,
} from './contract.js';

/** Cap tail reads so large journals never hit the UI / heartbeat path. */
export const LOCAL_FILES_OVERVIEW_TAIL_READ_BYTES = 2 * 1024 * 1024;
/** Reuse observations on ordinary heartbeats; sync outcomes may refresh. */
export const LOCAL_FILES_OVERVIEW_TTL_MS = 15 * 60_000;

const ERROR_MARKER = /error/i;
const JSON_LEVEL_ERROR = /"level"\s*:\s*"error"/i;

interface StatFacts {
  exists: boolean;
  sizeBytes: number;
  ageSeconds: number;
}

const ABSENT: StatFacts = { exists: false, sizeBytes: 0, ageSeconds: 0 };

function clampInt(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), max);
}

/** Best-effort lstat; missing/denied/symlink → absent. Never throws. */
function statFacts(filePath: string, nowMs: number): StatFacts {
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile()) return ABSENT;
    return {
      exists: true,
      sizeBytes: clampInt(stat.size, CLIENT_HEALTH_MAX_FILE_SIZE_BYTES),
      ageSeconds: clampInt((nowMs - stat.mtimeMs) / 1000, CLIENT_HEALTH_MAX_FILE_AGE_SECONDS),
    };
  } catch {
    return ABSENT;
  }
}

function isSafeRegularFile(filePath: string): boolean {
  try {
    return lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Count error-looking lines in a capped tail. Returns only the integer —
 * buffer contents never leave this function.
 */
export function countRecentErrorLines(
  filePath: string,
  maxBytes = LOCAL_FILES_OVERVIEW_TAIL_READ_BYTES,
  cap = CLIENT_HEALTH_MAX_ERROR_LINE_COUNT,
): number {
  if (!isSafeRegularFile(filePath)) return 0;
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const size = fstatSync(fd).size;
    const readSize = Math.min(size, maxBytes);
    if (readSize <= 0) return 0;
    const buffer = Buffer.alloc(readSize);
    readSync(fd, buffer, 0, readSize, size - readSize);
    let count = 0;
    for (const line of buffer.toString('utf8').split('\n')) {
      if (count >= cap) break;
      if (ERROR_MARKER.test(line) || JSON_LEVEL_ERROR.test(line)) count += 1;
    }
    return count;
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

export interface LocalFilesOverviewInput {
  /** Optional hq-sync log path (metadata only). */
  syncLogPath?: string | null;
  /** Owned engine journal file paths (metadata only). */
  journalPaths?: readonly string[];
  nowMs?: number;
}

/** Collect bounded local-file facts. Never returns paths, content, or tokens. */
export function collectLocalFilesOverview(input: LocalFilesOverviewInput = {}): ClientHealthLocalFilesOverview {
  const nowMs = input.nowMs ?? Date.now();
  const syncLog = input.syncLogPath ? statFacts(input.syncLogPath, nowMs) : ABSENT;
  const journals = (input.journalPaths ?? []).map((path) => statFacts(path, nowMs));
  const journal = journals.reduce<StatFacts>((best, next) => {
    if (!next.exists) return best;
    if (!best.exists) return next;
    return next.ageSeconds <= best.ageSeconds ? next : best;
  }, ABSENT);

  let recentErrorLineCount = 0;
  if (input.syncLogPath) {
    recentErrorLineCount = countRecentErrorLines(input.syncLogPath);
  }
  for (const path of input.journalPaths ?? []) {
    if (recentErrorLineCount >= CLIENT_HEALTH_MAX_ERROR_LINE_COUNT) break;
    recentErrorLineCount = Math.min(
      CLIENT_HEALTH_MAX_ERROR_LINE_COUNT,
      recentErrorLineCount + countRecentErrorLines(path),
    );
  }

  return {
    syncLogExists: syncLog.exists,
    syncLogSizeBytes: syncLog.sizeBytes,
    syncLogAgeSeconds: syncLog.ageSeconds,
    journalExists: journal.exists,
    journalSizeBytes: journal.sizeBytes,
    journalAgeSeconds: journal.ageSeconds,
    recentErrorLineCount,
  };
}

/** Default shared hq-sync log location — observed only; never written by this app. */
export function defaultSharedSyncLogPath(homeDirectory: string): string {
  return join(homeDirectory, '.hq', 'logs', 'hq-sync.log');
}

export interface LocalFilesOverviewCache {
  observedAtMs: number;
  overview: ClientHealthLocalFilesOverview;
}

/**
 * Return a cached overview when fresh; otherwise collect. Heartbeat paths must
 * not scan full journals on the UI thread — callers pass narrow path lists.
 */
export function cachedLocalFilesOverview(
  cache: LocalFilesOverviewCache | null,
  input: LocalFilesOverviewInput,
  ttlMs = LOCAL_FILES_OVERVIEW_TTL_MS,
): { overview: ClientHealthLocalFilesOverview; cache: LocalFilesOverviewCache } {
  const nowMs = input.nowMs ?? Date.now();
  if (cache && nowMs - cache.observedAtMs >= 0 && nowMs - cache.observedAtMs < ttlMs) {
    return { overview: cache.overview, cache };
  }
  const overview = collectLocalFilesOverview({ ...input, nowMs });
  return { overview, cache: { observedAtMs: nowMs, overview } };
}
