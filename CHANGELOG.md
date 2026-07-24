# Changelog

All notable changes to Coda are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
[Unreleased]: https://github.com/kinetik-gg/coda/compare/v0.0.4...HEAD
