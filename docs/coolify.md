# Deploy Coda with Coolify

The fastest path is a **one-click service template**: paste one file, assign your domain, and
deploy. Coolify generates every remaining secret from its magic variables and shows them in the
environment editor, so there is nothing to hand-generate and no container logs to read. The
templates live in [`deploy/coolify/templates/`](../deploy/coolify/templates):

| Template                                                          | Use when                                             | You supply                                   | Coolify generates                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| [`coda`](../deploy/coolify/templates/coda.yaml)                   | You already run PostgreSQL and S3 (canonical setup). | One domain, `DATABASE_URL`, external `S3_*`. | `SETUP_TOKEN`, `CONFIG_ENCRYPTION_KEY`.                               |
| [`coda-complete`](../deploy/coolify/templates/coda-complete.yaml) | You want an all-in-one stack with no dependencies.   | Two domains (Coda + S3 API).                 | Everything: PostgreSQL, MinIO, all credentials, and both app secrets. |

Both templates pin an immutable Coda release **version tag** for readability
(`ghcr.io/kinetik-gg/coda:0.0.4`), set `TRUSTED_PROXY_CIDRS=auto` so the forwarding boundary is
derived automatically, derive `APP_ORIGIN` from the domain you assign, and pre-set `SETUP_TOKEN`
from a magic password variable so the owner-setup token is visible in the environment editor. For
the hardened supply-chain path, swap the version tag for the matching
`ghcr.io/kinetik-gg/coda@sha256:...` manifest digest as described in
[Pin the release image](#pin-the-release-image).

This adapter deploys the same immutable Coda image and service boundaries as the canonical
Compose files. It does not build a second image and does not publish database, object-store
administration, or application ports directly on the host.

Coolify documents Docker Compose as the source of truth for service configuration, exposes
non-default container ports by adding the port to the service domain, detects `${VAR}`
references as editable environment variables, generates `SERVICE_*` magic variables for
secrets and domains, and uses Compose healthchecks for service routing. See the official
[Docker Compose](https://coolify.io/docs/knowledge-base/docker/compose),
[domains](https://coolify.io/docs/knowledge-base/domains),
[environment variables](https://coolify.io/docs/knowledge-base/environment-variables), and
[health checks](https://coolify.io/docs/knowledge-base/health-checks) documentation.

## Quickstart (one-click template)

This takes a fresh, owner-claimed Coolify instance to a working Coda deployment with zero
hand-generated secrets and zero log reading.

1. **DNS.** Point one domain at the host for Coda (for example `coda.example.com`). For
   `coda-complete`, add a second domain for the S3 API (for example `objects.example.com`).
2. **Create the service.** Add a new resource, choose the **Docker Compose** build pack, and
   paste [`coda.yaml`](../deploy/coolify/templates/coda.yaml) or
   [`coda-complete.yaml`](../deploy/coolify/templates/coda-complete.yaml) into the compose
   editor. Leave **Raw Compose** off; `coda-complete` uses Coolify's documented
   `exclude_from_hc` extension for the one-shot `minio-permissions` and `minio-init` services.
3. **Assign the domain(s).** Attach your Coda domain to the `coda` service. For `coda-complete`,
   also attach the S3 API domain to the `minio` service. Coolify captures each domain in the
   corresponding `SERVICE_FQDN_*` variable and routes it to the container port.
4. **Fill only what the template asks for.** `coda` prompts for `DATABASE_URL` and the external
   `S3_*` settings; `coda-complete` prompts for nothing else. Every other value—`SETUP_TOKEN`,
   `CONFIG_ENCRYPTION_KEY`, the PostgreSQL password, and the MinIO credentials—is already filled
   with a generated `SERVICE_*` value visible in the editor.
5. **Deploy.** Wait for `coda` (and, for `coda-complete`, `postgres` and `minio`) to report
   healthy. `minio-permissions` and `minio-init` are one-shot services that exit successfully.
6. **Complete owner setup.** Open the Coda domain and complete owner setup with the `SETUP_TOKEN`
   value shown in the environment editor. Then take the first backup (see
   [Backup and restore handoff](#backup-and-restore-handoff)).

The generated `SETUP_TOKEN` and `CONFIG_ENCRYPTION_KEY` persist across redeploys. Back up
`CONFIG_ENCRYPTION_KEY`: the same key is required to read previously written encrypted instance
configuration. The manual, digest-pinned walkthrough below remains available for operators who
prefer to manage every value explicitly.

## Manual walkthrough (full stack, digest-pinned)

This walkthrough takes a fresh Coolify instance to a working full-stack Coda deployment
(Coolify-managed PostgreSQL and MinIO) in one top-to-bottom pass without the one-click template.
The full stack is the all-in-one option for evaluation; the canonical topology is app-only—Coda
with external PostgreSQL and S3—covered in [Choose one topology](#choose-one-topology). Each step
links to the reference section below for the underlying detail; the app-only topology is covered
in those sections. Every value here comes from `deploy/coolify/full.env.example` and
`deploy/coolify/compose.full.yaml`.

### 1. Prerequisites

- An AMD64 Linux host running Coolify. This adapter is validated on Coolify 4.1.2 / Ubuntu
  24.04; see [Validation status and architecture matrix](#validation-status-and-architecture-matrix)
  for the tested and untested targets.
- Two DNS records pointing at the host, one for each distinct origin you will attach in step 5:
  one for Coda (for example `coda.example.com`) and one for the MinIO S3 API (for example
  `objects.example.com`).
- The matching Coda GitHub release open for reference: you need its Git **tag** and its exact
  `ghcr.io/kinetik-gg/coda@sha256:...` multi-architecture manifest digest.

### 2. Create the application resource

Create one Coolify application from the Coda repository and select the **Docker Compose**
build pack.

- Base directory: `/`
- Docker Compose Location: `/deploy/coolify/compose.full.yaml`
- Source reference: the release **tag** from step 1, not a moving branch.
- Leave **Raw Compose** mode off. `compose.full.yaml` relies on Coolify's documented
  `exclude_from_hc` extension for the one-shot `minio-permissions` and `minio-init` services.

See [Choose one topology](#choose-one-topology) for the app-only alternative.

### 3. Configure environment variables

Paste `deploy/coolify/full.env.example` into Coolify's environment editor and replace every
`replace-with-...` placeholder.

- Generate each secret with a high-entropy generator. `openssl rand -base64 48` is a good
  default. Use a distinct value for `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`,
  `MINIO_ROOT_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `SETUP_TOKEN`.
- Set `CODA_IMAGE` to the exact `ghcr.io/kinetik-gg/coda@sha256:...` manifest digest from the
  same GitHub release whose tag you selected in step 2. A version tag, branch tag, `latest`, or
  a platform-specific child digest is not accepted.
- Keep `POSTGRES_PASSWORD` and the password embedded in `DATABASE_URL` identical, and
  percent-encode any URL-reserved characters in the `DATABASE_URL` copy. `openssl rand -base64`
  output can contain `+`, `/`, and `=`, so either encode it or regenerate a URL-safe value.
- The MinIO root credentials only bootstrap the bucket and service account; they are not passed
  to Coda. Coda receives only the bucket-scoped `S3_ACCESS_KEY` and `S3_SECRET_KEY`.
- Mark every credential, password, and `SETUP_TOKEN` as a sensitive runtime variable and
  disable its **Build Variable** option. Coda consumes a published image, so no value is needed
  at build time.
- Leave `TRUSTED_PROXY_CIDRS=auto`. Coda derives the trust boundary from the private subnets
  Coolify attaches to the container at boot, so no network inspection or second deploy is
  needed. See [Trusted proxy boundary](#trusted-proxy-boundary) to harden it later.

### 4. Deploy

Deploy the resource. Wait for `postgres`, `minio`, and `coda` to report healthy.
`minio-permissions` and `minio-init` are one-shot services that exit successfully and are
excluded from ongoing health aggregation. See [Persistence and health](#persistence-and-health)
for the full expected behavior.

With `TRUSTED_PROXY_CIDRS=auto`, Coda logs the resolved trust set at startup (search the `coda`
container logs for `TrustedProxies`); confirm it lists the resource subnet before exposing the
application publicly.

### 5. Attach the two domains

In the Coolify service list, assign one domain per public service:

| Service | Coolify domain entry               | Matching variable                                |
| ------- | ---------------------------------- | ------------------------------------------------ |
| `coda`  | `https://coda.example.com:3000`    | `APP_ORIGIN=https://coda.example.com`            |
| `minio` | `https://objects.example.com:9000` | `S3_PUBLIC_ENDPOINT=https://objects.example.com` |

The port in a Coolify domain identifies the container target; clients still use normal HTTPS.
Coolify requests and renews certificates when the domain begins with `https://`. Never assign a
domain to `postgres`, `minio-init`, or MinIO port 9001, and do not add host `ports` mappings.
Redeploy, then verify Coda is healthy through the application domain. See
[Domains and HTTPS](#domains-and-https) for detail.

### 6. Complete owner setup

Open `APP_ORIGIN` and immediately complete owner setup using `SETUP_TOKEN`. After
initialization, rotate `SETUP_TOKEN` to a new unused high-entropy value (for example another
`openssl rand -base64 48`) and redeploy. Keep the variable configured.

### 7. Take the first backup

Before real use, capture a coordinated point-in-time backup of both PostgreSQL and the MinIO
bucket by following the **Back up** procedure in the
[deployment and operations guide](operations.md). Coolify's own backup covers the Coolify
control plane, not application volumes. See
[Backup and restore handoff](#backup-and-restore-handoff) for the Coolify-specific caveats.

## Choose one topology

The canonical topology is app-only: Coda with external PostgreSQL and S3. The full stack is the
all-in-one quickstart for evaluation. If you self-host object storage, deploy the standalone
object-storage stack as its own Coolify resource so storage keeps a lifecycle independent of the
application, then point the app-only resource's `S3_*` variables at it (see
[Standalone object storage](#standalone-object-storage)).

| Mode                    | Compose location                     | State ownership                            | Public services       |
| ----------------------- | ------------------------------------ | ------------------------------------------ | --------------------- |
| App only (canonical)    | `/deploy/coolify/compose.app.yaml`   | External PostgreSQL + S3 provider          | Coda only             |
| Full stack (quickstart) | `/deploy/coolify/compose.full.yaml`  | Coolify-managed PostgreSQL + MinIO volumes | Coda and MinIO S3 API |
| Object storage          | `/deploy/coolify/compose.minio.yaml` | Standalone MinIO volume                    | MinIO S3 API          |

Create one Coolify application from the Coda repository and select the **Docker Compose**
build pack. Use `/` as the base directory, select the release tag rather than a moving branch,
and set the Docker Compose Location to exactly one file from the table. Do not enable Raw
Compose mode: `compose.full.yaml` and `compose.minio.yaml` use Coolify's documented
`exclude_from_hc` extension for the one-shot `minio-permissions` and `minio-init` services.

## Standalone object storage

Deploy `/deploy/coolify/compose.minio.yaml` as a Coolify resource separate from the Coda
application so object storage survives application redeploys and can later be replaced by a
managed provider (R2, S3, Spaces). Select the **Docker Compose** build pack, use `/` as the base
directory, and set the Docker Compose Location to `/deploy/coolify/compose.minio.yaml`; do not
enable Raw Compose mode.

Paste `deploy/coolify/minio.env.example` into the environment editor and replace every
placeholder. This resource defines only the object-storage variables and carries no `CODA_IMAGE`,
`DATABASE_URL`, or application variables. Mark every credential as a sensitive runtime variable
and disable its **Build Variable** option. Set `MINIO_CORS_ALLOW_ORIGIN` to the Coda `APP_ORIGIN`.
The MinIO root credentials only bootstrap the bucket and the bucket-scoped service account; they
are not passed to Coda. Assign the public object-storage domain to `minio` port 9000, never to
`minio-init` or MinIO port 9001. In the app-only Coda resource, set `S3_ENDPOINT` to this stack
over the platform network and `S3_PUBLIC_ENDPOINT` to its public object-storage domain, and reuse
the same `S3_BUCKET`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY`. Its `minio-data` volume is scoped to
this resource; do not delete the resource with its persistent volume.

## Pin the release image

Copy the exact `ghcr.io/kinetik-gg/coda@sha256:...` multi-architecture manifest reference
from the matching GitHub release into `CODA_IMAGE`. A version tag, branch tag, `latest`, or a
platform-specific child digest is not accepted. Keep the selected Git release tag and the
image digest from that same release together.

Paste the matching example into Coolify's environment editor:

- Full stack: `deploy/coolify/full.env.example`
- App only: `deploy/coolify/app.env.example`

Replace every `replace-with-...` value. Mark credentials and passwords as
sensitive runtime variables and disable their **Build Variable** option. Coda consumes a
published image, so none of these values is needed while building. Use unique values for the
PostgreSQL password, MinIO root account, bucket-scoped Coda access key, and
managed-provider credentials. `SETUP_TOKEN` is optional and commented out in the template:
leave it unset to have Coda generate a one-time token at first boot and print it to the
container logs, or set an explicit sensitive value (at least 32 characters) to choose the
token yourself. A single-replica Coolify deployment does not need it.

For the full stack, keep `POSTGRES_PASSWORD` synchronized with the password in
`DATABASE_URL`; percent-encode URL-reserved characters in the URL. The MinIO root credentials
bootstrap the bucket and service account but are not passed to Coda. Coda receives only the
bucket-scoped `S3_ACCESS_KEY` and `S3_SECRET_KEY`.

For app-only deployments, provision the database, private bucket, bucket policy, and CORS
policy before deployment. Require certificate verification in the PostgreSQL URL and choose
`S3_FORCE_PATH_STYLE` according to the provider. Do not use an administrative S3 key.

## Domains and HTTPS

Create DNS records for two distinct origins in full-stack mode. Assign domains in the Coolify
service list as follows:

| Service | Coolify domain entry               | Matching variable                                |
| ------- | ---------------------------------- | ------------------------------------------------ |
| `coda`  | `https://coda.example.com:3000`    | `APP_ORIGIN=https://coda.example.com`            |
| `minio` | `https://objects.example.com:9000` | `S3_PUBLIC_ENDPOINT=https://objects.example.com` |

The port in a Coolify domain identifies the container target; clients still use normal HTTPS.
Coolify requests and renews certificates when the domain begins with `https://`. Never assign
a domain to `postgres`, `minio-init`, or MinIO port 9001. Do not add host `ports` mappings.

App-only mode assigns only `https://coda.example.com:3000` to `coda`; the managed object
provider owns `S3_PUBLIC_ENDPOINT` and its TLS certificate. Set the provider's bucket CORS
policy to the exact `APP_ORIGIN`.

### Trusted proxy boundary

Coda honors `X-Forwarded-For` only from peers listed in `TRUSTED_PROXY_CIDRS`, which keeps
per-client throttling accurate instead of trusting spoofed forwarded headers.

The templates ship `TRUSTED_PROXY_CIDRS=auto`. At boot Coda enumerates its own non-loopback
interfaces (IPv4 and IPv6) and trusts exactly the subnets attached to them, then logs the
resolved set (search the `coda` container logs for `TrustedProxies`). On Coolify this is the
dedicated resource network the platform attaches, so client-IP handling is correct after a
single deploy with no network inspection. This is honest about what it trusts: any peer able to
spoof `X-Forwarded-For` from those private subnets already sits inside the deployment network.

For a hardened deployment, pin the value to the exact resource subnet instead. Coolify names the
resource network after its resource UUID; inspect it after the first deployment creates it:

```sh
docker network inspect <coolify-resource-uuid> \
  --format '{{range .IPAM.Config}}{{println .Subnet}}{{end}}'
```

Set `TRUSTED_PROXY_CIDRS` to only that subnet and redeploy. Never combine `auto` with an
explicit list, and never use `0.0.0.0/0`, `::/0`, the host's entire LAN, or an unrelated
Coolify network.

## Persistence and health

Full-stack mode declares `postgres-data` and `minio-data` as named Compose volumes. Coolify
documents that it scopes named volumes with the resource UUID. Do not create duplicate UI
mounts for the same container paths, delete the resource with its persistent volumes, or
rename these volumes during an upgrade.

Expected health behavior:

- `postgres` becomes healthy through `pg_isready`.
- `minio` checks its local live endpoint.
- `minio-init` exits successfully after idempotently provisioning the bucket and service key;
  it is excluded from Coolify's ongoing health aggregation.
- `coda` is ready only when `/api/v1/health/ready` succeeds. Coolify's proxy should route the
  application domain only to this healthy service.

The adapters request a bounded, `noexec`, `nosuid`, and `nodev` tmpfs for `/tmp`. The currently
tested platform release preserved the mount, its `512m` size, mode `1777`, and all three runtime
mount flags in both deployment modes. Recheck the effective container contract after platform
upgrades because Compose normalization is version-sensitive:

```sh
docker inspect <coda-container> --format '{{json .HostConfig.Tmpfs}}'
docker exec <coda-container> grep ' /tmp ' /proc/mounts
```

The first command must retain `size=512m` and `mode=1777`; the second must report `noexec`,
`nosuid`, and `nodev`.

After the first healthy deployment, open `APP_ORIGIN` and immediately complete owner setup.
When you set an explicit `SETUP_TOKEN`, enter that value and rotate or remove it after
initialization. When you left it unset, copy the auto-generated token from the container logs
(the `CODA SETUP TOKEN` banner, reprinted on every restart until setup completes) and enter it
on the setup screen; nothing further is needed once the owner account exists.

## Upgrade

1. Read the Coda release notes and verify a complete application backup.
2. Update the repository reference to the target release tag.
3. Replace `CODA_IMAGE` with the exact manifest digest from that same release.
4. Redeploy and wait for the `coda` healthcheck to pass.
5. Test sign-in, screenplay save/export, breakdown reads and writes, and a signed object
   upload/download before considering the upgrade complete.

Coda runs committed database migrations before startup. Migrations are forward operations;
changing `CODA_IMAGE` back is not a database rollback. Restore a verified pre-upgrade database
and object-store backup when a release-specific rollback requires it.

## Backup and restore handoff

Coolify's own backup covers the Coolify control plane, not application volumes. The official
[Coolify backup documentation](https://coolify.io/docs/knowledge-base/how-to/backup-restore-coolify)
explicitly excludes application data.

- Full stack: back up PostgreSQL and the MinIO bucket/configuration together, plus the exact
  Coda image digest, release tag, environment-variable inventory, timestamp, and checksums.
- App only: use coordinated database and bucket backups from the managed providers and record
  the same Coda release metadata.
- Restore into an isolated Coolify project first, using the image digest that created the
  backup. Verify database readiness, stored-object access, sign-in, and product workflows
  before switching DNS or production traffic.

Follow the repository's [deployment and operations guide](operations.md) for the
application-level backup and restore procedure. Do not treat a Coolify settings backup, Git
checkout, or screenplay export as a complete Coda backup.

## Validation status and architecture matrix

| Target                                      | Status for this adapter                                                                                                                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Compose model, full stack            | Mechanically rendered and compared with canonical `compose.yaml`                                                                                                                                                                                                                       |
| Docker Compose model, app only              | Mechanically rendered and compared with canonical `compose.app.yaml`                                                                                                                                                                                                                   |
| Docker Compose model, standalone storage    | Mechanically rendered and compared with canonical `deploy/minio/compose.yaml`                                                                                                                                                                                                          |
| Coolify on Linux AMD64 (4.1.2/Ubuntu 24.04) | Full-stack and app-only candidate smoke passed for readiness, setup, authentication, signed object transfer, managed redeploy, host reboot, persistence, runtime isolation, and bounded tmpfs. Immutable release-digest, publicly trusted TLS, upgrade, and restore proof remain open. |
| Coolify on Linux ARM64                      | Not live-tested                                                                                                                                                                                                                                                                        |
| Docker Swarm, rootless Docker, Podman       | Not supported by this validation                                                                                                                                                                                                                                                       |
| Non-Linux hosts                             | Not supported                                                                                                                                                                                                                                                                          |

The Coda release workflow publishes one manifest for `linux/amd64` and `linux/arm64`, and
Coolify officially supports AMD64 and ARM64. That establishes intended image availability,
not runtime proof for this adapter. A release must not be described as Coolify-validated until
both modes have passed the public-domain, signed-storage, persistence, upgrade, and restore
checks on a claimed Coolify instance.
