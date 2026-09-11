import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

describe('US-011 resumable native workspace setup and company selection', () => {
  it('ships the PRD setup-state, setup screen, and company picker modules', () => {
    for (const rel of [
      'src/main/setup.ts',
      'src/main/setup-state.ts',
      'src/renderer/screens/setup.tsx',
      'src/renderer/components/company-picker.tsx',
      'tests/native/setup.test.ts',
      'src/shared/hq-web.ts',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }

    const setupState = read('src/main/setup-state.ts');
    expect(setupState).toContain('class SetupJournal');
    expect(setupState).toContain('recoverInterruptedSetup');
    expect(setupState).toContain("step.status === 'working'");

    const setupScreen = read('src/renderer/screens/setup.tsx');
    expect(setupScreen).toContain('SetupScreen');
    expect(setupScreen).toContain('resume-setup');
    expect(setupScreen).toContain('cancel-setup');

    const picker = read('src/renderer/components/company-picker.tsx');
    expect(picker).toContain('CompanyPicker');
    expect(picker).toContain('memberships-error');
    expect(picker).toContain('create-company');
    expect(picker).toContain('accept-invite');
    expect(picker).toContain('Try again');
  });

  it('keeps membership discovery failures distinct from an empty company list', () => {
    const companion = read('src/main/companion.ts');
    expect(companion).toContain('memberships');
    expect(companion).toContain("status: 'error'");
    expect(companion).toContain('recoverInterruptedSetup');
    expect(companion).toContain('onWindowFocus');
    expect(companion).toContain('openHqWeb');
    expect(companion).toContain('awaitingMembershipRefresh');

    const shared = read('src/shared/companion.ts');
    expect(shared).toContain('MembershipsState');
    expect(shared).toContain("'open-hq-web'");
    expect(shared).toContain('destination');

    const web = read('src/shared/hq-web.ts');
    expect(web).toContain("HQ_CONSOLE_BASE = 'https://hq.computer'");
    expect(web).toContain('/signup/team');
    expect(web).toContain('/onboarding');
  });

  it('records Linux setup/company selection coverage and deferred Windows evidence', () => {
    const manifest = readJson<{
      platformEvidence: {
        linux: { guidedSetup?: string; companySelection?: string };
        windows: { guidedSetup?: string; companySelection?: string };
      };
    }>('runtime/manifest.json');
    expect(manifest.platformEvidence.linux.guidedSetup).toBe('covered');
    expect(manifest.platformEvidence.linux.companySelection).toBe('covered');
    expect(manifest.platformEvidence.windows.guidedSetup).toBe('deferred');
    expect(manifest.platformEvidence.windows.companySelection).toBe('deferred');

    const docs = read('docs/platform-boundary.md');
    expect(docs).toContain('Guided setup and company selection (US-011 Linux slice)');
    expect(docs).toContain('failed discovery');
    expect(docs).toContain('hq.computer/signup/team');
  });
});
