# Security model

Coda is designed for a trusted small-team deployment, but every request is still authorized against instance and project state.

## Browser sessions

- Passwords are hashed with Argon2id.
- Login creates an opaque random session whose hash and expiry are stored in Postgres.
- The browser receives an HTTP-only, same-site cookie; secure cookies are enabled for HTTPS origins.
- State-changing cookie-authenticated requests require CSRF protection.
- Authentication and other endpoints are throttled per source IP.
- Login is additionally protected by account-scoped progressive backoff.

Login timing is equalized: every attempt performs one Argon2id verification, using a fixed dummy hash when the account is absent, disabled, or locked, so response shape and timing never reveal whether an account exists or is currently locked.

## Login backoff

Per-IP throttling bounds a single source address, but a distributed credential-stuffing attempt that rotates source IPs would otherwise be limited only by those per-IP windows. Coda therefore also tracks consecutive failed logins per account in Postgres (`failed_login_attempts` and `login_locked_until` on the user record), so the defense survives restarts and adds no new infrastructure dependency.

After `AUTH_LOGIN_BACKOFF_THRESHOLD` consecutive failures (default 5), each further failure opens an increasing delay window — `AUTH_LOGIN_BACKOFF_WINDOWS_MS` (default 1m, 5m, 15m, with the final value as the cap). While a window is open, no login for that account is accepted, even with the correct password. The counter and window are cleared on the next successful login or a completed password reset (self-service reset link or administrator reset), which is the supported recovery path for a locked-out account.

Enforcement is timing-safe and free of a user-enumeration or lock-state oracle: the constant-time password verification always runs before any decision, a locked account is rejected with exactly the same problem-details response as an ordinary failed login, and failed-attempt accounting is kept off the constant-time path. Because a distributed brute force against one account is bounded by that account's own counter, it is limited regardless of how many source IPs participate.

The first instance owner is created through a one-time bootstrap flow gated by a setup token, and owner creation must present it in `X-Coda-Setup-Token`, compared in constant time. Provide the token explicitly through `SETUP_TOKEN` (at least 32 characters); an explicit value always takes precedence. When `SETUP_TOKEN` is unset or empty and the instance is uninitialized, Coda generates a high-entropy token at boot, retains only its hash in process memory, and prints the value once per boot inside an unmissable log banner (`CODA SETUP TOKEN`) until setup completes. The generated token regenerates on every restart before setup, is never persisted, and is neither generated nor accepted once an owner exists; there is no tokenless takeover path at any point. Multi-replica bootstrap requires an explicit `SETUP_TOKEN`, since each replica would otherwise generate a different value. Protect an explicit token as an administrative secret even after setup is complete.

### Password policy

New and changed passwords must be at least 12 characters (max 128) and are checked case-insensitively against an embedded list of the 1,000 most common leaked passwords, wherever a password is set or changed (owner setup, invitation acceptance, self-service and administrator password resets, and account password changes). No character-composition rules are enforced, following NIST SP 800-63B guidance (length plus a compromised/common-password blocklist, not forced mixes of character classes). Owner setup, invitation acceptance, and self-service password reset additionally reject a password that contains the account email's local part (for local parts of 4 or more characters). Existing password hashes are never re-validated against this policy. The login endpoint intentionally keeps a permissive, independent check so accounts created before this policy are not locked out.

## API keys and MCP tokens

External credentials are project-bound, user-owned, permission-limited, optionally expiring, and individually revocable. Coda shows a newly created token once and stores only its cryptographic hash, prefix, and last four characters.

Authentication also rechecks that the user is active, the project is active, and the user still has project membership. Credential creation cannot grant a permission that its creator does not possess. Bearer requests are restricted to the external project API and do not use browser CSRF tokens.

Credentials are excluded from Space-derived access. Every permission service treats a bearer credential as a non-member of any Space and returns `404`, so a credential reaches only its own bound project through a direct membership — widening a Space never widens what an existing API key or MCP token can read. Bearer credentials also cannot mutate screenplays at all.

Use `X-Coda-Token-Audience: mcp` with MCP tokens. Audience separation prevents an MCP token from being accepted as an API key or vice versa.

## Project authorization

Every project has exactly one transferable owner. Named project roles contain granular permissions, and memberships assign users to roles. Services verify the required permission before reading or mutating project data. A credential is further restricted to its recorded permission subset and bound project.

A user can reach a breakdown or screenplay two ways: a **direct membership** on that resource, or a **Space membership** that contains it. `PermissionService` (`apps/api/src/projects/permission.service.ts`) and `ScreenplayPermissionService` (`apps/api/src/screenplays/screenplay-permission.service.ts`) resolve them in that order and the first match wins — an active direct membership short-circuits, and the Space tier is never consulted for that resource. A direct role therefore caps what a Space grants: a user who is a direct `viewer` on a project does not gain edit rights from a `manager` role in the Space holding it. Where a user has no direct membership, the Space tier is the sole source of permissions and `isOwner` is forced to `false`, so Space-derived access can never act as resource ownership.

