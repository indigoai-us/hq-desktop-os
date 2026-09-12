# Desktop account configuration

Verified on September 11, 2026, before implementing the desktop JWT verifier:

- A current HQ session ID token had issuer `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AXf6Kb5nE` and audience `7acei2c8v870enheptb1j5foln`.
- Fresh production web configuration independently matched the same pool, issuer, client, and hosted login domain at 07:20 UTC.
- AWS `DescribeUserPoolClient` confirmed authorization code flow, the requested scopes, and the registered native callback `http://localhost:53682/callback`.

Verification exposed only this public configuration. Credentials and session tokens were not copied into the repository or the desktop application.

Desktop sign-in uses a separate PKCE verifier, state and nonce per attempt. Main verifies the signed ID token against the exact issuer, audience, expiry, algorithm and nonce. Saved tokens use Electron's OS encryption under `userData/account.encrypted` (`src/main/credential-store.ts`); the Linux `basic_text` plaintext fallback is rejected and persistent sign-in stays disabled with an actionable message. Refresh rejection clears only the matching session; transient connection failures preserve it.

## CLI token cache compatibility

The HQ CLI keeps sessions in `~/.hq/cognito-tokens.json`. Desktop never reads, writes, imports, or clears that file. Sync receives bearer tokens over a private parent IPC pipe (`src/main/sync-child.ts`) instead of sharing the CLI cache. Sign-out removes only the desktop-owned `account.encrypted` file and stops subscriptions; workspace files and any separate CLI session remain intact. Native coverage: `tests/native/auth.test.ts`.

Unit tests cover invalid callbacks, cancellation and listener reuse, signed claims, refresh rejection versus transient failure, and serialized protected storage. Interactive browser login and Windows Credential Manager acceptance remain explicit release checks (recorded deferred in `runtime/manifest.json`).

## Vault API token

Membership and sync use the Cognito **access token** (same as hq-desktop-app `resolve_jwt`). The id token is only for local identity verification. Account and company membership are loaded (`GET /membership/me`) before sync starts.
