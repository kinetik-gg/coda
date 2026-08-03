# Deployment support matrix

Coda's deployment scope is deliberately narrow. A path is **qualified and supported** only when a
released Coda version and the upgrade from its immediately previous release have passed fresh
install, HTTPS access, owner setup, persistence, restart, upgrade, signed backup, isolated restore,
and backup-based rollback checks within the documented boundary.

Image availability, a renderable Compose model, or a successful smoke test alone does not establish
support. Each qualification record below omits private environment details while preserving the
versions, immutable artifacts, lifecycle results, and measured support boundary needed for review.

## Current matrix

| Deployment path             | Status                       | Qualified platform and release boundary                                          | Evidence                                                    |
| --------------------------- | ---------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Generic Docker              | Qualified and supported      | Ubuntu 24.04.3 AMD64; Docker Engine 29.7.1; Compose 5.3.1; Coda v0.0.6 → v0.0.7  | [v0.0.7 qualification](validation/generic-docker-v0.0.7.md) |
| Dokploy                     | Qualified and supported      | Dokploy 0.29.13 on Ubuntu 24.04.3 AMD64; Docker 29.7.1; Coda v0.0.6 → v0.0.7     | [v0.0.7 qualification](validation/dokploy-v0.0.7.md)        |
| Portainer Docker Standalone | Qualified and supported      | Portainer CE 2.44.0 on Ubuntu 24.04.3 AMD64; Docker 29.7.1; Coda v0.0.6 → v0.0.7 | [v0.0.7 qualification](validation/portainer-v0.0.7.md)      |
| Coolify                     | Compatibility statement only | No version-qualified support boundary; Coda can run on Coolify                   | [Manual compatibility guide](coolify.md)                    |

The generic Docker claim is provider-neutral. It does not imply support for a particular hosting
provider, reverse proxy, PostgreSQL service, or S3-compatible provider. Dokploy and Portainer are
qualified only within the exact paths documented by their guides. Coolify is not a qualified
installation or lifecycle-support claim.

## Canceled and unsupported targets

The following targets are outside the current product scope and have no planned follow-up work:

- TrueNAS SCALE and CasaOS;
- native ARM64 platform qualification;
- DigitalOcean Droplets and App Platform;
- Synology, Unraid, and Umbrel;
- rootless Podman and Quadlet;
- Kubernetes and Helm;
- separate generic Traefik or Caddy recipes; and
- external application-catalog submissions.

Do not infer support for these targets from container-image availability, Compose compatibility,
emulation, or community deployment reports. Adding another path requires a new explicit product
decision and its own bounded lifecycle qualification.
