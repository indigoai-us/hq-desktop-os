/**
 * Canonical HQ console URLs opened from the companion for company create / invite.
 * Main process opens these with shell.openExternal after destination validation.
 */

export const HQ_CONSOLE_BASE = 'https://hq.computer';

export const HQ_WEB_DESTINATIONS = ['create-company', 'accept-invite'] as const;
export type HqWebDestination = (typeof HQ_WEB_DESTINATIONS)[number];

export const HQ_WEB_FLOW_URLS = Object.freeze({
  'create-company': `${HQ_CONSOLE_BASE}/signup/team`,
  'accept-invite': `${HQ_CONSOLE_BASE}/onboarding`,
} as const satisfies Record<HqWebDestination, string>);

export function hqWebFlowUrl(destination: HqWebDestination): string {
  return HQ_WEB_FLOW_URLS[destination];
}

export function isHqWebDestination(value: unknown): value is HqWebDestination {
  return typeof value === 'string' && (HQ_WEB_DESTINATIONS as readonly string[]).includes(value);
}
