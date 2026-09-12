/** Renderer-safe account surface — tokens never cross IPC. */
export const ACCOUNT_STATUSES = ['signed-out', 'connected', 'signing-in'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface PublicAccount {
  status: AccountStatus;
  label: string | null;
  error?: string;
}

export interface CredentialStorageStatus {
  available: boolean;
  /** Electron safeStorage backend id, or the host platform name on non-Linux. */
  backend: string;
}

/**
 * Public Cognito/OAuth configuration (issuer, client, hosted UI).
 * Not secrets — mirrored from main for typed UI/docs without importing main.
 */
export const HQ_AUTH_PUBLIC = {
  issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AXf6Kb5nE',
  clientId: '7acei2c8v870enheptb1j5foln',
  domain: 'https://vault-indigo-hq-prod.auth.us-east-1.amazoncognito.com',
  redirectUri: 'http://localhost:53682/callback',
  port: 53682,
} as const;
