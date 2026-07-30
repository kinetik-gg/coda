import { beforeAll, describe, expect, it } from 'vitest';
import { importFinalDraft } from '../../packages/fountain/src/interchange/fdx';
import {
  api,
  loginWithThrottlePatience,
  ownerEmail,
  ownerPassword,
  request,
  type JsonEnvelope,
  type SessionAuth,
} from './support/api-client';
import { databaseReachable, queryDatabase } from './support/postgres';

interface ArtifactView {
  id: string;
  status: 'READY';
  version: number;
  convertedFountain: string;
  conversionReport: {
    schemaVersion: number;
    sourceFormat: string;
    adapter: { id: string; version: string };
    elements: Array<{ status: string }>;
  };
}

const original = Buffer.from('Integration DOCX original bytes\n');
const convertedFountain = 'Title: Integration Artifact\n\nINT. ARCHIVE - DAY\n';
const report = {
  schemaVersion: 1,
  sourceFormat: 'docx',
  adapter: { id: 'integration-docx', version: '1.0.0' },
  generatedAt: '2026-07-30T00:00:00.000Z',
  summary: { total: 1, preserved: 1, converted: 0, uncertain: 0, unsupported: 0 },
  warnings: [],
  elements: [
    {
      id: 'paragraph-1',
      status: 'preserved',
      source: { kind: 'paragraph', location: { unit: 'paragraph', start: 0, end: 1 } },
      target: { kind: 'scene_heading', location: { unit: 'line', start: 2, end: 3 } },
      summary: 'Scene heading preserved.',
      warnings: [],
    },
  ],
};

describe('screenplay import artifacts through the application stack', () => {
  let owner: SessionAuth;

  beforeAll(async () => {
    if (!ownerEmail || !ownerPassword) return;
    owner = await loginWithThrottlePatience(ownerEmail, ownerPassword);
  }, 90_000);

  it.runIf(Boolean(ownerEmail && ownerPassword) && databaseReachable())(
    'retains original bytes, immutable Fountain, and a validated report through purge-safe storage',
    async () => {
      const screenplay = await api<JsonEnvelope<{ id: string }>>(
        '/api/v1/screenplays',
        201,
        { method: 'POST', body: JSON.stringify({ title: 'Artifact integration' }) },
        owner,
      );
      const screenplayId = screenplay.data.id;
      const reservation = await api<
        JsonEnvelope<{ id: string; version: number; uploadUrl: string }>
      >(
        '/api/v1/screenplays/' + screenplayId + '/import-artifacts',
        201,
        {
          method: 'POST',
          body: JSON.stringify({
            originalFilename: 'integration.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: original.byteLength,
            sourceFormat: 'docx',
          }),
        },
        owner,
      );
      const upload = await fetch(reservation.data.uploadUrl, {
        method: 'PUT',
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'if-none-match': '*',
        },
        body: original,
      });
      expect(upload.status).toBe(200);

      const artifactPath =
        '/api/v1/screenplays/' + screenplayId + '/import-artifacts/' + reservation.data.id;
      const completed = await api<JsonEnvelope<ArtifactView>>(
        artifactPath + '/complete',
        201,
        {
          method: 'POST',
          body: JSON.stringify({
            version: reservation.data.version,
            convertedFountain,
            report,
          }),
        },
        owner,
      );
      expect(completed.data).toMatchObject({
        status: 'READY',
        convertedFountain,
        conversionReport: { schemaVersion: 1, elements: [{ status: 'preserved' }] },
      });

      const read = await api<JsonEnvelope<{ url: string }>>(
        artifactPath + '/original',
        200,
        {},
        owner,
      );
      const downloaded = await fetch(read.data.url);
      expect(downloaded.status).toBe(200);
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(original);
      expect(
        queryDatabase(
          "SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND conrelid = 'screenplay_import_artifacts'::regclass",
        ),
      ).toBe('0');

      expect(
        (await request('/api/v1/screenplays/' + screenplayId, { method: 'DELETE' }, owner)).status,
      ).toBe(200);
      expect(
        (
          await request(
            '/api/v1/screenplays/' + screenplayId + '/purge',
            { method: 'DELETE' },
            owner,
          )
        ).status,
      ).toBe(200);
      expect(
        queryDatabase(
          "SELECT count(*) FROM screenplay_import_artifacts WHERE screenplay_id = '" +
            screenplayId +
            "'::uuid",
        ),
      ).toBe('0');
      expect(
        queryDatabase(
          "SELECT count(*) FROM storage_deletion_jobs WHERE object_key = 'screenplay-imports/" +
            screenplayId +
            '/' +
            reservation.data.id +
            "/original'",
        ),
      ).toBe('1');
    },
    120_000,
  );

  it.runIf(Boolean(ownerEmail && ownerPassword) && databaseReachable())(
    'converts a real FDX upload through the bounded runtime to the same Fountain the direct importer produces',
    async () => {
      const fdx = Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. ARCHIVE - DAY</Text></Paragraph>
    <Paragraph Type="Action"><Text>Dust settles over old reels.</Text></Paragraph>
    <Paragraph Type="Character"><Text>KEEPER</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Every frame tells on us.</Text></Paragraph>
    <Paragraph Type="Shot"><Text>CLOSE ON a label.</Text></Paragraph>
  </Content>
  <TitlePage>
    <Content>
      <Paragraph Type="Title"><Text>Integration Artifact</Text></Paragraph>
    </Content>
  </TitlePage>
</FinalDraft>`,
        'utf-8',
      );
      const expected = importFinalDraft(new Uint8Array(fdx));

      const screenplay = await api<JsonEnvelope<{ id: string }>>(
        '/api/v1/screenplays',
        201,
        { method: 'POST', body: JSON.stringify({ title: 'FDX equivalence' }) },
        owner,
      );
      const screenplayId = screenplay.data.id;
      const reservation = await api<
        JsonEnvelope<{ id: string; version: number; uploadUrl: string }>
      >(
        '/api/v1/screenplays/' + screenplayId + '/import-artifacts',
        201,
        {
          method: 'POST',
          body: JSON.stringify({
            originalFilename: 'integration.fdx',
            mimeType: 'application/xml',
            sizeBytes: fdx.byteLength,
            sourceFormat: 'final-draft',
          }),
        },
        owner,
      );
      const upload = await fetch(reservation.data.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/xml', 'if-none-match': '*' },
        body: fdx,
      });
      expect(upload.status).toBe(200);

      const artifactPath =
        '/api/v1/screenplays/' + screenplayId + '/import-artifacts/' + reservation.data.id;
      const converted = await api<JsonEnvelope<ArtifactView>>(
        artifactPath + '/convert',
        201,
        { method: 'POST', body: JSON.stringify({ version: reservation.data.version }) },
        owner,
      );

      expect(converted.data.status).toBe('READY');
      expect(converted.data.convertedFountain).toBe(expected.fountain);
      expect(converted.data.conversionReport).toMatchObject({
        schemaVersion: 1,
        sourceFormat: 'final-draft',
        adapter: { id: 'coda.fdx' },
      });
      expect(converted.data.conversionReport.elements.length).toBeGreaterThan(0);

      const read = await api<JsonEnvelope<{ url: string }>>(
        artifactPath + '/original',
        200,
        {},
        owner,
      );
      const downloaded = await fetch(read.data.url);
      expect(downloaded.status).toBe(200);
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(fdx);
    },
    120_000,
  );
});
