# Dokploy v0.0.7 qualification evidence

This record captures the sanitized results of the Dokploy qualification run completed on
2026-08-03. It qualifies a fresh Coda v0.0.7 deployment and the upgrade lane from the immediately
previous release, v0.0.6, to v0.0.7 against the boundary in
[Deploy Coda with Dokploy](../dokploy.md). No other release sequence was tested.

Hostnames, IP addresses, internal infrastructure identifiers, project and container names,
credentials, secrets, private endpoints, and raw logs are intentionally omitted. Disposable
PostgreSQL and S3-compatible services exercised Coda's app-only boundary; they do not create a
support claim for those dependency deployments or for a particular infrastructure provider.

## Artifacts and environment

| Item                            | Recorded value                                                            |
| ------------------------------- | ------------------------------------------------------------------------- |
| Dokploy                         | 0.29.13                                                                   |
| Guest OS                        | Ubuntu 24.04.3, AMD64                                                     |
| Docker Engine                   | 29.7.1                                                                    |
| Docker Compose                  | 5.3.1                                                                     |
| Operator utility runtime        | Node.js 22.23.0                                                           |
| v0.0.6 release bundle SHA-256   | `8fbc1fff489d20697b549fbb2b7148aa4add7474068fec8cc2db4b102c74d315`        |
| v0.0.6 application image digest | `sha256:8946269e2419f8dc41236ed8797c904f0da70a49833d6e662f78b7c28a32ed31` |
| v0.0.7 release bundle SHA-256   | `dc4677802bdb84a01cf3e3c8702e1cd0b64e8224cbfb3644cf0c017d00c96caf`        |
| v0.0.7 application image digest | `sha256:61af3915e7933f87f091a10b6f60438f7db9e79084175e304d49255542129182` |

Both release bundle checksums passed. Each application service used the unmodified canonical
`compose.app.yaml` from its matching verified release bundle as a Raw Docker Compose source.

## Qualification results

| Check                       | Result                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh install and HTTPS     | Passed. The immutable v0.0.7 image reached readiness through a Dokploy native Domain using a trusted test certificate authority, with no host-published application port.                                         |
| Owner setup                 | Passed. Initial setup completed once; reuse of the setup token returned HTTP 409.                                                                                                                                 |
| Signed object round trip    | Passed. Browser CORS behavior succeeded and the downloaded bytes matched SHA-256 `a6946076beaeb23e666cc3e268cac0b34c2c281d1497aaf7952609d31043199f`.                                                              |
| Managed lifecycle           | Passed. A managed redeploy completed in 3 seconds and a stop/start cycle completed in 1 second; readiness, login, representative database content, and the object hash were preserved.                            |
| Full guest reboot           | Passed. Guest access returned on a new boot ID within 7 seconds. Dokploy, Coda, HTTPS, login, representative content, and the exact object hash recovered automatically.                                          |
| Signed backup               | Passed. The post-upgrade v0.0.7 archive was 132,090 bytes with SHA-256 `82f5215834195eb6a84b938aa59a5f65dcdec4f67f04b44a16823ba249d92c7c`.                                                                        |
| Isolated restore            | Passed against empty database and object-storage volumes. Owner login, representative database content, CORS, and the restored object's exact byte hash were verified.                                            |
| Upgrade                     | Passed from immutable v0.0.6 to immutable v0.0.7 through Dokploy's Raw Compose and environment update. Existing content and the stored object remained valid.                                                     |
| Pre-upgrade safety backup   | Passed. The signed v0.0.6 archive was 127,896 bytes with SHA-256 `22aa55dbf9ea86ab40a015d576e0599130e93e5d74916ac97fd02a7386c089e5`; Coda also logged its automatic backup before applying one pending migration. |
| Migration and runtime       | Passed. All 28 migrations were applied, including the one pending upgrade migration, and the v0.0.7 runtime retained the canonical hardening contract.                                                            |
| Backup-based rollback proof | Passed by restoring the verified v0.0.6 archive into isolated empty targets under the immutable v0.0.6 image. No older image was pointed at the migrated database.                                                |
| External network exposure   | Passed. Only operator access and the platform's HTTP/HTTPS entry points were open. Ports 3000, 3306, 5432, 6379, 9000, and 9001 were closed.                                                                      |

The fresh-install, managed-lifecycle, reboot, backup, and isolated-restore checks used v0.0.7.
Upgrade and rollback qualification covered exactly v0.0.6 to v0.0.7. Platform control-plane or
volume backups were not treated as substitutes for Coda's signed `.codabk` archive.

## Resource observations

The application container was measured separately from the disposable dependency stand-ins:

- Idle sample: 0.13% CPU, 106.6 MiB memory, and 17 processes.
- During a signed backup: three samples peaked at 0.12% CPU and 81.03 MiB memory, with 17
  processes.
- Host at the recorded sample: 1.8 GiB of 3.8 GiB memory used, 2.0 GiB available, essentially no
  swap in use, and 18 GiB of 39 GiB root-disk space used.

These measurements describe this qualification run; they are not capacity guarantees.
