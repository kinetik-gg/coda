# Security policy

## Supported versions

Security fixes are provided for the latest published version.

| Version             | Supported |
| ------------------- | --------- |
| Current main branch | Yes       |
| Latest release      | Yes       |
| Older releases      | No        |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature on this repository. Do not open a
public issue or include sensitive data, access credentials, or exploit details in public channels.

Include the affected version, impact, reproduction steps, and any suggested mitigation. Reports
will be acknowledged within seven days. Valid reports are coordinated privately until a fix and
advisory are ready.

## Deployment responsibility

Operators should use unique database, object-storage, and application credentials; terminate TLS
at a trusted reverse proxy; restrict network access to backing services; and keep the deployment
and host operating system patched.
