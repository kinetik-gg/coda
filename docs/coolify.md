# Deploy Coda with Coolify

This adapter deploys the same immutable Coda image and service boundaries as the canonical
Compose files. It does not build a second image and does not publish database, object-store
administration, or application ports directly on the host.

Coolify documents Docker Compose as the source of truth for service configuration, exposes
non-default container ports by adding the port to the service domain, detects `${VAR}`
references as editable environment variables, and uses Compose healthchecks for service
routing. See the official [Docker Compose](https://coolify.io/docs/knowledge-base/docker/compose),
[domains](https://coolify.io/docs/knowledge-base/domains),
[environment variables](https://coolify.io/docs/knowledge-base/environment-variables), and
[health checks](https://coolify.io/docs/knowledge-base/health-checks) documentation.

## Choose one topology

| Mode       | Compose location                    | State ownership                            | Public services       |
| ---------- | ----------------------------------- | ------------------------------------------ | --------------------- |
| Full stack | `/deploy/coolify/compose.full.yaml` | Coolify-managed PostgreSQL + MinIO volumes | Coda and MinIO S3 API |
| App only   | `/deploy/coolify/compose.app.yaml`  | External PostgreSQL + S3 provider          | Coda only             |

Create one Coolify application from the Coda repository and select the **Docker Compose**
build pack. Use `/` as the base directory, select the release tag rather than a moving branch,
and set the Docker Compose Location to exactly one file from the table. Do not enable Raw
Compose mode: `compose.full.yaml` uses Coolify's documented `exclude_from_hc` extension for
the successful one-shot `minio-init` service.

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

After configuring the trusted-proxy boundary below, create DNS records for two distinct
origins in full-stack mode. Assign domains in the Coolify service list as follows:

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

The examples start with `TRUSTED_PROXY_CIDRS=127.0.0.1/32`, so Coda intentionally ignores
forwarded client addresses during bootstrap. Deploy without a public domain or DNS record,
then replace that value with the dedicated Coolify resource network subnet that supplies
proxy traffic to Coda. Coolify names the resource network after its resource UUID; inspect the
destination after the first deployment creates the network:

```sh
docker network inspect <coolify-resource-uuid> \
  --format '{{range .IPAM.Config}}{{println .Subnet}}{{end}}'
```

Use only the subnet attached to this Coda resource. Do not use `0.0.0.0/0`, `::/0`, the host's
entire LAN, or an unrelated Coolify network. Redeploy after changing the value, then add the
public domains and DNS records and verify that Coda is healthy through the application domain.

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

Follow the repository's deployment and operations guide for the application-level backup and
restore procedure. Do not treat a Coolify settings backup, Git checkout, or screenplay export
as a complete Coda backup.

## Validation status and architecture matrix

| Target                                      | Status for this adapter                                                                                                                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Compose model, full stack            | Mechanically rendered and compared with canonical `compose.yaml`                                                                                                                                                                                                                       |
| Docker Compose model, app only              | Mechanically rendered and compared with canonical `compose.app.yaml`                                                                                                                                                                                                                   |
| Coolify on Linux AMD64 (4.1.2/Ubuntu 24.04) | Full-stack and app-only candidate smoke passed for readiness, setup, authentication, signed object transfer, managed redeploy, host reboot, persistence, runtime isolation, and bounded tmpfs. Immutable release-digest, publicly trusted TLS, upgrade, and restore proof remain open. |
| Coolify on Linux ARM64                      | Not live-tested                                                                                                                                                                                                                                                                        |
| Docker Swarm, rootless Docker, Podman       | Not supported by this validation                                                                                                                                                                                                                                                       |
| Non-Linux hosts                             | Not supported                                                                                                                                                                                                                                                                          |

The Coda release workflow publishes one manifest for `linux/amd64` and `linux/arm64`, and
Coolify officially supports AMD64 and ARM64. That establishes intended image availability,
not runtime proof for this adapter. A release must not be described as Coolify-validated until
both modes have passed the public-domain, signed-storage, persistence, upgrade, and restore
checks on a claimed Coolify instance.
