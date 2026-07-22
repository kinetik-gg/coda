import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/public.decorator';
import { StorageService } from '../storage/storage.service';

@Public()
@Controller('api/v1/health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}
  @Get('live') live() {
    return { data: { status: 'ok' } };
  }
  @Get('ready') async ready() {
    try {
      await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.storage.ready()]);
      return { data: { status: 'ready' } };
    } catch {
      throw new ServiceUnavailableException('A required service is unavailable');
    }
  }
}
