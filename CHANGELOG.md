# Changelog

All notable changes to Coda are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.0.6] - 2026-07-26

### Added

- Workspace-grade dashboard: a dense DCC-style shell with the shared application menu bar, a collapsible navigation rail, a live status bar (version, instance health, sync state), dense content-list pages with row context menus, a unified trash across breakdowns and screenplays, flattened instance-settings navigation (single rail, no nested sidebar), and dense token-styled forms for account, admin, and settings pages.
- `@coda/design-tokens`: one shared package for spacing, typography, and chrome dimensions consumed by every surface; all dashboard and editor chrome resolves through it.
- Screenplay parity: soft delete/restore/purge with the same 30-day retention as breakdowns; memberships, roles, invitations, and ownership transfer with permission enforcement on every screenplay endpoint (design recorded in an ADR); a management surface for members/roles/invitations/danger zone; a share affordance in the editor; read-only members get a read-only editor.
- Server-synced screenplay panel layouts with optimistic revision concurrency, one-time migration from localStorage, and offline fallback.
- Unified editor platform: one declarative menu-bar framework, one composable status bar with a canonical save-state vocabulary, and one panel-chrome convention (right-click context menus plus a fullscreen toggle; per-panel toolbars declared in registries).

### Changed

- Editors and dashboard now share identical chrome primitives and theming; the panel "more" button is retired in favor of context menus.
- Editor commands report precise availability: menu items disable when no editor panel is active or a clipboard API is missing, with copy/cut falling back to `document.execCommand` in insecure contexts.

### Fixed

- Screenplay editor input fidelity: click-to-line targeting, arrow-key cursor jumps, and unreliable scrolling (a single scroll-intent arbiter replaces competing sync flags; regression-tested by a Playwright fidelity matrix).
- Breakdown layout sync self-heals: 409 conflicts rebase and retry silently, publish conflicts prompt an explicit choice, save/publish/reset serialize through one queue, and duplicate toasts are suppressed. Conflict counters are exported via `/metrics`.
- The runtime container no longer ships the base image's bundled npm CLI (removes scanner-blocking CVEs from an unused component).

## [0.0.5] - 2026-07-25

### Added

- Storage abstraction: a BlobStore interface with capability negotiation, the S3 driver refactored onto it, and a new filesystem driver with app-proxied signed transfers (`BLOB_DRIVER=fs`).
- Database portability: a DatabaseCapabilities seam corralling every non-portable construct, a committed SQLite schema transform, and a CI lane running a curated suite against SQLite as a standing portability tripwire.
- Runtime profiles: a `RUNTIME_PROFILE` capability map (`server`/`desktop`) with a desktop preset (local single-user bootstrap, single-process scheduling, disabled poller) and build guards preventing profile-name branching.
- TOTP two-factor authentication with recovery codes, a challenge-based login step, and owner-initiated reset.
- Session management: list active sessions with device classes, revoke individually, or sign out everywhere.
- Runtime base image upgraded to Node 26-alpine with prisma generation confined to the native build platform (multi-architecture builds no longer execute Prisma under emulation).

### Fixed

- js-yaml denial-of-service advisory patched via a workspace override.

### Changed

- Quality gates now include database-portability and runtime-profile guards.

## [0.0.4] - 2026-07-24

### Added

- One-click Coolify service templates (app-only and bundled) with generated secrets, FQDN-derived origins, and a setup token visible in the platform's environment editor.
- Storage settings in the product: provider presets, live connection validation, hot-swap without restart, and a verified object-migration job with checksum-gated cutover.
- A complete in-app backup story: signed archive download, restore into a fresh instance at setup, scheduled backups with rolling retention and an optional dedicated destination, and an automatic safety backup before migration-bearing upgrades.
- An opt-in upgrade flow: update banner with manual check, a backup-gated ceremony with a generic redeploy-webhook tier and an optional one-click Coolify adapter, and upgrade history.
- Encrypted instance configuration store (`CONFIG_ENCRYPTION_KEY`) keeping runtime-configurable settings out of plaintext.
- Instance doctor page with a sanitized diagnostic report, and a token-gated Prometheus metrics endpoint.
- A database-unreachable diagnostic mode with error classification and in-place recovery instead of a crash loop.
- `TRUSTED_PROXY_CIDRS=auto`: single-deploy proxy trust derived from the container's networks.
- A standalone MinIO stack (`deploy/minio/`) with an independent lifecycle; the app-only topology is now the canonical installation.
- Release-gate hardening: in-app backup format round-trips (including an N-1 compatibility fixture) in the Recovery workflow, Coolify template validation in CI, and app-only-first release smoke ordering.
- A data compatibility policy (versioned artifact formats, expand–contract migrations, schema-versioned configuration blobs).

### Changed

- Database migrations run inside the application boot sequence behind the readiness probe.
- Documentation restructured around the one-click install and stateless-application story, with a fully regenerated environment reference.

## [0.0.3] - 2026-07-24

### Added

- Zero-configuration first-run bootstrap: when `SETUP_TOKEN` is not configured, an uninitialized production instance generates a one-time setup token at boot and prints it in the container logs.
- Account-scoped progressive login backoff on top of the per-IP throttle, with configurable threshold and windows.
- A stronger password policy: 12-character minimum, a common-password blocklist, and rejection of passwords containing the account email's local part.
- Opt-in sanitized HTTP error detail in logs (`LOG_HTTP_ERROR_DETAIL`) for staging diagnostics.
- A machine-readable `release.json` asset on every release and automated digest propagation into deployment templates after publication.
- An optional, manually dispatched redeploy webhook workflow for deployment platforms.
- A CI gate proving concurrent-boot migrations apply exactly once across replicas.

### Changed

- The Coolify guide now opens with a one-pass quickstart and is linked from the documentation index.
- Integration and end-to-end suites run as isolated scenarios instead of single monolithic tests.
- Workspace dependencies updated across the monorepo (safe minor and patch releases).

## [0.0.2] - 2026-07-23

### Added

- Fountain-native screenplay creation, syntax highlighting, autosave, analysis, import, and lossless export.
- Screenplay PDF preview/export, Final Draft interchange, configurable panels, focus tools, and statistics.
- A first-class screenplay API with optimistic version checks.
- Portable full-stack and app-only deployment adapters, a Coolify deployment template, and recovery tooling.

### Changed

- **Breaking:** The product home now opens Screenplays, while the former project workflow is presented as Breakdowns.

### Fixed

- Screenplay cursor navigation, selection, scroll synchronization, pagination, and export fidelity.
- Editor typing latency and bounded PDF/export resource use.

## [0.0.1] - 2026-07-22

### Added

- Initial self-hosted workspace release.
- Configurable project hierarchies, custom fields, comments, activity, trash, and exports.
- PDF source references and private S3-compatible object storage.
- Project roles, invitation-only accounts, API credentials, and an MCP server.
- Container deployment with PostgreSQL and MinIO.

[0.0.1]: https://github.com/kinetik-gg/coda/releases/tag/v0.0.1
[0.0.2]: https://github.com/kinetik-gg/coda/releases/tag/v0.0.2
[0.0.3]: https://github.com/kinetik-gg/coda/releases/tag/v0.0.3
[0.0.4]: https://github.com/kinetik-gg/coda/releases/tag/v0.0.4
[0.0.5]: https://github.com/kinetik-gg/coda/releases/tag/v0.0.5
[Unreleased]: https://github.com/kinetik-gg/coda/compare/v0.0.5...HEAD
