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
import { RequestAuthContext } from './auth/request-auth-context';
import { SessionGuard } from './auth/session.guard';
import { SessionMiddleware } from './auth/session.middleware';
import { SetupTokenService } from './auth/setup-token.service';
import { BreakdownController } from './breakdown/breakdown.controller';
import { BreakdownService } from './breakdown/breakdown.service';
import { BackupService } from './backup/backup.service';
import { ScheduledBackupController } from './backup/scheduled/scheduled-backup.controller';
import { ScheduledBackupEngine } from './backup/scheduled/scheduled-backup.engine';
import { ScheduledBackupJob } from './backup/scheduled/scheduled-backup.job';
import { ScheduledBackupService } from './backup/scheduled/scheduled-backup.service';
import { ScheduledBackupDestinationManager } from './backup/scheduled/scheduled-backup-destination.manager';
import { ScheduledBackupSigningService } from './backup/scheduled/scheduled-backup-signing';
import { CollaborationController } from './collaboration/collaboration.controller';
import { CollaborationService } from './collaboration/collaboration.service';
import { ProblemDetailsFilter } from './common/problem.filter';
import { ExportsController } from './exports/exports.controller';
import { ExportsService } from './exports/exports.service';
import { DoctorController } from './health/doctor.controller';
import { DoctorService } from './health/doctor.service';
import { HealthController } from './health/health.controller';
import { InstanceManagementController } from './instance/instance-management.controller';
import { InstanceManagementService } from './instance/instance-management.service';
import { ExternalApiDocsController } from './openapi/external-api-docs.controller';
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
import { StorageClientProvider } from './storage/storage-client.provider';
import { StorageDeletionService } from './storage/storage-deletion.service';
import { StorageSettingsController } from './storage/storage-settings.controller';
import { StorageSettingsService } from './storage/storage-settings.service';
import { StorageValidationService } from './storage/storage-validation.service';
import { ProjectRetentionService } from './trash/project-retention.service';
import { TrashController, TrashedProjectsController } from './trash/trash.controller';
import { TrashService } from './trash/trash.service';
import { ReleaseCheckerService } from './updates/release-checker.service';
import { UpdatesController } from './updates/updates.controller';
import { UpdatesService } from './updates/updates.service';
import { WorkspaceLayoutsController } from './workspace-layouts/workspace-layouts.controller';
import { WorkspaceLayoutsService } from './workspace-layouts/workspace-layouts.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({ rootPath: join(__dirname, 'public'), exclude: ['/api/{*path}'] }),
  ],
  controllers: [
    AuthController,
    ApiCredentialsController,
    ApiCredentialContextController,
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
    InstanceManagementController,
    UpdatesController,
    StorageSettingsController,
    ScheduledBackupController,
    WorkspaceLayoutsController,
    ExternalApiDocsController,
  ],
  providers: [
    PrismaService,
    ConfigEncryptionService,
    InstanceConfigService,
    AuthService,
    SetupTokenService,
    ApiCredentialsService,
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
    StorageClientProvider,
    StorageService,
    StorageValidationService,
    StorageSettingsService,
    StorageDeletionService,
    DocumentsService,
    CollaborationService,
    TrashService,
    ProjectRetentionService,
    ReleaseCheckerService,
    UpdatesService,
    DoctorService,
    ExportsService,
    ProjectImportAdmission,
    ProjectImportsService,
    RealtimeGateway,
    WorkspaceLayoutsService,
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
