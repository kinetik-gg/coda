import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHttpMetricsMiddleware, type HttpDurationHistogram } from './http-metrics.middleware';

function fakeHistogram(): { observe: ReturnType<typeof vi.fn> } & HttpDurationHistogram {
  return { observe: vi.fn() } as unknown as {
    observe: ReturnType<typeof vi.fn>;
  } & HttpDurationHistogram;
}

function testApplication(histogram: HttpDurationHistogram) {
  const application = express();
  application.use(createHttpMetricsMiddleware(histogram));
  application.get('/api/v1/screenplays/:screenplayId', (_request_, response) =>
    response.sendStatus(200),
  );
  application.post('/api/v1/screenplays', (_request_, response) => response.sendStatus(201));
  return application;
}

describe('createHttpMetricsMiddleware', () => {
  it('observes duration with method, bounded route class, and status labels for a matched route', async () => {
    const histogram = fakeHistogram();
    await request(testApplication(histogram)).get('/api/v1/screenplays/abc-123').expect(200);

    expect(histogram.observe).toHaveBeenCalledOnce();
    const [labels, value] = histogram.observe.mock.calls[0] as [Record<string, string>, number];
    expect(labels).toEqual({
      method: 'GET',
      route: '/api/v1/screenplays/:screenplayId',
      status: '200',
    });
    expect(value).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(value)).toBe(true);
  });

  it('observes a bounded label for requests that never match a route', async () => {
    const histogram = fakeHistogram();
    const application = testApplication(histogram);

    await request(application).get('/api/v1/totally-unknown-route').expect(404);
    await request(application).get('/api/v1/another-unknown-one').expect(404);

    expect(histogram.observe).toHaveBeenCalledTimes(2);
    const routes = histogram.observe.mock.calls.map(
      ([labels]) => (labels as { route: string }).route,
    );
    expect(new Set(routes)).toEqual(new Set(['unmatched']));
  });

  it('never blocks the response: next() runs synchronously before any async work', () => {
    const histogram = fakeHistogram();
    const order: string[] = [];
    const next = vi.fn(() => order.push('next'));
    const middleware = createHttpMetricsMiddleware(histogram);
    const response = { once: vi.fn(), statusCode: 200 };

    middleware({ method: 'GET' } as never, response as never, next as never);
    order.push('after-call');

    expect(order).toEqual(['next', 'after-call']);
    expect(response.once).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(histogram.observe).not.toHaveBeenCalled();
  });

  it('records the response status set after the handler completes', async () => {
    const histogram = fakeHistogram();
    await request(testApplication(histogram)).post('/api/v1/screenplays').send({}).expect(201);

    const [labels] = histogram.observe.mock.calls[0] as [Record<string, string>];
    expect(labels).toEqual({ method: 'POST', route: '/api/v1/screenplays', status: '201' });
  });
});
