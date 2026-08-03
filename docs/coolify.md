# Run Coda on Coolify

Coda can run on Coolify. This is a compatibility statement, not a qualified support claim. The
repository includes manual Coolify Compose and environment adapters, but it does not provide or
claim an automated installer. For the current qualification boundary, see the
[deployment support matrix](deployment-support.md).

The adapters use the same immutable Coda image and service boundaries as the canonical Compose
files. They do not build a platform-specific image or publish the application, database, or object
storage administration ports directly on the host.

Coolify's behavior can change independently of Coda. Review its official
[Docker Compose](https://coolify.io/docs/knowledge-base/docker/compose),
[domains](https://coolify.io/docs/knowledge-base/domains),
[environment variables](https://coolify.io/docs/knowledge-base/environment-variables), and
[health checks](https://coolify.io/docs/knowledge-base/health-checks) documentation before
deploying or upgrading.

## Choose a topology

The app-only topology is the canonical production boundary. It runs Coda against PostgreSQL and
S3-compatible storage that you manage separately. The bundled full stack is an evaluation option,
not part of the qualified deployment support boundary.

| Mode                 | Compose location                     | Environment example                | State ownership                            |
| -------------------- | ------------------------------------ | ---------------------------------- | ------------------------------------------ |
| App only (canonical) | `/deploy/coolify/compose.app.yaml`   | `deploy/coolify/app.env.example`   | External PostgreSQL and S3                 |
| Full stack           | `/deploy/coolify/compose.full.yaml`  | `deploy/coolify/full.env.example`  | Coolify-managed PostgreSQL and MinIO       |
| Object storage       | `/deploy/coolify/compose.minio.yaml` | `deploy/coolify/minio.env.example` | Standalone MinIO managed as a separate app |

If you self-host object storage, keep it in a separate Coolify application so its lifecycle is
independent from the Coda application. The app-only resource can then use its S3 API in the same
way it would use a managed provider.

## Configure the application

1. Download and verify the matching Coda release bundle, or select the matching release tag in a
   source checkout. Do not deploy from a moving branch.
2. Create a Coolify application using the **Docker Compose** build pack, `/` as the base directory,
   and one Compose location from the table above.
3. Paste the matching environment example into Coolify's environment editor and replace every
   `replace-with-...` placeholder. Keep credentials as sensitive runtime variables and disable
   their **Build Variable** option.
4. Set `CODA_IMAGE` to the exact
   `ghcr.io/kinetik-gg/coda@sha256:...` multi-architecture manifest reference published by the
   same release. Do not use `latest`, a branch tag, or a platform-specific child digest.
5. Deploy and wait for the `coda` readiness check to pass before routing traffic.

For app-only mode, provision the database, private bucket, bucket policy, and CORS policy first.
Require certificate verification in `DATABASE_URL`, use a bucket-scoped S3 credential rather than
an administrative key, and set `S3_FORCE_PATH_STYLE` for the selected provider.

For the full stack, keep `POSTGRES_PASSWORD` synchronized with the password embedded in
`DATABASE_URL`, percent-encoding URL-reserved characters in the URL. MinIO root credentials are
used only to provision the bucket and bucket-scoped Coda service account; never pass them to Coda.

## Domains and HTTPS

Assign an HTTPS domain to the `coda` service's container port 3000 and set `APP_ORIGIN` to that
browser-visible origin without the port. App-only mode leaves the managed object provider in
control of `S3_PUBLIC_ENDPOINT` and its TLS certificate.

Full-stack or standalone-storage mode also needs a distinct HTTPS origin for the MinIO S3 API:

| Service | Coolify domain entry               | Matching variable                                |
| ------- | ---------------------------------- | ------------------------------------------------ |
| `coda`  | `https://coda.example.com:3000`    | `APP_ORIGIN=https://coda.example.com`            |
| `minio` | `https://objects.example.com:9000` | `S3_PUBLIC_ENDPOINT=https://objects.example.com` |

Never assign a domain to PostgreSQL, a one-shot initialization service, or MinIO port 9001. Do not
add host `ports` mappings. Set the bucket CORS policy to the exact `APP_ORIGIN`.

### Trusted proxy boundary

Coda honors forwarded client addresses only from `TRUSTED_PROXY_CIDRS`. The environment examples
use `auto`, which resolves the private subnets attached to the application container and logs the
result at startup. Confirm that the resolved set contains only the expected application network.

For a tighter boundary, inspect the application network after the initial deployment, replace
`auto` with only that subnet, and redeploy. Never use `0.0.0.0/0`, `::/0`, the host's entire LAN,
or an unrelated application network.

## Owner setup and persistence

After the application becomes healthy, open `APP_ORIGIN` and complete owner setup. Either set a
sensitive `SETUP_TOKEN` of at least 32 characters before deployment or leave it unset and retrieve
the generated one-time token from the application logs. Rotate or remove an explicit token after
setup.

The full-stack adapter declares `postgres-data` and `minio-data` named volumes. Do not duplicate
their mounts in the UI, rename them during an upgrade, or delete the application together with its
persistent volumes. The app-only topology keeps those stateful services outside the Coda
application lifecycle.

Take a signed Coda backup before real use. A Coolify control-plane backup is not an application
backup and does not replace coordinated PostgreSQL and object-storage recovery. Follow
[Deployment and operations](operations.md#back-up) for backup and isolated restore verification.

## Upgrade and redeploy

The manual upgrade path is:

1. Read the Coda release notes and verify a complete signed backup.
2. Select the target release tag and replace `CODA_IMAGE` with that release's exact manifest
   digest.
3. Redeploy and wait for the readiness check.
4. Verify sign-in, representative database reads and writes, and a signed object upload and
   download.

Coda applies committed database migrations during startup. Replacing `CODA_IMAGE` with an older
image is not a rollback after a newer release has migrated the database; restore the matching
pre-upgrade backup into an isolated target instead.

Coda also has an optional API-assisted Coolify redeploy path in **Settings → Updates**. Store the
Coolify API base URL, application UUID, and write-only API token in the upgrade ceremony settings.
After the mandatory backup gate, Coda updates `CODA_IMAGE` to the selected digest and requests a
redeploy through Coolify's API. If that request fails, the ceremony preserves the backup and falls
back to showing the digest for a manual redeploy. See
[Update checker and upgrade ceremony](operations.md#update-checker-and-upgrade-ceremony).

This API integration automates a redeploy request only. It does not install Coda, configure the
initial application, or expand the Coolify compatibility statement into a qualified support
claim.

## Compatibility boundary

The repository mechanically compares the Coolify Compose adapters with their canonical Compose
models and checks their environment, image, exposure, and hardening contracts. Those static checks
do not prove a complete platform lifecycle.

Accordingly, the public claim remains exactly: **Coda can run on Coolify.** Generic Docker,
Dokploy, and Portainer Docker Standalone have separate v0.0.7 lifecycle qualification records in
the [deployment support matrix](deployment-support.md); Coolify does not.
