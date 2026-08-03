# Deploy Coda with Dokploy

This guide covers Coda on Dokploy using the platform's native **Docker Compose** service with a
**Raw** source. Paste the canonical app-only Compose file from a verified Coda release bundle;
there is no Dokploy-specific Compose fork, template, or one-click installer.

For the complete Coda environment contract and recovery procedures, see
[Deployment and operations](operations.md). For Dokploy's platform behavior, see its official
[Docker Compose](https://docs.dokploy.com/docs/core/docker-compose),
[Raw provider](https://docs.dokploy.com/docs/core/providers#raw-docker-compose), and
[domain](https://docs.dokploy.com/docs/core/docker-compose/domains) documentation.

## Support boundary

The qualified path is:

- Dokploy v0.29.13 on Ubuntu 24.04 AMD64;
- a Dokploy Compose service using **Docker Compose** mode and a **Raw** source;
- the unmodified canonical [`compose.app.yaml`](../compose.app.yaml) from the matching verified
  Coda release bundle;
- an immutable Coda image reference in `CODA_IMAGE` using `name@sha256:...`;
- Dokploy's runtime environment editor, native Domains/HTTPS, service monitoring, logs, and
  Compose deployment lifecycle; and
- operator-owned PostgreSQL and S3-compatible object storage with lifecycles independent of the
  Coda Compose service.

Qualification covers a fresh Coda v0.0.7 deployment and an upgrade from v0.0.6 to v0.0.7 with a
verified backup-based rollback. It does not imply support for Dokploy templates, Docker Stack,
another host architecture or operating system, a particular infrastructure provider, or any
named database, object-storage, or proxy product.

Dokploy does not become the owner of Coda's database, stored objects, encryption key, or backup
policy merely because it runs the application container. Store and protect all runtime values
according to your own access-control and recovery policy. Platform-level persistence or secret
backup is not claimed by this guide.

## Prepare the release

Download the Coda deployment archive and checksum for the version being deployed, verify their
GitHub attestations and checksum, then extract the archive. The generic Docker guide contains the
exact [release verification commands](docker.md#install-from-a-release-bundle).

Keep these three artifacts matched to one release:

1. the release tag;
2. the extracted `compose.app.yaml`; and
3. the immutable `CODA_IMAGE` digest injected into that bundle's environment example.

Do not use a moving branch, `latest` tag, mutable version tag, or source-checkout Compose file for
this path.

## Create the Compose service

1. In Dokploy, create a project and environment, then add a **Compose** service.
2. Select **Docker Compose**, choose **Raw** as the source, and paste the complete, unmodified
   `compose.app.yaml` from the verified release bundle into the Compose editor.
3. Leave the custom deployment command empty so Dokploy owns the normal Compose deploy, stop,
   redeploy, log, and monitoring lifecycle.
4. Copy [`deploy/dokploy/app.env.example`](../deploy/dokploy/app.env.example) into the service's
   **Environment** editor. Replace every placeholder and keep `CODA_IMAGE` matched to the release
   bundle. The canonical Compose file explicitly references the variables Coda consumes; there is
   no need to add `env_file` or duplicate its `environment` mapping.
5. Provision the external PostgreSQL database, private object-storage bucket, bucket policy, and
   browser CORS policy before deployment. Require certificate verification in `DATABASE_URL`, use
   bucket-scoped storage credentials, and set `S3_FORCE_PATH_STYLE` for the selected service.

The canonical topology publishes no host ports. It exposes container port 3000 only for the
platform ingress and keeps the application stateless; PostgreSQL and object storage are not part
of this Compose service.

## Configure the domain and deploy

In the Compose service's **Domains** tab, add the HTTPS origin used by `APP_ORIGIN`:

- service: `coda`;
- container port: `3000`;
- host: the exact hostname in `APP_ORIGIN`; and
- HTTPS: enabled with a valid certificate.

Use Dokploy's Compose preview before deploying. Confirm the effective model still uses the
release-pinned image, exposes only container port 3000, retains the healthcheck and runtime
limits, and adds no host `ports` mapping. Domain changes to a Compose service take effect after a
redeploy.

Deploy from the platform UI and watch the deployment record, service logs, health state, and
resource monitor. Wait for `GET /api/v1/health/ready` through `APP_ORIGIN` to succeed, then finish
the one-time owner setup. If `SETUP_TOKEN` was left unset, obtain the generated token from the Coda
service logs; if it was set explicitly, rotate or remove it after setup.

## Upgrade from v0.0.6 to v0.0.7

1. Verify the v0.0.6 release archive, paste its `compose.app.yaml`, and deploy its immutable image
   digest with representative database content and a stored object.
2. Set and preserve `CONFIG_ENCRYPTION_KEY`, export a signed `.codabk` backup, verify its checksum,
   and keep it outside the Compose service lifecycle.
3. Verify the v0.0.7 archive. Replace the Raw source with that bundle's `compose.app.yaml`, update
   `CODA_IMAGE` to its matching immutable digest, and redeploy.
4. Wait for readiness, then verify owner login, representative database content, signed object
   upload/download, logs, and service monitoring.
5. Confirm the automatic pre-upgrade backup completed unless the operator deliberately opted out
   with `PRE_UPGRADE_BACKUP=off`.

Coda applies forward database migrations. Never implement rollback by pointing the v0.0.6 image
at a database already migrated by v0.0.7.

## Backup and rollback proof

Exercise recovery without disturbing the upgraded deployment:

1. Create isolated, empty PostgreSQL and object-storage targets.
2. Create a separate Dokploy Compose service from the verified v0.0.6 bundle and immutable image,
   using the source instance's `CONFIG_ENCRYPTION_KEY` and the isolated targets.
3. Restore the verified pre-upgrade `.codabk` archive through first-run setup.
4. Confirm owner login, representative database content, and exact stored-object retrieval.
5. Remove the isolated recovery service and targets only after recording sanitized proof.

The rollback check validates Coda's signed application backup. The operator remains responsible
for independent provider backups, retention, and restore testing for PostgreSQL and object
storage.

## Qualification checklist

Record the Dokploy and host versions, both Coda versions, bundle checksums, immutable image
digests, and sanitized pass/fail results. Never publish environment files, credentials, tokens,
private endpoints, or raw logs.

- **Fresh install:** v0.0.7 reaches readiness from the verified Raw Compose source.
- **HTTPS and setup:** `APP_ORIGIN` is served over valid HTTPS, owner setup succeeds once, and the
  token cannot be reused.
- **Storage:** a browser-style signed upload and download round trip returns the exact object.
- **Platform lifecycle:** Coda survives a Dokploy redeploy and host reboot with login, database
  content, and object access intact.
- **Upgrade:** v0.0.6 upgrades to v0.0.7 through matched bundles and immutable digests while
  preserving representative content.
- **Rollback:** the verified pre-upgrade archive restores into isolated empty targets under
  v0.0.6; no older image touches the migrated database.
- **Runtime contract:** the effective container retains the canonical read-only root filesystem,
  bounded `/tmp`, dropped capabilities, no-new-privileges, healthcheck, memory limit, and process
  limit.
- **Exposure and resources:** only intended operator access and HTTPS entry points are reachable;
  database, object storage, and port 3000 remain private. Record idle and exercised CPU, memory,
  process count, and disk use from the platform monitor.

A successful checklist establishes only the support boundary above.
