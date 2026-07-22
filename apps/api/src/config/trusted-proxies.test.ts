import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { configureTrustedProxies } from './trusted-proxies';

function nestApplication(expressApplication: ReturnType<typeof express>) {
  return {
    getHttpAdapter: () => ({ getInstance: () => expressApplication }),
  };
}

describe('trusted proxy configuration', () => {
  it('uses the nearest untrusted forwarded address as the client IP', async () => {
    const application = express();
    configureTrustedProxies(nestApplication(application) as never, ['127.0.0.1/32', '::1/128']);
    application.get('/', (request_, response) =>
      response.json({ ip: request_.ip, ips: request_.ips }),
    );

    const response = await request(application)
      .get('/')
      .set('x-forwarded-for', '203.0.113.9, 198.51.100.42')
      .expect(200);

    expect(response.body).toMatchObject({ ip: '198.51.100.42', ips: ['198.51.100.42'] });
  });

  it('ignores forwarded addresses from an untrusted direct peer', async () => {
    const application = express();
    configureTrustedProxies(nestApplication(application) as never, ['10.20.30.0/24']);
    application.get('/', (request_, response) => response.json({ ip: request_.ip }));

    const response = await request(application)
      .get('/')
      .set('x-forwarded-for', '198.51.100.42')
      .expect(200);

    const body = JSON.parse(response.text) as { ip?: string };
    expect(body.ip).not.toBe('198.51.100.42');
  });
});
