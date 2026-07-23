# Security model

Coda is designed for a trusted small-team deployment, but every request is still authorized against instance and project state.

## Browser sessions

- Passwords are hashed with Argon2id.
- Login creates an opaque random session whose hash and expiry are stored in Postgres.
- The browser receives an HTTP-only, same-site cookie; secure cookies are enabled for HTTPS origins.
- State-changing cookie-authenticated requests require CSRF protection.
- Authentication and other endpoints are throttled.

The first instance owner is created through a one-time bootstrap flow gated by a setup token, and owner creation must present it in `X-Coda-Setup-Token`, compared in constant time. Provide the token explicitly through `SETUP_TOKEN` (at least 32 characters); an explicit value always takes precedence. When `SETUP_TOKEN` is unset or empty and the instance is uninitialized, Coda generates a high-entropy token at boot, retains only its hash in process memory, and prints the value once per boot inside an unmissable log banner (`CODA SETUP TOKEN`) until setup completes. The generated token regenerates on every restart before setup, is never persisted, and is neither generated nor accepted once an owner exists; there is no tokenless takeover path at any point. Multi-replica bootstrap requires an explicit `SETUP_TOKEN`, since each replica would otherwise generate a different value. Protect an explicit token as an administrative secret even after setup is complete.

### Password policy

New and changed passwords must be at least 12 characters (max 128) and are checked case-insensitively against an embedded list of the 1,000 most common leaked passwords, wherever a password is set or changed (owner setup, invitation acceptance, self-service and administrator password resets, and account password changes). No character-composition rules are enforced, following NIST SP 800-63B guidance (length plus a compromised/common-password blocklist, not forced mixes of character classes). Owner setup, invitation acceptance, and self-service password reset additionally reject a password that contains the account email's local part (for local parts of 4 or more characters). Existing password hashes are never re-validated against this policy. The login endpoint intentionally keeps a permissive, independent check so accounts created before this policy are not locked out.

## API keys and MCP tokens

External credentials are project-bound, user-owned, permission-limited, optionally expiring, and individually revocable. Coda shows a newly created token once and stores only its cryptographic hash, prefix, and last four characters.

Authentication also rechecks that the user is active, the project is active, and the user still has project membership. Credential creation cannot grant a permission that its creator does not possess. Bearer requests are restricted to the external project API and do not use browser CSRF tokens.

Use `X-Coda-Token-Audience: mcp` with MCP tokens. Audience separation prevents an MCP token from being accepted as an API key or vice versa.

## Project authorization

Every project has exactly one transferable owner. Named project roles contain granular permissions, and memberships assign users to roles. Services verify the required permission before reading or mutating project data. A credential is further restricted to its recorded permission subset and bound project.

Resource lookup is project-scoped. Requests for an object outside the bound project should return not found rather than reveal its existence.

## Storage

- The application uses a bucket-scoped service account, not the object-store root account.
- The bucket is private.
- Upload and download access uses short-lived signed URLs.
- Upload completion verifies byte size and MIME type; source PDFs also receive signature and page-count validation.
- Object-store administration ports should remain bound to a trusted network or loopback interface.

Signed URLs are temporary secrets. Exclude query strings and authorization headers from logs and monitoring labels.

## Network and runtime controls

Run Coda behind a TLS-terminating reverse proxy and set `APP_ORIGIN` and `S3_PUBLIC_ENDPOINT` to their externally reachable HTTPS origins. Configure `TRUSTED_PROXY_CIDRS` with only the proxy source addresses and block direct client access to the Coda port; this preserves per-client throttling without trusting spoofed forwarded headers. Restrict Postgres and the internal object-store endpoint to the deployment network. The provided container runs as a non-root user with a read-only filesystem, dropped Linux capabilities, and `no-new-privileges`.

Use unique random values for database, MinIO root, and S3 service credentials. Do not use seed credentials in a shared or production environment.

## Release artifacts

The release workflow accepts only a tag matching the workspace version at the exact head of `main`, refuses to replace an existing version tag, and publishes an SBOM plus build-provenance attestation. The successful workflow summary records the immutable container manifest digest. Production Compose requires that `name@sha256:...` reference instead of defaulting to a mutable registry tag.

## Logs and errors

Structured logs include request IDs, method, sanitized path, status, and bounded error names. They must not include authorization headers, cookies, signed URL query strings, passwords, invitation tokens, or uploaded content.

Public errors use RFC 9457 problem details. Unexpected exceptions are logged server-side and return a generic message without stack traces or database details.

## Reporting vulnerabilities

Follow the private reporting instructions in the repository's `SECURITY.md`. Do not open a public issue for a suspected vulnerability.
