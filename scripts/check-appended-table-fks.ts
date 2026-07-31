import { collectViolations, formatViolations } from './appended-table-fks';

/**
 * Runner for the appended-table backup-compatibility gate (issue #265), wired into `pnpm quality`
 * as `pnpm quality:appended-table-fks`. All reasoning lives in `appended-table-fks.ts`; this file
 * only owns the message and the exit code, mirroring `check-db-portability.ts`.
 */
async function main(): Promise<void> {
  const { models, migrations, violations } = await collectViolations();

  if (violations.length > 0) {
    console.error(
      'A table appended after a release must not carry a foreign key onto "users", "projects", ' +
        'or "screenplays", nor use the shared citext extension or a shared enum type — that is ' +
        'what keeps `pg_restore --clean` of an N-1 dump working (docs/data-compatibility.md). ' +
        'Use plain scalar columns and base types, as screenplay_* and space_* do. Found:\n' +
        formatViolations(violations),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-appended-table-fks: ${models} models and ${migrations} migrations clean — ` +
      'no appended table depends on a core table or a shared type.',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
