import { describe, expect, it, vi } from 'vitest';
import {
  PROVISIONED_HOST_ENV,
  authorizeHost,
  provisionedHost,
  type HostFacts,
  type HostProbeBoundary,
} from '../host-acceptance/host-guard';

/**
 * The host-acceptance guard decides whether real pointer input may be driven
 * against a real desktop, so its refusal path is worth testing directly. The
 * native boundary is mocked here: nothing is compiled, no display is probed
 * and no window is opened. What is asserted is that a host which has not
 * declared itself never reaches that boundary at all.
 */
const declared: HostFacts = {
  env: { [PROVISIONED_HOST_ENV]: '1', DISPLAY: ':0' },
  platform: 'linux',
  xtestHeaders: true,
};

function boundary(overrides: Partial<HostProbeBoundary> = {}) {
  const compileHelper = vi.fn(() => '/tmp/fake-helper' as string | null);
  const injectionHonoured = vi.fn(() => ({ ok: true, reason: 'mocked display applies injected motion' }));
  return { compileHelper, injectionHonoured, ...overrides } as HostProbeBoundary & {
    compileHelper: ReturnType<typeof vi.fn>;
    injectionHonoured: ReturnType<typeof vi.fn>;
  };
}

describe('host-acceptance authorization guard', () => {
  it('refuses every undeclared or incapable host with the measured reason', () => {
    const cases: Array<[HostFacts, string]> = [
      [{ ...declared, env: { DISPLAY: ':0' } }, 'has not been declared an isolated acceptance host'],
      [{ ...declared, env: { [PROVISIONED_HOST_ENV]: 'yes', DISPLAY: ':0' } }, 'has not been declared'],
      [{ ...declared, env: { [PROVISIONED_HOST_ENV]: '1' } }, 'no Linux X11 DISPLAY'],
      [{ ...declared, platform: 'win32' }, 'no Linux X11 DISPLAY'],
      [{ ...declared, xtestHeaders: false }, 'libXtst development headers are missing'],
    ];
    for (const [facts, reason] of cases) {
      const result = provisionedHost(facts);
      expect(result.ok, JSON.stringify(facts)).toBe(false);
      expect(result.reason).toContain(reason);
    }
    expect(provisionedHost(declared)).toEqual({ ok: true, reason: 'declared isolated X11 acceptance host' });
  });

  it('short-circuits before touching the native boundary when the host is undeclared', () => {
    // Regression: the guard and the Electron launch used to be separate
    // beforeAll hooks, and Playwright runs the next hook after an ordinary
    // error — so a refused host still got a compile, a pointer probe and an
    // app window. Refusal must happen before any of that work is reachable.
    const native = boundary();
    expect(() => authorizeHost({ ...declared, env: {} }, native)).toThrow(/UNSUPPORTED ACCEPTANCE HOST/);
    expect(native.compileHelper).not.toHaveBeenCalled();
    expect(native.injectionHonoured).not.toHaveBeenCalled();
  });

  it('refuses a declared host whose display discards injected input', () => {
    const native = boundary({
      injectionHonoured: vi.fn(() => ({ ok: false, reason: 'the compositor discarded the warp' })),
    });
    expect(() => authorizeHost(declared, native)).toThrow(/the compositor discarded the warp/);
    expect(() => authorizeHost(declared, native)).toThrow(/never run against a live user desktop/);
  });

  it('refuses a declared host where the helper never compiled, even if the probe claims success', () => {
    const native = boundary({ compileHelper: vi.fn(() => null) });
    expect(() => authorizeHost(declared, native)).toThrow(/never compiled/);
  });

  it('returns the compiled helper only for a declared host that really applies pointer input', () => {
    const native = boundary();
    expect(authorizeHost(declared, native)).toEqual({
      helper: '/tmp/fake-helper',
      reason: 'mocked display applies injected motion',
    });
    expect(native.compileHelper).toHaveBeenCalledTimes(1);
    expect(native.injectionHonoured).toHaveBeenCalledWith('/tmp/fake-helper');
  });
});
