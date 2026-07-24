import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDiagnosticServer,
  createDiagnosticServer,
  listenDiagnosticServer,
} from './diagnostic-server';
import type { DiagnosticView } from './diagnostic-page';

const view: DiagnosticView = {
  host: 'db.example.com',
  port: 5432,
  errorClass: 'connection-refused',
  label: 'Connection refused',
  hints: ['Confirm the database is running.'],
  attempt: 1,
  checkedAt: '2026-07-24T00:00:00.000Z',
  nextRetryAt: '2026-07-24T00:00:02.000Z',
};

describe('diagnostic server', () => {
  let server: ReturnType<typeof createDiagnosticServer>;
  let baseUrl: string;

  beforeEach(async () => {
    server = createDiagnosticServer(() => view);
    await listenDiagnosticServer(server, 0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await closeDiagnosticServer(server);
  });

  it('reports liveness as healthy', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: 'ok' } });
  });

  it('reports readiness as failing with a problem-details body', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health/ready`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { status: number; title: string };
    expect(body.status).toBe(503);
    expect(body.title).toBe('Service Unavailable');
  });

  it('serves the diagnostic page for any other path', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('db.example.com:5432');
    expect(html).toContain('Confirm the database is running.');
  });

  it('serves the diagnostic page for an arbitrary nested path too', async () => {
    const response = await fetch(`${baseUrl}/api/anything?x=1`);
    expect(response.status).toBe(503);
    const html = await response.text();
    expect(html).toContain('connection-refused');
  });
});
