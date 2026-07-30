import { beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  ensureOwnerAuth,
  onePagePdf,
  provisionExportFixture,
  request,
  required,
  type JsonEnvelope,
  type Project,
  type SessionAuth,
} from './support/api-client';

/**
 * The acceptance gate for issue #242: **opening and completing a rebase preview performs zero
 * writes.**
 *
 * A unit test can prove the service never calls a mutating Prisma method. Only this lane can prove
 * the whole request — routing, guards, the compare engine, the plan assembler — leaves the database
 * exactly as it found it, so that is what this test does: it drives a real breakdown into the state
 * a rebase is for (a pin cut from an older revision, the screenplay since edited), snapshots the pin
 * over HTTP, previews repeatedly, and requires the snapshot to be byte-identical afterwards.
 *
 * Two side effects are checked by name rather than by snapshot, because neither shows up on the pin:
 *
 * - **No revision is cut.** The plan reports `target.screenplayRevisionId` for the live version, and
 *   it must stay `null` no matter how many times the preview runs. Cutting a checkpoint would be a
 *   real write with a real quota cost, and it belongs to #243's transaction, not to a preview.
 * - **The plan is stable.** Two consecutive previews of unchanged text must produce the same
 *   `fingerprint`. A preview that mutated anything the fingerprint covers would drift between runs.
 *
 * Deliberately uses only `support/api-client.ts`. This lane drives a containerised app and never
 * runs `prisma generate` in the runner's context, so importing `PrismaService` here would fail.
 */

type Screenplay = { id: string; version: number };
type Pin = { screenplayRevisionId: string; screenplayVersion: number; updatedAt: string };
type ResolvedReference = { resolution: string; pin: Pin | null; sourceText: string | null };

type PlanEntry = {
  itemSourceReferenceId: string;
  classification: string;
  reason: string;
  autoApplicable: boolean;
  decisionRequired: boolean;
  staleness: string;
  proposed: { range: { start: number; end: number }; text: string } | null;
  candidates: unknown[];
};
type Plan = {
  planVersion: number;
  offsetUnit: string;
  linkUpdatedAt: string;
  target: {
    screenplayVersion: number;
    screenplayRevisionId: string | null;
    sourceTextHash: string;
  };
  entries: PlanEntry[];
  excluded: { itemSourceReferenceId: string; reason: string }[];
  summary: { referenceCount: number; autoCarryCount: number; decisionCount: number };
  fingerprint: string;
};

const originalSource = [
  'Title: Rebase Fixture',
  '',
  'INT. OFFICE - DAY',
  '',
  'MAYA',
  'Not again.',
  '',
  'The kettle boils over and nobody moves.',
  '',
].join('\n');

// One insertion at the top and one rewritten action line: the first shifts a pinned range without
// touching its text, the second replaces one outright. Both in a single edit, as a real revision is.
const editedSource = originalSource
  .replace('Title: Rebase Fixture', 'Title: Rebase Fixture\nCredit: Written by')
  .replace('The kettle boils over and nobody moves.', 'The kettle whistles while everyone stares.');

const pinnedQuote = 'INT. OFFICE - DAY';
const changedQuote = 'The kettle boils over and nobody moves.';

function rangeOf(text: string, needle: string) {
  const start = text.indexOf(needle);
  return { start, end: start + needle.length };
}

