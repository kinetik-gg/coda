import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
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
import { CollaborationController } from './collaboration/collaboration.controller';
import { CollaborationService } from './collaboration/collaboration.service';
import { ProblemDetailsFilter } from './common/problem.filter';
import { ExportsController } from './exports/exports.controller';
import { ExportsService } from './exports/exports.service';
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
import { ScreenplaysController } from './screenplays/screenplays.controller';
import { ScreenplaysService } from './screenplays/screenplays.service';
import { ScreenplayCacheControlInterceptor } from './screenplays/screenplay-cache-control.interceptor';
import { MAX_CHECKPOINTS_PER_SCREENPLAY, SCREENPLAY_LIMITS } from './screenplays/screenplay-limits';
import { env } from './config/env';
import { DocumentsService } from './storage/documents.service';
import { StorageController } from './storage/storage.controller';
import { StorageService } from './storage/storage.service';
import { StorageDeletionService } from './storage/storage-deletion.service';
import { ProjectRetentionService } from './trash/project-retention.service';
import { TrashController, TrashedProjectsController } from './trash/trash.controller';
import { TrashService } from './trash/trash.service';
import { WorkspaceLayoutsController } from './workspace-layouts/workspace-layouts.controller';
import { WorkspaceLayoutsService } from './workspace-layouts/workspace-layouts.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
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
    InstanceManagementController,
    WorkspaceLayoutsController,
    ExternalApiDocsController,
  ],
  providers: [
    PrismaService,
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
    StorageService,
    StorageDeletionService,
    DocumentsService,
    CollaborationService,
    TrashService,
    ProjectRetentionService,
    ExportsService,
    ProjectImportAdmission,
    ProjectImportsService,
    RealtimeGateway,
    WorkspaceLayoutsService,
    InstanceManagementService,
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
