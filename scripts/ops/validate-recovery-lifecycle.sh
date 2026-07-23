#!/bin/sh
set -eu

old_image='ghcr.io/kinetik-gg/coda@sha256:3d214731054bb103b6ecbc65ccec8c43217caa211c0146c1e40bce6c66bc8cf0'
candidate_image=${CODA_RECOVERY_CANDIDATE_IMAGE:?Set CODA_RECOVERY_CANDIDATE_IMAGE to an immutable local or registry reference}
run_id=${CODA_RECOVERY_RUN_ID:-local-$(date -u +%Y%m%d%H%M%S)}
source_app_port=${CODA_RECOVERY_SOURCE_APP_PORT:-53016}
source_s3_port=${CODA_RECOVERY_SOURCE_S3_PORT:-59016}
case "$run_id" in
  *[!a-zA-Z0-9-]*) echo 'CODA_RECOVERY_RUN_ID may contain only letters, digits, and hyphens' >&2; exit 1 ;;
esac

source_project="coda-recovery-source-$(printf '%s' "$run_id" | tr 'A-Z' 'a-z')"
target_project="coda-recovery-target-$(printf '%s' "$run_id" | tr 'A-Z' 'a-z')"
app_project="coda-recovery-app-$(printf '%s' "$run_id" | tr 'A-Z' 'a-z')"
evidence_root=${CODA_RECOVERY_EVIDENCE_ROOT:-artifacts}
evidence_parent="$evidence_root/recovery-$run_id"
backup_directory="$evidence_parent/backup"
environment_directory=$(mktemp -d "${TMPDIR:-/tmp}/coda-recovery-environment.XXXXXX")
source_environment="$environment_directory/source.env"
target_old_environment="$environment_directory/target-old.env"
target_candidate_environment="$environment_directory/target-candidate.env"
signing_key="$environment_directory/recovery-signing.pem"
verification_key="$evidence_parent/recovery-verification.pem"

mkdir -p "$evidence_parent"
chmod 700 "$evidence_parent" "$environment_directory"
openssl genpkey -algorithm ED25519 -out "$signing_key"
openssl pkey -in "$signing_key" -pubout -out "$verification_key"
chmod 600 "$signing_key"
chmod 644 "$verification_key"

write_environment() {
  destination=$1
  image=$2
  app_port=$3
  s3_port=$4
  cat > "$destination" <<EOF
CODA_IMAGE=$image
APP_ORIGIN=http://127.0.0.1:$app_port
TRUSTED_PROXY_CIDRS=127.0.0.1/32
DATABASE_URL=postgresql://coda:recovery-postgres-password@postgres:5432/coda?schema=public
POSTGRES_PASSWORD=recovery-postgres-password
SETUP_TOKEN=recovery-setup-token-must-be-at-least-32-characters
MINIO_ROOT_USER=recovery-root
MINIO_ROOT_PASSWORD=recovery-minio-password
MINIO_CORS_ALLOW_ORIGIN=http://127.0.0.1:$app_port
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://127.0.0.1:$s3_port
S3_REGION=us-east-1
S3_BUCKET=coda-recovery
S3_ACCESS_KEY=recovery-app
S3_SECRET_KEY=recovery-app-secret
S3_FORCE_PATH_STYLE=true
CODA_APP_PORT=$app_port
CODA_S3_PORT=$s3_port
EOF
  chmod 600 "$destination"
}

write_environment "$source_environment" "$old_image" "$source_app_port" "$source_s3_port"
write_environment "$target_old_environment" "$old_image" 53017 59017
write_environment "$target_candidate_environment" "$candidate_image" 53017 59017

compose() {
  project=$1
  environment=$2
  shift 2
  docker compose --project-name "$project" --env-file "$environment" -f compose.yaml "$@"
}

compose_app() {
  project=$1
  environment=$2
  shift 2
  docker compose --project-name "$project" --env-file "$environment" \
    -f compose.app.yaml -f scripts/ops/compose.recovery-state.yaml "$@"
}

