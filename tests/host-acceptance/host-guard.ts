/**
 * Authorization for the physical-host acceptance suite.
 *
 * This lives apart from the spec for two reasons. It must be importable
 * without pulling in Playwright or touching the display, so the rule that
 * protects a user's desktop can be unit-tested against a mocked native
 * boundary. And keeping it in one function makes the ordering explicit:
 * nothing native — no compilation, no pointer probe, no Electron launch —
 * may happen until the host has declared itself.
 */

/** An isolated host provisioned for acceptance must announce itself. */
export const PROVISIONED_HOST_ENV = 'HQ_HOST_ACCEPTANCE';

export interface HostFacts {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** Are the libXtst development headers the pointer helper needs present? */
  xtestHeaders: boolean;
}

/** The native operations the guard is allowed to reach, once it has authorized. */
export interface HostProbeBoundary {
  compileHelper(): string | null;
  injectionHonoured(binary: string | null): { ok: boolean; reason: string };
}

export function unsupportedHost(reason: string): Error {
  return new Error(
    `UNSUPPORTED ACCEPTANCE HOST: ${reason}. Titlebar drag and edge resize are unproven on this host. ` +
      'Run this suite only on a provisioned isolated X11 acceptance host (or under Xvfb) with ' +
      `${PROVISIONED_HOST_ENV}=1; it must never run against a live user desktop.`,
  );
}

export function provisionedHost(facts: HostFacts): { ok: boolean; reason: string } {
  if (facts.env[PROVISIONED_HOST_ENV] !== '1') {
    return {
      ok: false,
      reason: `${PROVISIONED_HOST_ENV}=1 is not set, so this host has not been declared an isolated acceptance host`,
    };
  }
  if (facts.platform !== 'linux' || !facts.env.DISPLAY) {
    return { ok: false, reason: 'no Linux X11 DISPLAY to drive' };
  }
  if (!facts.xtestHeaders) {
    return { ok: false, reason: 'libXtst development headers are missing, so the pointer helper cannot be built' };
  }
  return { ok: true, reason: 'declared isolated X11 acceptance host' };
}

/**
 * Authorize this host and prove it really applies injected pointer input.
 * Throws before touching the boundary when the host is not declared, so an
 * undeclared desktop never gets a compile, a probe or an app window.
 */
export function authorizeHost(facts: HostFacts, boundary: HostProbeBoundary): { helper: string; reason: string } {
  const provisioned = provisionedHost(facts);
  if (!provisioned.ok) throw unsupportedHost(provisioned.reason);

  const helper = boundary.compileHelper();
  const injection = boundary.injectionHonoured(helper);
  if (!injection.ok) {
    throw unsupportedHost(`real pointer input cannot be driven here — ${injection.reason}`);
  }
  if (!helper) throw unsupportedHost('the pointer helper was reported usable but never compiled');
  return { helper, reason: injection.reason };
}
