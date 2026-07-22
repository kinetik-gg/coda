#!/bin/sh
set -eu

node apps/api/node_modules/prisma/build/index.js migrate deploy \
  --schema apps/api/prisma/schema.prisma
exec node apps/api/dist/main.js
