import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccountSession } from './auth.js';
export const VAULT_URL = 'https://hqapi.hq.computer';
export interface SyncScope { id: string; label: string }
/** Fan-out id for hq-cloud `--companies` (personal + every active membership). */
export const ALL_SYNC_SCOPE = 'all';
export function isSyncScopeId(scopeId: string): boolean {
  return scopeId === ALL_SYNC_SCOPE || scopeId === 'personal' || /^cmp_[a-zA-Z0-9]+$/.test(scopeId);
}
function membershipLabel(member: Record<string, unknown>, index: number): string {
  // GET /membership/me enriches with companyName / companySlug (hq-desktop-app).
  for (const key of ['companyName', 'name', 'companySlug', 'slug'] as const) {
    const value = member[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
  }
  return `Shared workspace ${index}`;
}
export function membershipScopes(raw: unknown): SyncScope[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { memberships?: unknown }).memberships)) throw new Error('Your shared workspaces could not be loaded. Please try again.');
  const companies: SyncScope[] = [];
  for (const row of (raw as { memberships: unknown[] }).memberships) {
    if (!row || typeof row !== 'object') throw new Error('Your shared workspaces could not be loaded.');
    const member = row as Record<string, unknown>;
    if (member.status !== 'active') continue;
    if (typeof member.companyUid !== 'string' || !/^cmp_[a-zA-Z0-9]+$/.test(member.companyUid)) throw new Error('Your shared workspaces could not be loaded.');
    if (companies.some(scope => scope.id === member.companyUid)) continue;
    companies.push({ id: member.companyUid, label: membershipLabel(member, companies.length + 1) });
  }
  // Match hq-desktop-app Sync Now: personal + all active companies in one pass.
  return [
    { id: ALL_SYNC_SCOPE, label: companies.length ? `Everything I’m part of (${companies.length + 1})` : 'My personal work' },
    { id: 'personal', label: 'My personal work only' },
    ...companies,
  ];
}
export async function loadScopes(account: AccountSession): Promise<SyncScope[]> {
  // The pinned SDK strips projected name/slug fields; consume this one public
  // response at the boundary until its membership schema preserves them.
  const response = await fetch(`${VAULT_URL}/membership/me`, { headers: { Authorization: `Bearer ${await account.bearer()}`, 'x-hq-client-name': 'hq-desktop-os' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('Your shared workspaces could not be loaded. Check your connection and try again.');
  return membershipScopes(await response.json());
}
export async function ensurePersonalStorage(account: AccountSession): Promise<void> {
  const { VaultClient } = await import('@indigoai-us/hq-cloud');
  await account.bearer();
  const identity = account.identity; if (!identity) throw new Error('Sign in to continue.');
  const client = new VaultClient({ apiUrl: VAULT_URL, authToken: () => account.bearer(), clientInfo: { name: 'hq-desktop-os', version: '0.1.0' } });
  const person = await client.ensureMyPersonEntity({ ownerSub: identity.sub, displayName: identity.label });
  const bucketName = person.bucketName ?? (await client.provisionBucket(person.uid)).bucketName;
  if (!bucketName) throw new Error('Your account is still being prepared. Please try again shortly.');
}
/** Persisted per-folder ownership prevents mixing two accounts in one tree. */
export class WorkspaceAccounts {
  constructor(private readonly directory: string) {}
  async bind(root: string, sub: string): Promise<void> {
    const path = join(this.directory, 'workspace-accounts.json');
    let owners: Record<string, string> = {};
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(sub => typeof sub !== 'string')) throw new Error('Saved workspace accounts could not be read.');
      owners = value as Record<string, string>;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (owners[root] && owners[root] !== sub) throw new Error('This folder belongs to another HQ account. Choose a different folder for this account.');
    owners[root] = sub;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, JSON.stringify(owners), { mode: 0o600 }); await rename(`${path}.tmp`, path);
  }
}
