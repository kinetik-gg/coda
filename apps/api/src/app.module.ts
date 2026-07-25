import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { join } from 'node:path';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import {
  ApiCredentialContextController,
  ApiCredentialsController,
} from './auth/api-credentials.controller';
import { ApiCredentialsService } from './auth/api-credentials.service';
import { CsrfGuard } from './auth/csrf.guard';
import { LocalOwnerBootstrap } from './auth/local-owner-bootstrap';
import { RequestAuthContext } from './auth/request-auth-context';
import { SessionGuard } from './auth/session.guard';
import { SessionMiddleware } from './auth/session.middleware';
import { SessionsController } from './auth/sessions.controller';
import { SessionsService } from './auth/sessions.service';
import { SetupTokenService } from './auth/setup-token.service';
import { TwoFactorController } from './auth/two-factor.controller';
import { TwoFactorService } from './auth/two-factor.service';
import { BreakdownController } from './breakdown/breakdown.controller';
import { BreakdownService } from './breakdown/breakdown.service';
import { BackupController } from './backup/backup.controller';
import { BackupService } from './backup/backup.service';
import { ScheduledBackupController } from './backup/scheduled/scheduled-backup.controller';
import { ScheduledBackupEngine } from './backup/scheduled/scheduled-backup.engine';
import { ScheduledBackupJob } from './backup/scheduled/scheduled-backup.job';
import { ScheduledBackupService } from './backup/scheduled/scheduled-backup.service';
import { ScheduledBackupDestinationManager } from './backup/scheduled/scheduled-backup-destination.manager';
import { ScheduledBackupSigningService } from './backup/scheduled/scheduled-backup-signing';
import { CollaborationController } from './collaboration/collaboration.controller';
import { CollaborationService } from './collaboration/collaboration.service';
import { DatabaseCapabilities } from './database/database-capabilities';
import { PostgresDatabaseCapabilities } from './database/postgres-database-capabilities';
import { ProblemDetailsFilter } from './common/problem.filter';
import { ExportsController } from './exports/exports.controller';
import { ExportsService } from './exports/exports.service';
import { DoctorController } from './health/doctor.controller';
import { DoctorService } from './health/doctor.service';
import { HealthController } from './health/health.controller';
import { InstanceManagementController } from './instance/instance-management.controller';
import { InstanceManagementService } from './instance/instance-management.service';
import { ExternalApiDocsController } from './openapi/external-api-docs.controller';
import { MetricsService } from './metrics/metrics.service';
import { ProjectImportsController } from './imports/project-imports.controller';
import { ProjectImportsService } from './imports/project-imports.service';
import { ProjectImportBodyMiddleware } from './imports/project-import-body.middleware';
import { ProjectImportAdmission } from './imports/project-import-admission';
import { PrismaService } from './prisma/prisma.service';
import { PermissionService } from './projects/permission.service';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { SchedulerAdvisoryLock } from './scheduler/advisory-lock';
import { JobRegistry } from './scheduler/job-registry';
import { JobRunner } from './scheduler/job-runner';
import { JobStatusStore } from './scheduler/job-status-store';
import { SchedulerService } from './scheduler/scheduler.service';
import { ScreenplaysController } from './screenplays/screenplays.controller';
import { ScreenplaysService } from './screenplays/screenplays.service';
import { ScreenplayCacheControlInterceptor } from './screenplays/screenplay-cache-control.interceptor';
import { MAX_CHECKPOINTS_PER_SCREENPLAY, SCREENPLAY_LIMITS } from './screenplays/screenplay-limits';
import { env } from './config/env';
import { ConfigEncryptionService } from './config/config-encryption.service';
import { InstanceConfigService } from './config/instance-config.service';
import { DocumentsService } from './storage/documents.service';
import { StorageController } from './storage/storage.controller';
import { StorageService } from './storage/storage.service';
import { S3BlobStoreProvider } from './storage/blob/s3/s3-blob-store.provider';
import { FsBlobStoreProvider } from './storage/blob/fs/fs-blob-store.provider';
import { BlobStoreProvider } from './storage/blob/blob-store-provider';
import { BlobProxyController } from './storage/blob/blob-proxy.controller';
import { StorageDeletionService } from './storage/storage-deletion.service';
import { StorageMigrationController } from './storage/storage-migration.controller';
import { StorageMigrationService } from './storage/storage-migration.service';
import { StorageSettingsController } from './storage/storage-settings.controller';
import { StorageSettingsService } from './storage/storage-settings.service';
import { StorageValidationService } from './storage/storage-validation.service';
import { ProjectRetentionService } from './trash/project-retention.service';
import { TrashController, TrashedProjectsController } from './trash/trash.controller';
import { TrashService } from './trash/trash.service';
import { ReleaseCheckerService } from './updates/release-checker.service';
import { UpdatesController } from './updates/updates.controller';
import { UpdatesService } from './updates/updates.service';
import { UpgradeCeremonyController } from './updates/upgrade-ceremony.controller';
import { UpgradeCeremonyService } from './updates/upgrade-ceremony.service';
import { WorkspaceLayoutsController } from './workspace-layouts/workspace-layouts.controller';
import { WorkspaceLayoutsService } from './workspace-layouts/workspace-layouts.service';
import { ScreenplayLayoutsController } from './screenplay-layouts/screenplay-layouts.controller';
import { ScreenplayLayoutsService } from './screenplay-layouts/screenplay-layouts.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({ rootPath: join(__dirname, 'public'), exclude: ['/api/{*path}'] }),
  ],
  controllers: [
    AuthController,
    TwoFactorController,
    ApiCredentialsController,
    ApiCredentialContextController,
    SessionsController,
    TrashedProjectsController,
    ProjectsController,
    ScreenplaysController,
    BreakdownController,
    StorageController,
    CollaborationController,
    TrashController,
    ExportsController,
    ProjectImportsController,
    HealthController,
    DoctorController,
    BackupController,
    InstanceManagementController,
    UpdatesController,
    UpgradeCeremonyController,
    StorageSettingsController,
    StorageMigrationController,
    BlobProxyController,
    ScheduledBackupController,
    WorkspaceLayoutsController,
    ScreenplayLayoutsController,
    ExternalApiDocsController,
  ],
  providers: [
    PrismaService,
    { provide: DatabaseCapabilities, useClass: PostgresDatabaseCapabilities },
    ConfigEncryptionService,
    InstanceConfigService,
    AuthService,
    TwoFactorService,
    SetupTokenService,
    LocalOwnerBootstrap,
    ApiCredentialsService,
    SessionsService,
    RequestAuthContext,
    PermissionService,
    ProjectsService,
    ScreenplaysService,
    ScreenplayCacheControlInterceptor,
    {
      provide: SCREENPLAY_LIMITS,
      useFactory: () => {
        const config = env();
        return {
          maxDocumentsPerOwner: config.SCREENPLAY_MAX_DOCUMENTS_PER_OWNER,
          maxSourceBytesPerOwner: config.SCREENPLAY_MAX_SOURCE_BYTES_PER_OWNER,
          maxCheckpointsPerScreenplay: MAX_CHECKPOINTS_PER_SCREENPLAY,
          maxCheckpointBytesPerOwner: config.SCREENPLAY_MAX_SOURCE_BYTES_PER_OWNER,
        };
      },
    },
    BreakdownService,
    BackupService,
    ScheduledBackupSigningService,
    ScheduledBackupDestinationManager,
    ScheduledBackupEngine,
    ScheduledBackupService,
    ScheduledBackupJob,
    S3BlobStoreProvider,
    FsBlobStoreProvider,
    {
      // Driver selection: the transfer path resolves BlobStoreProvider to the
      // filesystem provider when BLOB_DRIVER=fs, else the S3 provider (default).
      // The wizard/migration/backup stay bound to S3BlobStoreProvider concretely.
      provide: BlobStoreProvider,
      useFactory: (s3: S3BlobStoreProvider, fs: FsBlobStoreProvider) =>
        env().BLOB_DRIVER === 'fs' ? fs : s3,
      inject: [S3BlobStoreProvider, FsBlobStoreProvider],
    },
    StorageService,
    StorageValidationService,
    StorageSettingsService,
    StorageMigrationService,
    StorageDeletionService,
    DocumentsService,
    CollaborationService,
    TrashService,
    ProjectRetentionService,
    ReleaseCheckerService,
    MetricsService,
    UpdatesService,
    UpgradeCeremonyService,
    DoctorService,
    ExportsService,
    ProjectImportAdmission,
    ProjectImportsService,
    RealtimeGateway,
    WorkspaceLayoutsService,
    ScreenplayLayoutsService,
    InstanceManagementService,
    JobRegistry,
    JobStatusStore,
    SchedulerAdvisoryLock,
    JobRunner,
    SchedulerService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).forRoutes('*');
    consumer.apply(ProjectImportBodyMiddleware).forRoutes({
      path: 'api/v1/projects/import',
      method: RequestMethod.POST,
    });
  }
}
