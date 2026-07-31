import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * `app.module.ts` wires `ThrottlerGuard` as `APP_GUARD` with a configurable limit
 * (`THROTTLE_DEFAULT_LIMIT`, default 120/60s) so a disposable CI stack can raise its own headroom
 * without touching the production default (#289). Raising that limit for one environment is only
 * safe if the guard itself still rejects requests once whatever limit is configured is exceeded —
 * this test proves that end of the contract directly, against the exact `ThrottlerModule` +
 * `APP_GUARD` wiring `app.module.ts` uses, independent of which limit is configured anywhere.
 */
@Controller('probe')
class ThrottleProbeController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

async function throttledApp(limit: number): Promise<INestApplication> {
  @Module({
    imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit }])],
    controllers: [ThrottleProbeController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  })
  class ThrottleProbeModule {}

  const moduleRef = await Test.createTestingModule({ imports: [ThrottleProbeModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('the app-wide default request throttle', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('allows exactly the configured number of requests, then rejects the next one with 429', async () => {
    app = await throttledApp(3);
    const server = app.getHttpServer() as Server;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(server).get('/probe').expect(200);
    }
    const throttled = await request(server).get('/probe');
    expect(throttled.status).toBe(429);
  });

  it('rejects the second request once the limit is configured down to one', async () => {
    app = await throttledApp(1);
    const server = app.getHttpServer() as Server;

    await request(server).get('/probe').expect(200);
    const throttled = await request(server).get('/probe');
    expect(throttled.status).toBe(429);
  });

  it('keeps a higher configured limit from rejecting traffic that would have tripped the default', async () => {
    app = await throttledApp(200);
    const server = app.getHttpServer() as Server;

    for (let attempt = 0; attempt < 130; attempt += 1) {
      await request(server).get('/probe').expect(200);
    }
  });
});
