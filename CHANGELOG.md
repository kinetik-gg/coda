# Changelog

All notable changes to Coda are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Spaces let teams group selected breakdowns and screenplays, share them with Space-level roles, and move resources between Spaces without discarding their existing direct collaborators.

### Changed

- Upgrading an existing instance places its breakdowns and screenplays in a Default Space for organization, while preserving every person's existing access exactly as it was; no one gains access on upgrade.
- Coolify is now described as a manual Compose compatibility path. The falsely labeled automated installer templates were removed, while the manual adapters and optional API-assisted redeploy remain available.

## [0.0.7] - 2026-07-27

### Added

- Right-clicking a library's content plane opens the surface's own actions, built from the same vocabulary the menu bar and command palette publish.
- The command palette reaches every surface — screenplay editor and breakdown workspace as well as the dashboard — offering each surface's real commands rather than the dashboard's.
- Help is available everywhere, and an Open Source Credits modal lists the third-party software the app ships with its licence and links, generated from the dependency tree rather than hand-maintained.
- Groundwork for an adaptive application menu: host-window capabilities (`applicationMenu`, `windowControls`, `titleBarDrag`) resolve once at a single boundary, so a future macOS Electron build can defer to the native menu while Windows keeps the in-app bar. No component branches on a platform or profile name.
- Durable server-side collaboration groundwork (#154): an append-only Yjs update log, a compacted checkpoint per screenplay, and a gateway channel under the screenplay permission vocabulary. **This is groundwork, not a feature** — it is inert without the editor binding, which lands in v0.0.8.

### Changed

- **The dashboard is a polished desktop application rather than a dense one.** Negative space is treated as a design material: a fixed-width centred content column, a wider sidebar, generous row rhythm, and one type ladder with a written role per step — chrome compact, content readable.
- Screenplays, Breakdowns and Trash render through one shared library component instead of three tables that had drifted apart.
- The application header carries only what belongs in it: the menu bar and the command palette trigger on the dashboard; the menu bar, an inline-editable document name, and the object's actions on detail surfaces. No breadcrumbs, no logo, no duplicated identity.
- Chrome recedes into one continuous surface — borders are for data; tone and whitespace are for chrome. Selection is a low-contrast filled shape, never a single-edge indicator.
- Management is a modal for both object types, reachable from each library and from inside the object, with every prior URL still resolving.
- `ModalShell` is configurable and every dialog resolves through it; modals and the command palette share one visual language.
- The screenplay workspace opens on the editor with Statistics over Outline; Preview and Inventory remain a panel switch away.
- Settings no longer nests a sidebar inside a sidebar — the application sidebar becomes the settings navigation.
- Status bars report `CODA vX.Y.Z`, baked from the package manifest, and a completed save reads as a resting state rather than a success to celebrate.
- Password minimum relaxed from 12 to 8 characters.

### Fixed

- The screenplay editor's command target no longer dies on a workspace layout reset, which had left most of the Edit, Format and View menus silently doing nothing (#182).
- `Find Next` / `Find Previous` preserve the user's search query instead of clearing it.
- Sharing opens from inside the screenplay editor; its dialog was mounted behind a gate that never included it.
- Commands that cannot reach an editor report it instead of failing silently, and `Help ▸ Documentation` resolves to a live page.
- Disabled buttons fade rather than recolouring, so a primary action stays identifiable when unavailable.

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

- Experimental Coolify service definitions (app-only and bundled) with generated-value wiring, FQDN-derived origins, and a setup token visible in the platform's environment editor.
- Storage settings in the product: provider presets, live connection validation, hot-swap without restart, and a verified object-migration job with checksum-gated cutover.
- A complete in-app backup story: signed archive download, restore into a fresh instance at setup, scheduled backups with rolling retention and an optional dedicated destination, and an automatic safety backup before migration-bearing upgrades.
- An opt-in upgrade flow: update banner with manual check, a backup-gated ceremony with a generic redeploy-webhook tier and an optional API-assisted Coolify redeploy, and upgrade history.
- Encrypted instance configuration store (`CONFIG_ENCRYPTION_KEY`) keeping runtime-configurable settings out of plaintext.
- Instance doctor page with a sanitized diagnostic report, and a token-gated Prometheus metrics endpoint.
- A database-unreachable diagnostic mode with error classification and in-place recovery instead of a crash loop.
- `TRUSTED_PROXY_CIDRS=auto`: single-deploy proxy trust derived from the container's networks.
- A standalone MinIO stack (`deploy/minio/`) with an independent lifecycle; the app-only topology is now the canonical installation.
- Release-gate hardening: in-app backup format round-trips (including an N-1 compatibility fixture) in the Recovery workflow, Coolify Compose-example validation in CI, and app-only-first release smoke ordering.
- A data compatibility policy (versioned artifact formats, expand–contract migrations, schema-versioned configuration blobs).

### Changed

- Database migrations run inside the application boot sequence behind the readiness probe.
- Documentation restructured around the stateless-application story, with Coolify Compose examples and a fully regenerated environment reference.

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

- The Coolify guide now opens with a manual Compose walkthrough and is linked from the documentation index.
- Integration and end-to-end suites run as isolated scenarios instead of single monolithic tests.
- Workspace dependencies updated across the monorepo (safe minor and patch releases).

## [0.0.2] - 2026-07-23

### Added

- Fountain-native screenplay creation, syntax highlighting, autosave, analysis, import, and lossless export.
- Screenplay PDF preview/export, Final Draft interchange, configurable panels, focus tools, and statistics.
- A first-class screenplay API with optimistic version checks.
- Portable full-stack and app-only deployment adapters, Coolify Compose examples, and recovery tooling.

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
