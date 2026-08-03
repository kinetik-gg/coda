# Deploy Coda with Portainer

This guide covers Coda on Portainer using a **Stack** created in the **Web editor**. Paste the
canonical app-only Compose file from a verified Coda release bundle; there is no Portainer-specific
Compose file, template, or one-click installer.

For the complete Coda environment contract and recovery procedures, see
[Deployment and operations](operations.md).

## Support boundary

The qualified path is:

- Portainer CE 2.44.0;
- a local Docker Standalone environment connected through its socket;
- a Stack created with the Web editor;
- the complete, unmodified [`compose.app.yaml`](../compose.app.yaml) from the matching verified
  Coda release bundle;
- one immutable Coda image reference in `CODA_IMAGE` using `name@sha256:...`;
- Portainer's Stack environment-variable interpolation and update lifecycle; and
- operator-owned PostgreSQL, S3-compatible object storage, HTTPS proxy, encryption keys, and
  backup policy.

Qualification covers a fresh Coda v0.0.7 deployment and an upgrade from v0.0.6 to v0.0.7 with a
verified backup-based rollback. It does not imply support for Swarm, Kubernetes, Podman, Edge
environments, the Portainer agent, remote API environments, GitOps, webhooks, application
templates, one-click installation, or a particular proxy, database, object-storage, or
infrastructure provider.

Portainer does not become the owner of Coda's database, stored objects, encryption key, or backup
policy merely because it runs the application container. Protect and back up those resources
independently of the Stack lifecycle.

## Prepare the release

Download the Coda deployment archive and checksum for the version being deployed, verify their
GitHub attestations and checksum, then extract the archive. The generic Docker guide contains the
exact [release verification commands](docker.md#install-from-a-release-bundle).

Keep these three values matched to one release:

1. the release tag;
2. the extracted `compose.app.yaml`; and
3. the immutable `CODA_IMAGE` digest provided with that release.

Do not use a moving branch, `latest` tag, mutable version tag, source-checkout Compose file, or
Portainer application template for this path.

## Create the Stack

1. Select the local Docker Standalone environment in Portainer.
2. Open **Stacks**, add a Stack, choose the **Web editor**, and paste the complete, unmodified
   `compose.app.yaml` from the verified release bundle.
3. Copy the variables from
   [`deploy/portainer/app.env.example`](../deploy/portainer/app.env.example) into the Stack's
   environment-variable editor. Replace every placeholder and keep `CODA_IMAGE` matched to the
   release bundle. Portainer interpolates these values into the canonical Compose model.
4. Provision the external PostgreSQL database and private object-storage bucket before deployment.
   Require certificate verification in `DATABASE_URL`, use bucket-scoped storage credentials, and
   configure the bucket's browser CORS policy for the exact `APP_ORIGIN`.
5. Review the effective Stack configuration, then deploy it. Confirm the resulting container uses
   the release-pinned image and retains the canonical healthcheck and runtime restrictions.

The canonical topology publishes no host port. It exposes container port 3000 only to its private
Stack network and keeps the application stateless; PostgreSQL and object storage are not part of
this Stack.

## Configure HTTPS

Connect the operator-managed HTTPS proxy to the Stack's private network and route the public Coda
origin to `coda:3000`. Do not add a host `ports` mapping to the Coda service. Set `APP_ORIGIN` to the
exact public HTTPS origin and restrict `TRUSTED_PROXY_CIDRS` to the proxy's source addresses when
they are stable.

Portainer management TLS is separate from Coda's application origin. Securing the Portainer UI
does not configure `APP_ORIGIN`, attach the application proxy, or provide a certificate for Coda.

Wait for `GET /api/v1/health/ready` through `APP_ORIGIN` to succeed, then finish the one-time owner
setup. If `SETUP_TOKEN` was left unset, obtain the generated token from the Coda container logs; if
it was set explicitly, rotate or remove it after setup.

## Upgrade from v0.0.6 to v0.0.7

1. Verify the v0.0.6 release archive, paste its `compose.app.yaml` into the Stack Web editor, and
   deploy its immutable image digest with representative database content and a stored object.
2. Preserve `CONFIG_ENCRYPTION_KEY`, export a signed `.codabk` backup, verify its checksum, and keep
   it outside the Stack lifecycle.
3. Verify the v0.0.7 archive. In **Update the stack**, replace the Web editor content with that
   bundle's complete `compose.app.yaml` and change only `CODA_IMAGE` to its matching immutable
   digest.
4. Deploy the update. An image pull remains deterministic because `CODA_IMAGE` identifies an exact
   manifest digest. Wait for readiness, then verify owner login, representative database content,
   and the stored object.
5. Confirm the automatic pre-upgrade backup completed unless the operator deliberately opted out
   with `PRE_UPGRADE_BACKUP=off`.

Coda applies forward database migrations. Never implement rollback by pointing the v0.0.6 image
at a database already migrated by v0.0.7.

## Backup and isolated rollback

Exercise rollback without disturbing the upgraded Stack:

1. Create isolated, empty PostgreSQL and object-storage targets.
2. Create a separate Portainer Stack through the Web editor using the verified v0.0.6
   `compose.app.yaml`, its immutable image, the source instance's `CONFIG_ENCRYPTION_KEY`, and the
   isolated targets.
3. Restore the verified pre-upgrade `.codabk` archive through first-run setup.
4. Confirm owner login, representative database content, and exact stored-object retrieval.
5. Remove the isolated recovery Stack and targets only after recording sanitized proof.

The rollback check validates Coda's signed application backup. Portainer's Stack metadata or
container-volume backups do not replace `.codabk`, nor do they replace the operator's independent
provider backups and restore testing.

## Qualification checklist

Record the Portainer and Docker versions, both Coda versions, bundle checksums, immutable image
digests, and sanitized pass/fail results. Never publish environment files, credentials, tokens,
private endpoints, or raw logs.

- **Fresh install:** v0.0.7 reaches readiness from the verified Web editor source.
- **HTTPS and setup:** `APP_ORIGIN` is served over valid HTTPS, owner setup succeeds once, and the
  token cannot be reused.
- **Storage:** a browser-style signed upload and download round trip returns the exact object.
- **Stack lifecycle:** Coda survives a Portainer Stack update, container restart, and host reboot
  with login, database content, and object access intact.
- **Upgrade:** v0.0.6 upgrades to v0.0.7 through matched bundles and immutable digests while
  preserving representative content.
- **Rollback:** the verified pre-upgrade archive restores into isolated empty targets under
  v0.0.6; no older image touches the migrated database.
- **Runtime contract:** the effective container retains the canonical read-only root filesystem,
  bounded `/tmp`, dropped capabilities, no-new-privileges, healthcheck, memory limit, and process
  limit.
- **Exposure and resources:** only intended operator access and HTTPS entry points are reachable;
  database, object storage, and port 3000 remain private. Record idle and exercised CPU, memory,
  process count, and disk use.

A successful checklist establishes only the support boundary above.

The latest sanitized run is recorded in the
[v0.0.7 Portainer qualification evidence](https://github.com/kinetik-gg/coda/blob/main/docs/validation/portainer-v0.0.7.md).
