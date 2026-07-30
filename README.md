# Coda

**A self-hosted workspace for screen production: write the script together, break it down, and keep both in one shared Space.**

Coda is a self-hosted, desktop-first application. A **Space** is the container everything lives in: it holds screenplays and breakdowns, and its members and roles decide who can reach them. Share the Space once and every resource inside it is shared — you do not re-invite the same collaborators for each script and each breakdown.

[Documentation](https://kinetik-gg.github.io/coda-docs/) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [MIT License](LICENSE)

Coda is focused on collaborative screenplay authoring and source breakdown. It is not a task manager, end-to-end production tracker, or media-review suite.

## Spaces: the container everything lives in

A Space holds two kinds of resource today — **screenplays** and **breakdowns** — and every resource lives in exactly one Space. Instances that predate Spaces keep their existing resources in a fixed **Default Space**, which cannot be deleted.

- **One membership, many resources.** A Space member holds one Space role. That role carries Space-level permissions (`read_space`, `manage_space_settings`, `invite_members`, `manage_member_roles`, `manage_roles`, `create_resources`, `move_resources`, `delete_space`) plus a single **resource tier** — `viewer`, `contributor`, or `manager` — that projects onto every resource in the Space. A contributor can edit the scripts and the breakdown items; a manager can additionally change their settings, fields, and entity types.
- **A Space tier never escalates into ownership.** By construction, a Space role can never grant deleting a resource, re-sharing it, or reassigning its own membership roles. Those stay with the resource's own owner and roles.
- **Space access is additive, not a replacement.** Screenplays and breakdowns keep their own direct memberships, roles, and invitations. A person reaches a resource if the Space grants it _or_ they were invited to that resource directly, so moving a resource into a Space never takes access away from its existing collaborators.
- **Roles and invitations are per Space.** Space roles are named and editable, invitations go out by email against a hashed, expiring token, and memberships and roles both use optimistic version checks.
- **Spaces are not observable across tenants.** A non-member asking about a Space gets `404`, never `403`. REST API keys and MCP tokens are scoped to a single breakdown and are never treated as Space members.
- **Moving and handover.** A resource can be moved to another Space you can write to, behind a preflight that reports what the move would change, and a Space's ownership can be transferred to another member. The Default Space can be neither transferred nor deleted.

In the app, the sidebar carries a **Space switcher**: it picks the active Space, scopes the Screenplays and Breakdowns libraries to it, and opens that Space's management surface for members, roles, invitations, ownership, and deletion. Creating a Space is currently an API operation (`POST /api/v1/spaces`); the interface works with the Spaces you already belong to.

## Live collaborative screenwriting

Screenplays are edited live. The editor binds a Yjs CRDT document to CodeMirror over a Socket.IO gateway, so several people can type in the same script at once without a save conflict.

- **Presence and remote cursors.** Each participant gets a colour and a named chip in the editor chrome; remote selections and carets render inline in the text.
- **Durable server-side history.** The server keeps an append-only update log plus one compacted checkpoint per screenplay, and a background job folds the log into the checkpoint once it crosses a row or byte threshold.
- **Offline recovery.** Local edits are buffered in IndexedDB. On reconnect the client sends its Yjs state vector and the server returns only the updates it is missing, so a dropped connection or a closed tab replays instead of losing work.
- **Per-user undo.** Undo runs through a per-session Yjs undo manager, so undoing your own work never rolls back a collaborator's typing.
- **Comment threads anchored to the text.** A thread is anchored to a range of the script, quotes the text it was raised on, takes replies, and can be resolved. The anchors move with the document, so threads survive edits around them.
- **Authorization is re-checked, not cached forever.** Read-only members join and follow along, but their publish attempts are refused; when membership, roles, or ownership change, the server tells connected clients to re-join before trusting their access again.

## Screenplay authoring

- Fountain is the canonical source format, with contextual syntax highlighting, autosave, and lossless `.fountain` export.
- Import from Fountain, Final Draft XML (`.fdx`), or plain text; export to Fountain or `.fdx`. FDX is a lossy interchange — revisions, production metadata, custom styles, and embedded media are not preserved — and the app states that before you rely on it.
- PDF export, with a page-fidelity gate in continuous integration so exported pages keep matching the on-screen preview.
- A panel workspace with preview, outline, statistics, inventory, and comment panels, and server-synced per-user panel layouts.

## Breakdown workspace

- Configurable one-, two-, or three-level hierarchies with custom singular and plural names and display prefixes.
- Blank breakdowns plus server-side starter templates:

  | Template  | Default hierarchy       |
  | --------- | ----------------------- |
  | Movie     | Sequence → Scene → Shot |
  | TV Series | Episode → Scene → Shot  |
  | Comic     | Issue → Page → Panel    |

  Templates add a small set of editable typed fields and can be created without uploading a PDF. A source document can be added later.

- Spreadsheet-style tables with search, typed filters, sorting, inline editing, column sizing, and saved manual ordering.
- Ordered custom fields: text, long text, single- and multi-select enums, integers, floats, booleans, dates, and stored file, image, and video media.
- An integrated PDF workspace where breakdown items carry page-range references into the source document.
- Breakdown-scoped roles, granular permissions, invitations, per-item comments, and an activity history.
- Recoverable trash shared by breakdowns and screenplays, CSV and JSON exports, REST API keys, and a breakdown-scoped MCP server.
- A self-hosted application backed by PostgreSQL and S3-compatible object storage.

## Install

The fastest path is a **one-click Coolify service template**: paste one file, assign your domain,
and deploy. Coolify generates every secret, so there is nothing to hand-generate and no container
logs to read. Choose `coda` when you already run PostgreSQL and S3, or `coda-complete` for an
all-in-one stack. See [Deploy with Coolify](docs/coolify.md).

Coda is a stateless application: it holds no local state and stores everything in PostgreSQL and
S3-compatible object storage. Once running, the instance operates itself from the admin settings —
in-app backups (download, scheduled with retention, restore-at-setup, and automatic pre-upgrade
snapshots), a storage wizard with verified object migration, an update checker with an optional
upgrade ceremony, a diagnostic doctor page, and a token-gated `/metrics` endpoint.

## Install with Docker Compose

Coda is a stateless application. PostgreSQL and S3-compatible object storage are external
services you bring—managed offerings or self-hosted stacks with their own independent
lifecycles. The canonical installation is therefore the **app-only topology**
(`compose.app.yaml`): Coda alone, pointed at stores you own. The bundled full stack
(`compose.yaml`) remains supported as an **all-in-one quickstart** for evaluation, and
`deploy/minio/` provides a standalone object-storage stack when you want to self-host storage
with a lifecycle separate from the application.

Requirements: Docker Engine 26+ with the Compose plugin. The dependency-free operator utilities
in release archives require Node.js 22+.

Download the versioned deployment archive and matching checksum from the GitHub release,
verify the checksum and GitHub artifact attestations, then extract it. The bundle includes both
canonical topologies, the standalone object-storage stack, localhost overlays, environment
templates, and operations documentation with the release's exact attested image digest already
injected.

```bash
gh attestation verify coda-deployment-v0.0.7.tar.gz --repo kinetik-gg/coda
gh attestation verify coda-deployment-v0.0.7.sha256 --repo kinetik-gg/coda
sha256sum --check coda-deployment-v0.0.7.sha256
```

To install directly from a source checkout instead:

```bash
git clone --branch v0.0.7 --depth 1 https://github.com/kinetik-gg/coda.git
cd coda
cp .env.example .env
```

Copy the `name@sha256:...` image reference from the successful release workflow's **Published container** summary into `CODA_IMAGE`. Replace every remaining `replace-with-...` value in `.env` with a unique random value.

### Canonical deployment (external PostgreSQL and object storage)

Use the app-only topology when PostgreSQL and S3-compatible storage are managed elsewhere. Set `DATABASE_URL`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, credentials, bucket, region, and `S3_FORCE_PATH_STYLE` in `.env`, then run:

```bash
docker compose -f compose.app.yaml -f compose.app.local.yaml up -d
docker compose -f compose.app.yaml -f compose.app.local.yaml ps
```

Open `http://localhost:3000` and complete the one-time owner setup using the `SETUP_TOKEN` from `.env`. The production stack does not create a default account.

Managed PostgreSQL deployments should require TLS in `DATABASE_URL`. Virtual-hosted S3 providers normally require `S3_FORCE_PATH_STYLE=false`. Provision the bucket and its CORS policy before starting Coda. See [deployment and operations](docs/operations.md) for the app-only `docker run` equivalent and reverse-proxy topology.

### Self-hosted object storage

If you self-host S3-compatible storage rather than using a managed provider, `deploy/minio/` is a hardened, standalone MinIO stack you deploy as its own resource so storage keeps a lifecycle independent of the application—it survives application redeploys and can later be replaced by R2, S3, or Spaces. Copy `deploy/minio/minio.env.example` to `deploy/minio/minio.env`, replace every placeholder, then run:

```bash
docker compose -f deploy/minio/compose.yaml -f deploy/minio/compose.local.yaml up -d
```

The stack provisions the private bucket and a bucket-scoped service account; point the application's `S3_*` variables at it and back it up independently of Coda.

### All-in-one quickstart (bundled full stack)

For evaluation, the bundled full stack runs Coda, PostgreSQL, and MinIO together in one project. Keep the PostgreSQL password in `DATABASE_URL` synchronized with `POSTGRES_PASSWORD`; URL-encode it if it contains reserved characters. Then run:

```bash
docker compose -f compose.yaml -f compose.local.yaml up -d
docker compose -f compose.yaml -f compose.local.yaml ps
```

Open `http://localhost:3000` and complete the one-time owner setup using the `SETUP_TOKEN` from `.env`. The production stack does not create a default account.

This reference deployment starts:

- the attested `ghcr.io/kinetik-gg/coda@sha256:...` manifest selected in `CODA_IMAGE`
- PostgreSQL for durable application data
- MinIO with a bucket-scoped Coda service account

`compose.yaml` is the platform-neutral full stack and publishes no host ports. The explicit `compose.local.yaml` override binds only Coda and the MinIO S3 API to localhost; it never exposes PostgreSQL or the MinIO administration console.

### Local image build

Use the development override to build the application image from the checkout:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

## Local development

Requirements: Node.js 24, pnpm 11, and Docker.

```bash
pnpm install --frozen-lockfile
copy .env.example .env
copy .env.local.example .env.local
# Replace every placeholder secret in both files before starting services.
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres minio minio-init
pnpm db:generate
pnpm db:deploy
pnpm dev
```

On macOS or Linux, use `cp` instead of `copy`. Fill `.env.local` with the same local service credentials used in `.env`, then open `http://localhost:5173`. `pnpm db:generate` and `pnpm db:deploy` read `DATABASE_URL` from the process environment, so export the local one — `postgresql://coda:<password>@127.0.0.1:5432/coda?schema=public` — when you run them.

The development web and API servers bind to `0.0.0.0`; for another device on the LAN, add `DEV_ALLOWED_ORIGINS=http://<development-host-ip>:5173` to `.env.local` before starting Coda and open that address from the device. Production rejects this development-only allowlist.

Useful checks:

```bash
pnpm format:check
pnpm quality
pnpm typecheck
pnpm test:unit
pnpm openapi:check
pnpm build
```

Pull requests also run integration tests against a disposable production topology on both the S3 and filesystem storage drivers, an empty-database migration smoke test, a derived-SQLite portability lane, the Playwright product loop, a two-client collaboration suite, and fresh-install plus upgrade deployment smoke tests.

## API and MCP

Account settings can create separate, breakdown-scoped REST API keys and MCP tokens. Tokens are shown once, stored only as hashes, limited to selected permissions, and can be expired or revoked independently. Because a credential is bound to one breakdown, it is never treated as a Space member.

The MCP server is a REST client rather than a database bypass. It exposes bounded breakdown, schema, item, source, and activity tools while omitting administrative and destructive operations.

- [Documentation](https://kinetik-gg.github.io/coda-docs/)
- [External OpenAPI specification](docs/openapi.json)
- [MCP package](apps/mcp)

## Data and operations

Coda operates from the admin settings without shell access:

- **Backups.** Download a signed `.codabk` archive on demand, schedule recurring backups with rolling retention, restore a fresh instance from its first-run screen, and capture an automatic pre-upgrade snapshot before migrations apply. Every archive holds both the database and stored objects. Restoring on another instance requires that instance to carry the source's `CONFIG_ENCRYPTION_KEY`.
- **Storage.** A storage wizard validates, hot-swaps, and (with verified object migration) moves the object-storage backend at runtime.
- **Updates.** An update checker surfaces new releases, and an opt-in upgrade ceremony gates every redeploy behind a fresh backup, with a generic redeploy-webhook tier and an optional Coolify adapter.
- **Diagnostics.** A doctor page renders a sanitized instance report, and a token-gated Prometheus `/metrics` endpoint exposes request, storage, and update signals.

The [deployment and operations guide](docs/operations.md) documents each of these, the full environment contract, and the operator-side backup/restore procedures. [Data compatibility](docs/data-compatibility.md) is the standing policy for backup-format versions, database migrations, and config blobs. Do not run an older application against a database already migrated by a newer incompatible release.

## Current scope

Coda is an early, desktop-first self-hosted product:

- Spaces hold breakdowns and screenplays, and nothing else yet. Each resource lives in exactly one Space.
- Spaces are created through the API. The interface switches between, and manages, Spaces you already belong to.
- A Space role grants working access to the resources inside a Space; it never grants deleting a resource, re-sharing it, or reassigning its membership roles.
- Live co-editing, presence, per-user undo, and range-anchored comment threads apply to **screenplays**. The breakdown workspace still coordinates through authorized change notifications and authoritative refetching rather than live cell co-editing, and breakdown item comments are flat rather than threaded.
- Screenplays use Fountain as their canonical source. Fountain round-trips losslessly; FDX import and export are deliberately lossy; plain text imports as forced action. Fade In, Celtx, Movie Magic, and Highland project containers cannot be read — export an interchange format from those applications first.
- Breakdown source documents are PDF-only, with one active source PDF per breakdown.
- Breakdown items are created manually; OCR and automatic extraction are not included.
- Hierarchies are limited to one, two, or three levels.
- JSON exports contain storage metadata but not uploaded binaries.
- TLS and public routing remain the operator's responsibility; backups and restore are available in-app.

## Repository information

- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)

Coda is released under the MIT License. The name and logo identify this project and are not granted as trademarks by the software license.
