import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_SCENARIOS,
  REQUIRED_PREVIEW_SCENARIOS,
  isPreviewScenarioId,
  parsePreviewScenario,
  snapshotForScenario,
} from '../../src/renderer/dev/scenarios';
import { DEV_COMPANION_PATH, isDevCompanionPath } from '../../src/renderer/dev/preview-path';
import { HEALTH_PREVIEW_FIXTURES } from '../../src/shared/health-fixtures';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('US-005 persistent browser preview and simulated platform adapter', () => {
  it('pins the shared renderer to 127.0.0.1:4173 with strictPort via the ownership wrapper', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toBe('node scripts/dev-server.mjs');

    const launcher = read('scripts/dev-server.mjs');
    expect(launcher).toContain("host = '127.0.0.1'");
    expect(launcher).toContain('port = 4173');
    expect(launcher).toContain('--strictPort');
    expect(launcher).toContain('dev-preview.json');
    expect(launcher).toContain('dev-preview.log');
    expect(launcher).toContain('ownershipPath');
    expect(launcher).toContain('logPath');

    const docs = read('docs/development.md');
    expect(docs).toContain('http://127.0.0.1:4173');
    expect(docs).toContain('.scratch/dev-preview.json');
    expect(docs).toContain('.scratch/dev-preview.log');
    expect(docs).toContain('scripts/dev-server.mjs');
  });

  it('offers the required deterministic scenarios, visibly simulated and resettable', () => {
    for (const id of REQUIRED_PREVIEW_SCENARIOS) {
      expect(isPreviewScenarioId(id)).toBe(true);
      expect(PREVIEW_SCENARIOS).toContain(id);
    }

    expect(snapshotForScenario('signed-out').account.status).toBe('signed-out');
    expect(snapshotForScenario(undefined).account.status).toBe('signed-out');
    expect(snapshotForScenario('setup').setup?.steps.some((step) => step.status === 'working')).toBe(
      true,
    );
    expect(snapshotForScenario('syncing').sync.phase).toBe('syncing');
    expect(snapshotForScenario('offline').sync.phase).toBe('offline');
    expect(snapshotForScenario('conflict').sync).toMatchObject({
      phase: 'conflict',
      conflicts: 1,
      conflictPaths: ['notes/shared-draft.md'],
    });
    expect(snapshotForScenario('failure').sync.phase).toBe('error');

    // Health fixtures for Settings preview (including unknown → unavailable).
    for (const key of ['healthy', 'degraded', 'stale', 'checking', 'unavailable'] as const) {
      expect(HEALTH_PREVIEW_FIXTURES[key].overall).toBe(key);
    }
    expect(snapshotForScenario('health-unknown').health.overall).toBe('unavailable');
    expect(snapshotForScenario('health-stale').health.overall).toBe('stale');
    expect(parsePreviewScenario('not-a-real-scenario')).toBe('signed-out');

    const app = read('src/renderer/companion-app.tsx');
    expect(app).toContain('import.meta.env.DEV');
    expect(app).toContain('Preview · Changes here are not saved.');
    expect(app).toContain('preview-simulated-banner');
    expect(app).toContain('preview-reset');
    expect(app).toContain("window.location.assign('/dev/companion')");

    const preview = read('src/renderer/dev/companion-preview.ts');
    expect(preview).toContain('simulated: true');
    expect(preview).toContain('snapshotForScenario');
  });

  it('keeps the simulated adapter development-only with no production escape', () => {
    expect(isDevCompanionPath(DEV_COMPANION_PATH)).toBe(true);
    expect(isDevCompanionPath(`${DEV_COMPANION_PATH}/`)).toBe(true);
    expect(isDevCompanionPath('/')).toBe(false);
    expect(isDevCompanionPath('/companion')).toBe(false);

    const client = read('src/renderer/companion-client.ts');
    expect(client).toContain('import.meta.env.DEV');
    expect(client).toContain('isDevCompanionPath');
    expect(client).toContain("import('./dev/companion-preview')");
    expect(client).not.toMatch(/localStorage/);
    expect(client).not.toMatch(/sessionStorage/);
    expect(client).not.toMatch(/\?scenario/);

    const platform = read('src/renderer/platform.ts');
    expect(platform).toContain('resolvePlatformClient');
    expect(platform).toContain('Missing preload');

    // Source graph must not offer a PROD unlock for fixtures.
    const scenarios = read('src/renderer/dev/scenarios.ts');
    expect(scenarios).not.toMatch(/import\.meta\.env\.PROD/);
    expect(scenarios).toContain('REQUIRED_PREVIEW_SCENARIOS');
  });

  it('does not ship the simulated adapter in production renderer assets when built', () => {
    const rendererDir = join(root, 'dist/renderer/assets');
    if (!existsSync(rendererDir)) {
      // Build may not have run yet; the DEV gate above is the source contract.
      expect(read('src/renderer/companion-client.ts')).toContain('import.meta.env.DEV');
      return;
    }
    const js = readdirSync(rendererDir).filter((name) => name.endsWith('.js'));
    expect(js.length).toBeGreaterThan(0);
    for (const name of js) {
      const body = readFileSync(join(rendererDir, name), 'utf8');
      expect(body, name).not.toContain('createPreviewClient');
      expect(body, name).not.toContain('preview-simulated-banner');
      expect(body, name).not.toContain('REQUIRED_PREVIEW_SCENARIOS');
      expect(body, name).not.toContain('Preview · Changes here are not saved.');
    }
  });
});
