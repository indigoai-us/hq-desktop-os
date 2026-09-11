import type { Page } from '@playwright/test';

export interface CspViolation {
  readonly effectiveDirective: string;
  readonly blockedURI: string;
}

interface ViolationSink {
  __cspViolations: CspViolation[];
}

/**
 * Record real `securitypolicyviolation` events. Only the browser reports these,
 * so they prove the policy is enforced rather than merely declared.
 * Install before navigating: the listener is re-registered on every document.
 */
export async function installViolationRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sink = globalThis as unknown as ViolationSink;
    sink.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      sink.__cspViolations.push({
        effectiveDirective: event.effectiveDirective,
        blockedURI: event.blockedURI,
      });
    });
  });
}

/** Run an action and return the violations it produced. */
export async function collectViolations(
  page: Page,
  action: () => Promise<void>,
): Promise<CspViolation[]> {
  const before = await readViolations(page);
  await action();
  await page.waitForTimeout(300);
  return (await readViolations(page)).slice(before.length);
}

async function readViolations(page: Page): Promise<CspViolation[]> {
  return page.evaluate(
    () => (globalThis as unknown as Partial<ViolationSink>).__cspViolations ?? [],
  );
}
