# Desktop account configuration

Verified on September 11, 2026, before implementing the desktop JWT verifier:

- A current HQ session ID token had issuer `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AXf6Kb5nE` and audience `7acei2c8v870enheptb1j5foln`.
- Fresh production web configuration independently matched the same pool, issuer, client, and hosted login domain at 07:20 UTC.
- AWS `DescribeUserPoolClient` confirmed authorization code flow, the requested scopes, and the registered native callback `http://localhost:53682/callback`.

Verification exposed only this public configuration. Credentials and session tokens were not copied into the repository or the desktop application.

Desktop sign-in uses a separate PKCE verifier, state and nonce per attempt. Main verifies the signed ID token against the exact issuer, audience, expiry, algorithm and nonce. Saved tokens use Electron's OS encryption; the Linux plaintext fallback is rejected. Refresh rejection clears only the matching session; transient connection failures preserve it. The application does not import or overwrite the CLI token cache.

Unit tests cover invalid callbacks, cancellation and listener reuse, signed claims, refresh rejection versus transient failure, and serialized protected storage. These checks do not establish native browser login or OS keyring acceptance; those remain explicit release checks.

## Vault API token

Membership and sync use the Cognito **access token** (same as hq-desktop-app `resolve_jwt`). The id token is only for local identity verification.