Listing is the one place the two are unioned: `SpaceResourcesService.listAccessibleResourceIds` returns the set union of directly-held resources and Space-reachable ones.

### Tenant isolation: 404, not 403

Requests for a resource the caller cannot see return `404 Not Found`, not `403 Forbidden`, so existence is never disclosed across a tenant boundary. `403` is reserved for a caller who is already an established member of the containing scope but lacks the specific permission.

This is enforced in the three permission services named above plus `SpacePermissionService` (`apps/api/src/spaces/space-permission.service.ts`), which documents itself as the single choke point for Spaces: a non-member, an inactive membership, an archived role, or a soft-deleted Space all produce `404`; `403` is only reachable after an active membership has been resolved. The screenplay collaboration join handshake (`apps/api/src/screenplays/collab/screenplay-collab-log.service.ts`) deliberately downgrades a `403` to `404` so joining a room cannot distinguish a restricted member from a non-member.

Note for contributors: this is a convention applied in each permission service, not a shared guard or interceptor. A new resource scope must implement it deliberately; nothing enforces it automatically.

## Spaces

A Space is a container that grants additive access to the breakdowns and screenplays mapped into it. A resource belongs to exactly one Space, enforced by a unique constraint on `(resource_type, resource_id)`.

- **Permissions** (`packages/contracts/src/space-permissions.ts`) govern the Space object itself: `read_space`, `manage_space_settings`, `invite_members`, `manage_member_roles`, `manage_roles`, `create_resources`, `move_resources`, `delete_space`.
- **Resource tiers** (`viewer`, `contributor`, `manager`) are carried on the Space role and projected onto the resources inside it by `packages/contracts/src/resource-types.ts`. Tiers are cumulative: `viewer` reads and comments, `contributor` adds content editing, `manager` adds resource settings.
- **A tier can never escalate.** A load-time invariant in that same module throws at module import if any tier ever projects `delete_project`, `invite_members`, `manage_roles`, or `manage_member_roles`. Space-derived access can read and write content but cannot destroy a resource, re-share it, or change who else can reach it.
- **Ownership transfer** requires the caller to hold the Space's owner role — not merely `manage_space_settings` — and is refused on the Default Space.
- **Moving a resource** requires `move_resources` on both the source and target Space _and_ resource-level authority (project/screenplay ownership or its settings permission). A `move-preflight` endpoint reports which users gain or lose access before the move; it runs the same authorization as the move itself.

### The Default Space is instance-wide — do not add members to it

The Spaces migration creates one fixed Space (`00000000-0000-4000-8000-000000000001`, named "Default") and maps **every** existing breakdown and screenplay into it, including soft-deleted rows. The boot-time reconciler keeps doing this: any resource without an explicit mapping is placed in the Default Space, and a resource with no mapping at all is treated as belonging to it.

**A membership in the Default Space therefore grants that user access to every breakdown and screenplay on the instance, at the tier of their role.** This is the most consequential authorization decision an operator can make in the product, and it does not look like one in the UI — it is the same "add a member" action as on any other Space.

What holds the line today is that the Default Space ships with **zero memberships**, deliberately: the migration seeds roles but explicitly inserts no rows into `space_memberships`, so the upgrade to Spaces grants nobody new access. `Space.ownerUserId` is not a membership — it conveys settings and rename authority only — so no user, including the instance owner, currently resolves a Default Space membership, and the API paths that would add one are unreachable (they `404`).

Operators and contributors should treat that emptiness as load-bearing:

- There is **no `isDefault` guard on membership creation, role creation, or invitation.** The only `isDefault` guards are on deleting a Space and transferring its ownership.
- `SpaceResourceMovesService` **skips the `move_resources` assertion entirely when the source or target is the Default Space**, leaving only the resource-level check. That is safe only while the Default Space has no members; with a member present, moving a resource into it becomes a permission-free instance-wide share.

If you need to share broadly, create a purpose-built Space and move resources into it rather than granting membership on the Default Space.

## Live collaboration

Screenplay collaboration is Yjs over Socket.IO. Its durable state is ordinary Postgres data — an append-only update log (`screenplay_collab_updates`), a compacted checkpoint per screenplay (`screenplay_collab_checkpoints`), and range-anchored comment threads (`screenplay_comment_threads`, `screenplay_comments`) — so it is covered by database backups with no separate procedure. Presence and awareness are **not persisted**; they live in per-process socket state, which means presence is per-replica.

Authorization happens at two points. `read_screenplay` is checked when a client joins a screenplay room. Each subsequent update is checked for `edit_screenplay` against the permission set **cached at join time**, not a fresh database read. Revoking a user's access mid-session is honoured only when an eviction signal fires for that member or screenplay; the update path itself will not re-read permissions. Treat "revoke and the session dies immediately" as an unverified assumption, and disable the account if you need a hard cutoff.

Comment endpoints re-check permissions per request: `read_screenplay` to read, `edit_screenplay` to write, and `manage_screenplay_settings` to moderate another user's comment.

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
