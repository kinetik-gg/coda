#!/bin/sh
set -eu

# Migrations used to run here, before the application ever started, so an unreachable database
# crashed the container before it could report anything more useful than a shell exit code. The
# application now probes the database itself at boot, serves a diagnostic page with retry/backoff
# while it is unavailable, and only runs `prisma migrate deploy` once that probe succeeds (see
# apps/api/src/boot). Keep this entrypoint a thin process launcher.
exec node apps/api/dist/main.js