describe('Screenplay rebase preview (#242)', () => {
  let owner: SessionAuth;
  let project: Project;
  let itemId: string;
  let screenplay: Screenplay;
  let referenceIds: string[];
  let previewPath: string;
  let pinPaths: string[];

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
    ({ project, itemId } = await provisionExportFixture(owner));
    previewPath = `/api/v1/projects/${project.id}/screenplay-rebase-preview`;

    screenplay = (
      await api<JsonEnvelope<Screenplay>>(
        '/api/v1/screenplays',
        201,
        {
          method: 'POST',
          body: JSON.stringify({ title: 'Rebase Fixture', sourceText: originalSource }),
        },
        owner,
      )
    ).data;
    await api<JsonEnvelope<unknown>>(
      `/api/v1/projects/${project.id}/screenplay-link`,
      200,
      { method: 'PUT', body: JSON.stringify({ screenplayId: screenplay.id }) },
      owner,
    );

    referenceIds = await seedReferences();
    pinPaths = referenceIds.map(
      (id) => `/api/v1/projects/${project.id}/items/${itemId}/source-references/${id}/revision-pin`,
    );

    // Pin one range that will merely shift and one that will be rewritten, both against version 1.
    for (const [index, needle] of [pinnedQuote, changedQuote].entries()) {
      await api<JsonEnvelope<ResolvedReference>>(
        required(pinPaths[index], 'pin path'),
        200,
        {
          method: 'PUT',
          body: JSON.stringify({
            screenplayVersion: screenplay.version,
            source: rangeOf(originalSource, needle),
          }),
        },
        owner,
      );
    }

    // Now move the screenplay on, which is what makes those pins stale and a rebase meaningful.
    screenplay = (
      await api<JsonEnvelope<Screenplay>>(
        `/api/v1/screenplays/${screenplay.id}`,
        200,
        {
          method: 'PATCH',
          body: JSON.stringify({ sourceText: editedSource, version: screenplay.version }),
        },
        owner,
      )
    ).data;
  }, 180_000);

  /**
   * Three source references on one item — an upload, a source document, then the references.
   *
   * Three because the plan has to separate two pinned ranges from one that was never pinned, and an
   * unpinned reference is the state every pre-#239 reference is still in.
   */
  async function seedReferences(): Promise<string[]> {
    const pdf = onePagePdf();
    const upload = await api<JsonEnvelope<{ id: string; version: number; uploadUrl: string }>>(
      '/api/v1/uploads',
      201,
      {
        method: 'POST',
        body: JSON.stringify({
          projectId: project.id,
          kind: 'source_document',
          filename: 'rebase-source.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdf.byteLength,
        }),
      },
      owner,
    );
    const put = await fetch(upload.data.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf', 'if-none-match': '*' },
      body: Uint8Array.from(pdf).buffer,
    });
    expect(put.status).toBe(200);
    await api<JsonEnvelope<{ id: string }>>(
      `/api/v1/projects/${project.id}/uploads/${upload.data.id}/complete`,
      201,
      { method: 'POST', body: JSON.stringify({ version: upload.data.version }) },
      owner,
    );
    const document = await api<JsonEnvelope<{ id: string }>>(
      `/api/v1/projects/${project.id}/source-documents`,
      201,
      {
        method: 'POST',
        body: JSON.stringify({ storageObjectId: upload.data.id, title: 'Rebase source' }),
      },
      owner,
    );

    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const reference = await api<JsonEnvelope<{ id: string }>>(
        `/api/v1/projects/${project.id}/items/${itemId}/source-references`,
        201,
        {
          method: 'POST',
          body: JSON.stringify({ sourceDocumentId: document.data.id, startPage: 1, endPage: 1 }),
        },
        owner,
      );
      ids.push(reference.data.id);
    }
    return ids;
  }

  const preview = () => api<JsonEnvelope<Plan>>(previewPath, 200, {}, owner);
  const readPin = (path: string) => api<JsonEnvelope<ResolvedReference>>(path, 200, {}, owner);
  const snapshot = async () =>
    JSON.stringify(await Promise.all(pinPaths.map((path) => readPin(path))));

  it('describes every pinned range against the live screenplay text', async () => {
    const plan = (await preview()).data;

    expect(plan.planVersion).toBe(1);
    expect(plan.offsetUnit).toBe('utf16-code-unit');
    expect(plan.target.screenplayVersion).toBe(screenplay.version);
    expect(plan.summary.referenceCount).toBe(2);

    const shifted = required(
      plan.entries.find((entry) => entry.itemSourceReferenceId === referenceIds[0]),
      'The shifted range is missing from the plan',
    );
    expect(shifted.staleness).toBe('stale');
    expect(shifted.classification).toBe('shifted-with-identical-text');
    expect(shifted.autoApplicable).toBe(true);
    expect(shifted.decisionRequired).toBe(false);
    expect(shifted.proposed?.text).toBe(pinnedQuote);
    expect(editedSource.slice(shifted.proposed?.range.start, shifted.proposed?.range.end)).toBe(
      pinnedQuote,
    );

    const rewritten = required(
      plan.entries.find((entry) => entry.itemSourceReferenceId === referenceIds[1]),
      'The rewritten range is missing from the plan',
    );
    // Materially changed: the plan proposes a region to look at, and still demands a decision.
    expect(rewritten.classification).toBe('materially-changed');
    expect(rewritten.autoApplicable).toBe(false);
    expect(rewritten.decisionRequired).toBe(true);
    expect(plan.summary.decisionCount).toBe(1);
    expect(plan.summary.autoCarryCount).toBe(1);
  }, 120_000);

  it('reports the third, unpinned reference as excluded rather than as a decision', async () => {
    const plan = (await preview()).data;
    // Not stale — it has no pinned revision on one side of the comparison at all.
    expect(plan.excluded).toEqual([
      { itemSourceReferenceId: referenceIds[2], itemId, reason: 'unpinned' },
    ]);
    expect(plan.entries.some((entry) => entry.itemSourceReferenceId === referenceIds[2])).toBe(
      false,
    );
  }, 120_000);

  it('performs zero writes: the pins are byte-identical after previewing repeatedly', async () => {
    const before = await snapshot();

    const first = (await preview()).data;
    const second = (await preview()).data;
    const third = (await preview()).data;

    expect(await snapshot()).toBe(before);
    // Still pinned to the *old* revision and the old version. A preview proposes; it does not move.
    const pin = required((await readPin(required(pinPaths[0], 'pin path'))).data.pin, 'pin');
    expect(pin.screenplayVersion).toBeLessThan(screenplay.version);
    expect(pin.screenplayRevisionId).not.toBe(first.target.screenplayRevisionId);

    // No revision was cut for the live version, however many previews ran.
    for (const plan of [first, second, third]) expect(plan.target.screenplayRevisionId).toBeNull();
    // And the plan is stable, which a preview with a side effect could not be.
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(third.fingerprint).toBe(first.fingerprint);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  it('rejects a preview of a version the screenplay has already moved past', async () => {
    const stale = await request(
      `${previewPath}?screenplayVersion=${screenplay.version - 1}`,
      {},
      owner,
    );
    expect(stale.status).toBe(409);
    // The matching version still succeeds, and still writes nothing.
    const before = await snapshot();
    const plan = await api<JsonEnvelope<Plan>>(
      `${previewPath}?screenplayVersion=${screenplay.version}`,
      200,
      {},
      owner,
    );
    expect(plan.data.target.screenplayVersion).toBe(screenplay.version);
    expect(await snapshot()).toBe(before);
  }, 120_000);
});
