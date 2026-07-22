import express from 'express';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { installBodyParsers } from './body-parsers';

function testApplication() {
  const application = express();
  installBodyParsers(application as unknown as Pick<INestApplication, 'use'>);
  application.post('/api/v1/screenplays/import', (request_, response) => {
    response.json({ length: (request_.body as { sourceText: string }).sourceText.length });
  });
  application.post('/api/v1/other', (_request, response) => response.sendStatus(204));
  return application;
}

describe('request body parsers', () => {
  it('accepts a feature-length screenplay body above the default JSON limit', async () => {
    const response = await request(testApplication())
      .post('/api/v1/screenplays/import')
      .send({ filename: 'feature.fountain', sourceText: 'A'.repeat(150_000) });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ length: 150_000 });
  });

  it('retains the conservative JSON limit for unrelated endpoints', async () => {
    const response = await request(testApplication())
      .post('/api/v1/other')
      .send({ value: 'A'.repeat(150_000) });

    expect(response.status).toBe(413);
  });
});
