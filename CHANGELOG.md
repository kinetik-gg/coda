# Changelog

All notable changes to Coda are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
[Unreleased]: https://github.com/kinetik-gg/coda/compare/v0.0.3...HEAD
