# Portainer v0.0.7 qualification evidence

This record captures the sanitized results of the Portainer Docker Standalone qualification run
completed on 2026-08-03. It qualifies a fresh Coda v0.0.7 deployment and the upgrade lane from
the immediately previous release, v0.0.6, to v0.0.7 against the boundary in
[Deploy Coda with Portainer](../portainer.md). No other release sequence was tested.

Hostnames, IP addresses, internal infrastructure identifiers, stack and container names,
credentials, secrets, private endpoints, and raw logs are intentionally omitted. Disposable
PostgreSQL, S3-compatible storage, and HTTPS services exercised Coda's app-only boundary; they do
not create a support claim for those dependency deployments or for a particular infrastructure
provider or proxy.

## Artifacts and environment

| Item                            | Recorded value                                                            |
| ------------------------------- | ------------------------------------------------------------------------- |
| Portainer Community Edition     | 2.44.0                                                                    |
| Portainer image digest          | `sha256:f49255cd9378827fadfde46062ad0395050237c51d03a93a3dc1dbc6050dda3e` |
| Guest OS                        | Ubuntu 24.04.3, AMD64                                                     |
| Docker Engine                   | 29.7.1                                                                    |
| Docker Compose                  | 5.3.1                                                                     |
| Operator utility runtime        | Node.js 22.23.0                                                           |
| v0.0.6 release bundle SHA-256   | `8fbc1fff489d20697b549fbb2b7148aa4add7474068fec8cc2db4b102c74d315`        |
| v0.0.6 application image digest | `sha256:8946269e2419f8dc41236ed8797c904f0da70a49833d6e662f78b7c28a32ed31` |
| v0.0.7 release bundle SHA-256   | `dc4677802bdb84a01cf3e3c8702e1cd0b64e8224cbfb3644cf0c017d00c96caf`        |
| v0.0.7 application image digest | `sha256:61af3915e7933f87f091a10b6f60438f7db9e79084175e304d49255542129182` |

Both release bundle checksums passed. Each Portainer Stack used the exact, unmodified canonical
`compose.app.yaml` from its matching verified release bundle through the Web editor. No
Portainer-specific Compose file or application template was used.

## Qualification results

| Check                       | Result                                                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh install and HTTPS     | Passed. The immutable v0.0.7 image reached readiness through operator-provided HTTPS attached to the Stack's private network, with no host-published application port.                                                             |
| Owner setup                 | Passed. Initial setup completed once; reuse of the setup token returned HTTP 409.                                                                                                                                                  |
| Signed object round trip    | Passed. Browser CORS behavior succeeded and the downloaded bytes matched SHA-256 `a6946076beaeb23e666cc3e268cac0b34c2c281d1497aaf7952609d31043199f`.                                                                               |
| Portainer lifecycle         | Passed. Stack stop/start recovered in 5 seconds. Portainer Update stack preserved the canonical source, readiness, login, representative database content, and object hash.                                                        |
| Full host reboot            | Passed. Host access returned on a new boot ID within 3 seconds; Portainer, the upgraded Coda Stack, operator HTTPS, login, representative content, and the object hash recovered automatically within 70 seconds.                  |
| Signed backup               | Passed. The fresh v0.0.7 archive was 131,810 bytes with SHA-256 `6246ef1180cdc222d0ef263bf727cebf14d47a8d16ea2ea42f35faafaa97e33e`.                                                                                                |
| Isolated restore            | Passed against empty database and object-storage volumes. Owner login, representative database content, browser CORS, and the restored object's exact byte hash were verified.                                                     |
| Upgrade                     | Passed. Portainer Update stack recreated the application from immutable v0.0.6 to immutable v0.0.7 in 8 seconds using matched release sources while preserving representative content and the stored object.                       |
| Pre-upgrade safety backup   | Passed. The signed v0.0.6 archive was 127,913 bytes with SHA-256 `061bbf42865a079254b8a1fc114faccb820fe412d236f54cd307b3f61bd55624`; Coda also created its automatic backup before applying one pending migration.                 |
| Migration and runtime       | Passed. The pending migration completed successfully, and the effective v0.0.7 container retained the canonical read-only root, bounded `/tmp`, dropped capabilities, no-new-privileges, memory/PID limits, and no published port. |
| Backup-based rollback proof | Passed by restoring the verified v0.0.6 archive into isolated empty targets under the immutable v0.0.6 image. No older image was pointed at the migrated database.                                                                 |
| External network exposure   | Passed. Only operator access and HTTPS were reachable. Ports 80, 3000, 3306, 5432, 6379, 8000, 9000, 9001, and 9443 were closed.                                                                                                   |

The fresh-install, managed-lifecycle, backup, and isolated-restore checks used v0.0.7. Upgrade
and rollback qualification covered exactly v0.0.6 to v0.0.7. Portainer configuration, Stack
history, and volume backups were not treated as substitutes for Coda's signed `.codabk` archive.

## Resource observations

The application container was measured separately from Portainer and the disposable dependency
stand-ins:

- Idle application sample: 0.13% CPU, 107.3 MiB memory, and 17 processes.
- During a signed backup: three samples peaked at 17.9% CPU and 107.3 MiB memory, with 17
  processes.
- Portainer idle sample: 0.00% CPU, 21 MiB memory, and 8 processes.
- Host at the recorded sample: 1.0 GiB of 3.8 GiB memory used, 2.8 GiB available, no swap in use,
  and 18 GiB of 39 GiB root-disk space used.

These measurements describe this qualification run; they are not capacity guarantees.
