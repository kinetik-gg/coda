import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { DatabaseReadinessDeps } from './database-readiness';
import { parseDatabaseTarget } from './database-target';
import {
  closeDiagnosticServer,
  createDiagnosticServer,
  listenDiagnosticServer,
} from './diagnostic-server';
import { runMigrations } from './migration-runner';
import {
  createPreUpgradeBackupStep,
  type PreUpgradeBackupConfig,
} from './pre-upgrade-backup.runtime';
import { tcpProbe } from './tcp-probe';

export type DatabaseReadinessConfig = PreUpgradeBackupConfig & {
  readonly DATABASE_URL: string;
  readonly DB_BOOT_CONNECT_TIMEOUT_MS: number;
};

/**
 * Wire {@link DatabaseReadinessDeps} to real infrastructure: a raw TCP probe followed by a
 * throwaway Prisma client for the connection/auth/TLS check, `prisma migrate deploy` as a child
 * process, and a plain Node HTTP server for the diagnostic page. Kept as a thin composition layer
 * so the retry/backoff/recovery logic in `database-readiness.ts` stays fully unit-testable without
 * a real network or database.
 */
export function createProductionDatabaseReadinessDeps(
  config: DatabaseReadinessConfig,
  apiRoot: string,
): DatabaseReadinessDeps {
  const target = parseDatabaseTarget(config.DATABASE_URL);
  const logger = new Logger('DatabaseReadiness');

  return {
    async probe() {
      await tcpProbe(target.host, target.port, config.DB_BOOT_CONNECT_TIMEOUT_MS);
      const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
      try {
        await prisma.$queryRaw`SELECT 1`;
      } finally {
        await prisma.$disconnect();
      }
    },
    preMigrate: createPreUpgradeBackupStep(config, apiRoot),
    async migrate() {
      await runMigrations(apiRoot);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    async startDiagnostics(port, getView) {
      const server = createDiagnosticServer(getView);
      await listenDiagnosticServer(server, port);
      return { close: () => closeDiagnosticServer(server) };
    },
    now: () => Date.now(),
    onAttemptFailed(view) {
      logger.warn(
        `Database unreachable (${view.errorClass}) at ${view.host}:${view.port}; attempt ${view.attempt}, ` +
          `serving diagnostic page, next retry at ${view.nextRetryAt}.`,
      );
    },
  };
}
