import type { INestApplication } from '@nestjs/common';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { MetricsService } from './metrics.service';
import { createMetricsRoute, registerMetricsRoute } from './metrics.route';

const validToken = 'a-very-long-metrics-token-value';

function fakeMetrics(body = '# HELP coda_up 1\ncoda_up 1\n') {
  return {
    contentType: 'text/plain; version=0.0.4; charset=utf-8',
    render: vi.fn().mockResolvedValue(body),
  };
}

function nestApplication(expressApplication: ReturnType<typeof express>) {
  return {
    getHttpAdapter: () => ({ getInstance: () => expressApplication }),
  } as unknown as Pick<INestApplication, 'getHttpAdapter'>;
}

function testApplication(token: string | undefined, metrics = fakeMetrics()) {
  const application = express();
  registerMetricsRoute(
    nestApplication(application),
    createMetricsRoute(metrics as unknown as MetricsService, token),
  );
  return { application, metrics };
}

describe('createMetricsRoute gate enforcement', () => {
  it('does not exist (404) when METRICS_TOKEN is unset', async () => {
    const { application } = testApplication(undefined);
    const response = await request(application).get('/metrics');

    expect(response.status).toBe(404);
    expect(response.type).toBe('application/problem+json');
    expect(response.body).toMatchObject({ status: 404, title: 'Not Found' });
  });

  it('rejects a missing bearer token with 401 once a token is configured', async () => {
    const { application } = testApplication(validToken);
    const response = await request(application).get('/metrics');

    expect(response.status).toBe(401);
    expect(response.type).toBe('application/problem+json');
  });

  it('rejects an incorrect bearer token with 401', async () => {
    const { application } = testApplication(validToken);
    const response = await request(application)
      .get('/metrics')
      .set('Authorization', 'Bearer wrong-token-value-here');

    expect(response.status).toBe(401);
  });

  it('rejects a malformed Authorization header with 401', async () => {
    const { application } = testApplication(validToken);
    const response = await request(application).get('/metrics').set('Authorization', validToken);

    expect(response.status).toBe(401);
  });

  it('serves the rendered registry with 200 for the correct bearer token', async () => {
    const { application, metrics } = testApplication(validToken);
    const response = await request(application)
      .get('/metrics')
      .set('Authorization', `Bearer ${validToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(response.text).toBe('# HELP coda_up 1\ncoda_up 1\n');
    expect(metrics.render).toHaveBeenCalledOnce();
  });

  it('forwards render failures to next() instead of hanging the response', async () => {
    const failure = new Error('registry exploded');
    const metrics = fakeMetrics();
    metrics.render.mockRejectedValue(failure);
    const handler = createMetricsRoute(metrics as unknown as MetricsService, validToken);
    const next = vi.fn();

    handler(
      { headers: { authorization: `Bearer ${validToken}` } } as never,
      { status: vi.fn().mockReturnThis(), setHeader: vi.fn(), end: vi.fn() } as never,
      next,
    );

    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(failure));
  });

  it('bypasses a later-registered SPA-style wildcard fallback, mirroring real bootstrap order', async () => {
    const application = express();
    registerMetricsRoute(
      nestApplication(application),
      createMetricsRoute(fakeMetrics('metrics-body') as unknown as MetricsService, validToken),
    );
    // Registered after, exactly as ServeStaticModule's onModuleInit runs after main.ts's
    // synchronous app.use()/route registrations during bootstrap.
    application.get('{*any}', (_request_, response) => response.send('spa-shell'));

    const response = await request(application)
      .get('/metrics')
      .set('Authorization', `Bearer ${validToken}`);

    expect(response.text).toBe('metrics-body');
  });
});
