# Generic Docker v0.0.7 qualification evidence

This record captures the sanitized results of the generic Docker qualification run completed on
2026-08-03. It qualifies a fresh Coda v0.0.7 deployment and the supported upgrade lane from the
immediately previous release, v0.0.6, to v0.0.7 against the boundary in
[Deploy with generic Docker](../docker.md). No other release sequence was tested. This record does
not claim compatibility with a particular platform, proxy, infrastructure provider, database
service, or object-storage service.

Hostnames, IP addresses, internal infrastructure identifiers, representative project and
container names, credentials, secrets, and private endpoints are intentionally omitted. The
PostgreSQL and S3-compatible dependencies used in this run were disposable stand-ins that tested
the Coda app-only boundary; they do not expand the support claim to those dependency deployments.

## Artifacts and environment

| Item                            | Recorded value                                                            |
| ------------------------------- | ------------------------------------------------------------------------- |
| Guest OS                        | Ubuntu 24.04.3, AMD64                                                     |
| Docker Engine                   | 29.7.1                                                                    |
| Docker Compose                  | 5.3.1                                                                     |
| Operator utility runtime        | Node.js 22.23.2                                                           |
| v0.0.6 release bundle SHA-256   | `8fbc1fff489d20697b549fbb2b7148aa4add7474068fec8cc2db4b102c74d315`        |
| v0.0.6 application image digest | `sha256:8946269e2419f8dc41236ed8797c904f0da70a49833d6e662f78b7c28a32ed31` |
| v0.0.7 release bundle SHA-256   | `dc4677802bdb84a01cf3e3c8702e1cd0b64e8224cbfb3644cf0c017d00c96caf`        |
| v0.0.7 application image digest | `sha256:61af3915e7933f87f091a10b6f60438f7db9e79084175e304d49255542129182` |

Both release bundle checksums passed, and the validators bundled with the releases completed
successfully before their respective deployments.

## Qualification results

| Check                     | Result                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh install and HTTPS   | Passed. The immutable v0.0.7 image reached readiness through operator-supplied TLS termination using a trusted test certificate authority.                                                                             |
| Owner setup               | Passed. Initial setup returned HTTP 201; reuse of the setup token returned HTTP 409.                                                                                                                                   |
| Signed object round trip  | Passed. Browser CORS behavior succeeded and the downloaded bytes matched SHA-256 `f62d1b92a6821b474581853bd44c2fafb361929ddac7d1038cab733edee466b6`.                                                                   |
| Application restart       | Passed. The application recovered in 6 seconds.                                                                                                                                                                        |
| Full guest reboot         | Passed. SSH returned in 12 seconds, and the application was already healthy at the first post-SSH check.                                                                                                               |
| Signed backup             | Passed. The archive was 131,630 bytes with SHA-256 `90265cb84e5cd80e33d814757029e1ace276a4bd7c525b09b29c2fcd0bc877a9`.                                                                                                 |
| Isolated restore          | Passed against empty database and object-storage volumes. Owner login, representative database content, and the restored object's byte hash were verified.                                                             |
| Upgrade                   | Passed from immutable v0.0.6 to immutable v0.0.7 after creating and verifying a signed pre-upgrade backup. Existing content and the stored object remained valid.                                                      |
| Migration and runtime     | Passed. Upgrade migrations completed, and the application, database, and object-storage runtime audits succeeded on v0.0.7.                                                                                            |
| Rollback restore          | Passed by redeploying the immutable v0.0.6 application with the verified pre-upgrade backup and isolated empty database and object-storage targets. Owner login, representative content, and the object were verified. |
| External network exposure | Passed. Ports 22 and 443 were open; ports 80, 3000, 5432, 9000, 9001, and 9443 were closed.                                                                                                                            |

The fresh-install, restart, reboot, backup, and isolated-restore checks used v0.0.7. Upgrade and
rollback qualification covered exactly v0.0.6 to v0.0.7.

## Resource observations

The application container was measured separately from the disposable dependency stand-ins:

- Idle: 2.99% CPU, 106.2 MiB memory, and 17 processes.
- Backup load: 24 samples with a peak of 5.24% CPU, 107 MiB memory, and 17 processes.
- Host at the recorded sample: 1.0 GiB of 3.8 GiB memory used, no swap in use, and 8.7 GiB of 39
  GiB root-disk space used.

These measurements describe this qualification run; they are not capacity guarantees.