cleanup() {
  CODA_RECOVERY_DISPOSABLE_PROJECT=$app_project \
    pnpm exec tsx scripts/ops/coda-recovery.ts reset \
      --project "$app_project" --env-file "$target_candidate_environment" \
      --compose-file compose.app.yaml \
      --compose-file scripts/ops/compose.recovery-state.yaml >/dev/null 2>&1 || true
  CODA_RECOVERY_DISPOSABLE_PROJECT=$target_project \
    pnpm exec tsx scripts/ops/coda-recovery.ts reset \
      --project "$target_project" --env-file "$target_candidate_environment" \
      --compose-file compose.yaml >/dev/null 2>&1 || true
  docker compose --project-name "$source_project" --env-file "$source_environment" \
    -f compose.yaml -f compose.local.yaml down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$source_environment" "$target_old_environment" "$target_candidate_environment"
  rm -f "$signing_key"
  rmdir "$environment_directory" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

docker pull "$old_image"
compose "$source_project" "$source_environment" -f compose.local.yaml up --detach
source_coda=$(compose "$source_project" "$source_environment" -f compose.local.yaml ps --quiet coda)
attempt=0
until [ "$(docker inspect --format '{{.State.Health.Status}}' "$source_coda")" = healthy ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 90 ] || { docker logs "$source_coda"; exit 1; }
  sleep 2
done

CODA_RECOVERY_URL="http://127.0.0.1:$source_app_port" \
CODA_RECOVERY_SETUP_TOKEN=recovery-setup-token-must-be-at-least-32-characters \
  pnpm exec tsx scripts/ops/seed-recovery-fixture.ts

pnpm exec tsx scripts/ops/coda-recovery.ts backup \
  --project "$source_project" --env-file "$source_environment" \
  --compose-file compose.yaml --compose-file compose.local.yaml \
  --recovery-directory "$backup_directory" --image "$old_image" \
  --signing-key "$signing_key"

cp "$backup_directory/manifest.json" "$environment_directory/authenticated-manifest.json"
printf '\n' >> "$backup_directory/manifest.json"
if pnpm exec tsx scripts/ops/coda-recovery.ts verify \
  --project "$source_project" --env-file "$source_environment" \
  --compose-file compose.yaml --recovery-directory "$backup_directory" \
  --verification-key "$verification_key"; then
  echo 'Tampered recovery manifest was accepted' >&2
  exit 1
fi
mv "$environment_directory/authenticated-manifest.json" "$backup_directory/manifest.json"
mv "$backup_directory/manifest.sig" "$environment_directory/authenticated-manifest.sig"
if pnpm exec tsx scripts/ops/coda-recovery.ts verify \
  --project "$source_project" --env-file "$source_environment" \
  --compose-file compose.yaml --recovery-directory "$backup_directory" \
  --verification-key "$verification_key"; then
  echo 'Unsigned recovery manifest was accepted' >&2
  exit 1
fi
mv "$environment_directory/authenticated-manifest.sig" "$backup_directory/manifest.sig"
pnpm exec tsx scripts/ops/coda-recovery.ts verify \
  --project "$source_project" --env-file "$source_environment" \
  --compose-file compose.yaml --recovery-directory "$backup_directory" \
  --verification-key "$verification_key"

compose "$target_project" "$target_old_environment" up --detach postgres minio minio-init
compose "$target_project" "$target_old_environment" wait minio-init
CODA_RECOVERY_DISPOSABLE_PROJECT=$target_project \
  pnpm exec tsx scripts/ops/coda-recovery.ts restore \
    --project "$target_project" --env-file "$target_old_environment" \
    --compose-file compose.yaml --recovery-directory "$backup_directory" \
    --verification-key "$verification_key"

compose "$target_project" "$target_candidate_environment" up --detach --no-deps coda
pnpm exec tsx scripts/ops/coda-recovery.ts smoke \
  --project "$target_project" --env-file "$target_candidate_environment" \
  --compose-file compose.yaml --recovery-directory "$backup_directory" --image "$candidate_image" \
  --verification-key "$verification_key"

CODA_RECOVERY_DISPOSABLE_PROJECT=$target_project \
  pnpm exec tsx scripts/ops/coda-recovery.ts reset \
    --project "$target_project" --env-file "$target_candidate_environment" --compose-file compose.yaml
compose "$target_project" "$target_old_environment" up --detach postgres minio minio-init
compose "$target_project" "$target_old_environment" wait minio-init
CODA_RECOVERY_DISPOSABLE_PROJECT=$target_project \
  pnpm exec tsx scripts/ops/coda-recovery.ts restore \
    --project "$target_project" --env-file "$target_old_environment" \
    --compose-file compose.yaml --recovery-directory "$backup_directory" \
    --verification-key "$verification_key"
pnpm exec tsx scripts/ops/coda-recovery.ts smoke \
  --project "$target_project" --env-file "$target_old_environment" \
  --compose-file compose.yaml --recovery-directory "$backup_directory" --image "$old_image" \
  --verification-key "$verification_key"

compose_app "$app_project" "$target_old_environment" up --detach postgres minio minio-init
compose_app "$app_project" "$target_old_environment" wait minio-init
CODA_RECOVERY_DISPOSABLE_PROJECT=$app_project \
  pnpm exec tsx scripts/ops/coda-recovery.ts restore \
    --project "$app_project" --env-file "$target_old_environment" \
    --compose-file compose.app.yaml \
    --compose-file scripts/ops/compose.recovery-state.yaml \
    --recovery-directory "$backup_directory" \
    --verification-key "$verification_key"
compose_app "$app_project" "$target_candidate_environment" up --detach --no-deps coda
pnpm exec tsx scripts/ops/coda-recovery.ts smoke \
  --project "$app_project" --env-file "$target_candidate_environment" \
  --compose-file compose.app.yaml \
  --compose-file scripts/ops/compose.recovery-state.yaml \
  --recovery-directory "$backup_directory" --image "$candidate_image" \
  --verification-key "$verification_key"

CODA_RECOVERY_DISPOSABLE_PROJECT=$app_project \
  pnpm exec tsx scripts/ops/coda-recovery.ts reset \
    --project "$app_project" --env-file "$target_candidate_environment" \
    --compose-file compose.app.yaml \
    --compose-file scripts/ops/compose.recovery-state.yaml
compose_app "$app_project" "$target_old_environment" up --detach postgres minio minio-init
compose_app "$app_project" "$target_old_environment" wait minio-init
CODA_RECOVERY_DISPOSABLE_PROJECT=$app_project \
  pnpm exec tsx scripts/ops/coda-recovery.ts restore \
    --project "$app_project" --env-file "$target_old_environment" \
    --compose-file compose.app.yaml \
    --compose-file scripts/ops/compose.recovery-state.yaml \
    --recovery-directory "$backup_directory" \
    --verification-key "$verification_key"
pnpm exec tsx scripts/ops/coda-recovery.ts smoke \
  --project "$app_project" --env-file "$target_old_environment" \
  --compose-file compose.app.yaml \
  --compose-file scripts/ops/compose.recovery-state.yaml \
  --recovery-directory "$backup_directory" --image "$old_image" \
  --verification-key "$verification_key"

printf 'Recovery lifecycle evidence: %s\n' "$evidence_parent"
