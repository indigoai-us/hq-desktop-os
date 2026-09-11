import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_COMPONENT_GALLERY_PATH, isDevGalleryPath } from '../../src/renderer/dev/gallery-path';
import { snapshotForScenario } from '../../src/renderer/dev/scenarios';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('US-006 companion navigation and complete preview screens', () => {
  it('keeps Setup/Sync/Tools/Settings in one shell with active workspace and no AI/chat surface', () => {
    const app = read('src/renderer/companion-app.tsx');
    expect(app).toContain("name: 'Workspace'");
    expect(app).toContain("name: 'Sync'");
    expect(app).toContain("name: 'Tools'");
    expect(app).toContain("name: 'Settings'");
    expect(app).toContain('companion-shell');
    expect(app).toContain('data-testid="active-workspace"');
    expect(app).toContain('data-testid="companion-shell"');

    // No embedded assistant / task / chat product surface in the companion shell.
    expect(app).not.toMatch(/\bCopilot\b|\bChatGPT\b|task board|chat panel|AI assistant/i);
    expect(app).not.toMatch(/vscode|Visual Studio Code|documentation link/i);

    const settings = read('src/renderer/screens/settings.tsx');
    expect(settings).toContain('Settings');
    expect(settings).not.toMatch(/\bCopilot\b|chat panel|task board/i);

    // Gallery remains a separate development route, not part of the shell.
    expect(isDevGalleryPath(DEV_COMPONENT_GALLERY_PATH)).toBe(true);
    expect(read('src/renderer/main.tsx')).toContain('import.meta.env.DEV');
    expect(read('src/renderer/main.tsx')).toContain('isDevGalleryPath');
  });

  it('models empty, loading, error and populated states for every screen', () => {
    const app = read('src/renderer/companion-app.tsx');
    for (const name of ['Workspace', 'Sync', 'Tools', 'Settings'] as const) {
      expect(app).toContain(`data-screen="${name}"`);
    }
    expect(app).toContain("type ScreenState = 'empty' | 'loading' | 'error' | 'populated'");
    expect(app).toContain('data-screen-state');
    expect(app).toContain('data-testid="screen-workspace"');
    expect(app).toContain('data-testid="screen-sync"');
    expect(app).toContain('data-testid="screen-tools"');
    expect(app).toContain('data-testid="screen-settings"');
    expect(app).toContain('data-testid="companion-pending"');
    expect(app).toContain('data-testid="companion-loading"');
    expect(app).toContain('data-testid="companion-error"');
    expect(app).toContain('data-testid="tools-empty"');

    // Immediate acknowledgement + single-flight guard.
    expect(app).toContain('busy.current');
    expect(app).toContain('setPending(label)');
    expect(app).toMatch(/if \(!client \|\| busy\.current\) return/);

    const preview = read('src/renderer/dev/companion-preview.ts');
    expect(preview).toContain("params.get('delay')");
    expect(preview).toContain("params.get('fail')");

    // Fixture coverage for the four state families across screens.
    expect(snapshotForScenario('signed-out').workspaces).toEqual([]);
    expect(snapshotForScenario('setup').setup?.steps.some((s) => s.status === 'working')).toBe(true);
    expect(snapshotForScenario('setup-error').setup?.error).toMatch(/already an HQ folder/);
    expect(snapshotForScenario('connected').workspaces.length).toBeGreaterThan(0);
    expect(snapshotForScenario('failure').sync.phase).toBe('error');
    expect(snapshotForScenario('syncing').sync.phase).toBe('syncing');
  });

  it('pins responsive shell CSS for supported sizes and keeps workspace visible when narrow', () => {
    const css = read('src/renderer/styles.css');
    expect(css).toContain('.companion-shell');
    expect(css).toContain('@media (max-width: 800px)');
    expect(css).toContain('@media (max-width: 560px)');
    // 200% of 1024×700 collapses to ~512 CSS px — footer must stay visible.
    const narrow = css.slice(css.indexOf('@media (max-width: 560px)'));
    expect(narrow).not.toMatch(/\.sidebar-footer\s*\{\s*display:\s*none/);
    expect(narrow).toContain('Keep active workspace visible');

    const e2e = read('tests/e2e/us-006-navigation-screens.spec.ts');
    expect(e2e).toContain('1024');
    expect(e2e).toContain('700');
    expect(e2e).toContain('1440');
    expect(e2e).toContain('900');
    expect(e2e).toContain('200%');
  });

  it('does not ship gallery tooling in production renderer assets when built', () => {
    const rendererDir = join(root, 'dist/renderer/assets');
    if (!existsSync(rendererDir)) {
      expect(read('src/renderer/main.tsx')).toContain('import.meta.env.DEV');
      return;
    }
    const js = readdirSync(rendererDir).filter((name) => name.endsWith('.js'));
    expect(js.length).toBeGreaterThan(0);
    for (const name of js) {
      const body = readFileSync(join(rendererDir, name), 'utf8');
      expect(body, name).not.toContain('dev-component-gallery');
      expect(body, name).not.toContain('Component gallery');
    }
  });
});
