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
 * The acceptance gate for issue #243, over real HTTP against a real database.
 *
 * Both criteria are behavioural and neither can be proved by a unit test:
 *
 * 1. **No materially changed, deleted, or ambiguous reference moves without a recorded decision.**
 *    Asserted by applying with no decisions and requiring the request to fail *and the pin to be
 *    byte-identical afterwards* — a service that refused the request but had already moved something
 *    would pass the first half and fail the second.
 * 2. **A concurrent screenplay, link, or pin change aborts the whole apply with no partial updates.**
 *    Asserted by previewing, editing the screenplay underneath the plan, then applying it: the
 *    request must be refused and *every* pin must be untouched, including the auto-carry one that
 *    would have moved had the apply been allowed to proceed piecemeal.
 *
 * Deliberately uses only `support/api-client.ts`. This lane drives a containerised app and never
 * runs `prisma generate` in the runner's context, so importing `PrismaService` here would fail.
 */

type Screenplay = { id: string; version: number };
type Pin = {
  screenplayRevisionId: string;
  screenplayVersion: number;
  source: { start: number; end: number };
  sourceTextHash: string;
  updatedAt: string;
};
type ResolvedReference = { resolution: string; pin: Pin | null; sourceText: string | null };

type Candidate = { range: { start: number; end: number }; text: string; textHash: string };
type PlanEntry = {
  itemSourceReferenceId: string;
  classification: string;
  autoApplicable: boolean;
  decisionRequired: boolean;
  proposed: Candidate | null;
  candidates: Candidate[];
};
type Plan = {
  planVersion: number;
  target: { screenplayVersion: number; screenplayRevisionId: string | null };
  entries: PlanEntry[];
  summary: { autoCarryCount: number; decisionCount: number };
  fingerprint: string;
};

type AppliedReference = {
  itemSourceReferenceId: string;
  outcome: string;
  confirmed: boolean;
  classification: string;
  source: { start: number; end: number } | null;
};
type ApplyResult = {
  fingerprint: string;
  target: { screenplayVersion: number; screenplayRevisionId: string };
  applied: AppliedReference[];
  summary: { carriedCount: number; retargetedCount: number; keptCount: number; movedCount: number };
};

const originalSource = [
  'Title: Rebase Apply Fixture',
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
  .replace('Title: Rebase Apply Fixture', 'Title: Rebase Apply Fixture\nCredit: Written by')
  .replace('The kettle boils over and nobody moves.', 'The kettle whistles while everyone stares.');

const shiftedQuote = 'INT. OFFICE - DAY';
const changedQuote = 'The kettle boils over and nobody moves.';

function rangeOf(text: string, needle: string) {
  const start = text.indexOf(needle);
  return { start, end: start + needle.length };
}

describe('Screenplay rebase apply (#243)', () => {
  let owner: SessionAuth;
  let project: Project;
  let itemId: string;
  let screenplay: Screenplay;
  let referenceIds: string[];
  let previewPath: string;
  let applyPath: string;
  let pinPaths: string[];

  beforeAll(async () => {
    owner = await ensureOwnerAuth();
    ({ project, itemId } = await provisionExportFixture(owner));
    previewPath = `/api/v1/projects/${project.id}/screenplay-rebase-preview`;
    applyPath = `/api/v1/projects/${project.id}/screenplay-rebase`;

    screenplay = (
      await api<JsonEnvelope<Screenplay>>(
        '/api/v1/screenplays',
        201,
        {
          method: 'POST',
          body: JSON.stringify({ title: 'Rebase Apply Fixture', sourceText: originalSource }),
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

    for (const [index, needle] of [shiftedQuote, changedQuote].entries()) {
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

  /** Three source references on one item: two pinned ranges plus one that was never pinned. */
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
          filename: 'rebase-apply-source.pdf',
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
        body: JSON.stringify({ storageObjectId: upload.data.id, title: 'Rebase apply source' }),
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

  const preview = async () => (await api<JsonEnvelope<Plan>>(previewPath, 200, {}, owner)).data;
  const readPin = (path: string) => api<JsonEnvelope<ResolvedReference>>(path, 200, {}, owner);
  const snapshot = async () =>
    JSON.stringify(await Promise.all(pinPaths.map((path) => readPin(path))));
  const applyRaw = (body: unknown) =>
    request(applyPath, { method: 'POST', body: JSON.stringify(body) }, owner);
  const entryFor = (plan: Plan, index: number) =>
    required(
      plan.entries.find((entry) => entry.itemSourceReferenceId === referenceIds[index]),
      `entry ${String(index)} is missing from the plan`,
    );

  it('refuses to move a materially changed range with no decision, and moves nothing at all', async () => {
    const plan = await preview();
    expect(entryFor(plan, 0).autoApplicable).toBe(true);
    expect(entryFor(plan, 1).classification).toBe('materially-changed');
    expect(entryFor(plan, 1).autoApplicable).toBe(false);

    const before = await snapshot();
    const refused = await applyRaw({
      planVersion: 1,
      fingerprint: plan.fingerprint,
      decisions: [],
    });
    expect(refused.status).toBe(400);

    // The auto-carry entry would have moved had the apply been allowed to proceed part-way. It did
    // not: the refusal happens before the transaction writes anything.
    expect(await snapshot()).toBe(before);
  }, 120_000);

  it('refuses a plan built against text that has since changed, leaving every pin untouched', async () => {
    const plan = await preview();
    const before = await snapshot();

    // The screenplay moves under the reviewed plan — the concurrency case the whole flow is for.
    screenplay = (
      await api<JsonEnvelope<Screenplay>>(
        `/api/v1/screenplays/${screenplay.id}`,
        200,
        {
          method: 'PATCH',
          body: JSON.stringify({
            sourceText: `${editedSource}\nA line nobody reviewed.\n`,
            version: screenplay.version,
          }),
        },
        owner,
      )
    ).data;

    const refused = await applyRaw({
      planVersion: 1,
      fingerprint: plan.fingerprint,
      decisions: [{ itemSourceReferenceId: referenceIds[1], action: 'keep' }],
    });
    expect(refused.status).toBe(409);
    expect(await snapshot()).toBe(before);
  }, 120_000);

  it('refuses an anchor the plan never offered', async () => {
    const plan = await preview();
    const before = await snapshot();
    const refused = await applyRaw({
      planVersion: 1,
      fingerprint: plan.fingerprint,
      decisions: [
        {
          itemSourceReferenceId: referenceIds[1],
          action: 'retarget',
          // A real range in the target text, and one no candidate ever named.
          source: { start: 0, end: 5 },
          sourceTextHash: 'a'.repeat(64),
        },
      ],
    });
    expect(refused.status).toBe(400);
    expect(await snapshot()).toBe(before);
  }, 120_000);

  it('carries the proved range and keeps the reviewed one, in one transaction', async () => {
    const plan = await preview();
    const carried = entryFor(plan, 0);
    const liveSource = `${editedSource}\nA line nobody reviewed.\n`;

    const applied = (
      await api<JsonEnvelope<ApplyResult>>(
        applyPath,
        201,
        {
          method: 'POST',
          body: JSON.stringify({
            planVersion: 1,
            fingerprint: plan.fingerprint,
            decisions: [{ itemSourceReferenceId: referenceIds[1], action: 'keep' }],
          }),
        },
        owner,
      )
    ).data;

    expect(applied.summary).toMatchObject({ carriedCount: 1, keptCount: 1, movedCount: 1 });
    expect(applied.target.screenplayVersion).toBe(screenplay.version);
    // The preview never cut a revision for the live version; the apply did, inside its transaction.
    expect(plan.target.screenplayRevisionId).toBeNull();
    expect(applied.target.screenplayRevisionId).toMatch(/^[0-9a-f-]{36}$/);

    const moved = required(
      applied.applied.find((entry) => entry.itemSourceReferenceId === referenceIds[0]),
      'the carried reference is missing from the result',
    );
    expect(moved).toMatchObject({ outcome: 'carried', confirmed: false });

    // The pin now resolves to the same text out of the *new* revision, at the shifted offsets.
    const pin = required((await readPin(required(pinPaths[0], 'pin path'))).data, 'reference');
    expect(pin.sourceText).toBe(shiftedQuote);
    expect(pin.pin?.screenplayRevisionId).toBe(applied.target.screenplayRevisionId);
    expect(pin.pin?.screenplayVersion).toBe(screenplay.version);
    expect(pin.pin?.source).toEqual(carried.proposed?.range);
    expect(liveSource.slice(pin.pin!.source.start, pin.pin!.source.end)).toBe(shiftedQuote);

    // The kept pin is exactly where it was — still on its old revision, still stale.
    const kept = required((await readPin(required(pinPaths[1], 'pin path'))).data.pin, 'kept pin');
    expect(kept.screenplayVersion).toBeLessThan(screenplay.version);
    expect(kept.screenplayRevisionId).not.toBe(applied.target.screenplayRevisionId);
  }, 120_000);

  it('refuses to replay the same apply, because the plan it names no longer describes the pins', async () => {
    const plan = await preview();
    const first = await applyRaw({
      planVersion: 1,
      fingerprint: plan.fingerprint,
      decisions: [{ itemSourceReferenceId: referenceIds[1], action: 'keep' }],
    });
    expect(first.status).toBe(201);

    const replay = await applyRaw({
      planVersion: 1,
      fingerprint: plan.fingerprint,
      decisions: [{ itemSourceReferenceId: referenceIds[1], action: 'keep' }],
    });
    // Not absorbed as a no-op: a rebase that silently re-applied could double-move a pin.
    expect(replay.status).toBe(409);
  }, 120_000);

  it('moves a materially changed range once the reviewer confirms an offered anchor', async () => {
    const plan = await preview();
    const entry = entryFor(plan, 1);
    expect(entry.classification).toBe('materially-changed');
    const chosen = required(entry.proposed, 'the materially changed entry proposes no anchor');

    const applied = (
      await api<JsonEnvelope<ApplyResult>>(
        applyPath,
        201,
        {
          method: 'POST',
          body: JSON.stringify({
            planVersion: 1,
            fingerprint: plan.fingerprint,
            decisions: [
              {
                itemSourceReferenceId: referenceIds[1],
                action: 'retarget',
                source: chosen.range,
                sourceTextHash: chosen.textHash,
              },
            ],
          }),
        },
        owner,
      )
    ).data;

    const moved = required(
      applied.applied.find((reference) => reference.itemSourceReferenceId === referenceIds[1]),
      'the confirmed reference is missing from the result',
    );
    // `retargeted` and `confirmed`, never `carried`: the audit trail must not call a human decision
    // an automatic one.
    expect(moved).toMatchObject({
      outcome: 'retargeted',
      confirmed: true,
      classification: 'materially-changed',
    });
    expect(moved.source).toEqual(chosen.range);

    const pin = required((await readPin(required(pinPaths[1], 'pin path'))).data, 'reference');
    expect(pin.pin?.screenplayVersion).toBe(screenplay.version);
    expect(pin.sourceText).toBe(chosen.text);
  }, 120_000);

  it('leaves an unpinned reference out of the apply entirely', async () => {
    const unpinned = await readPin(required(pinPaths[2], 'pin path'));
    expect(unpinned.data.resolution).toBe('unpinned');
    const plan = await preview();
    const refused = await applyRaw({
      planVersion: 1,
      fingerprint: plan.fingerprint,
      decisions: [{ itemSourceReferenceId: referenceIds[2], action: 'keep' }],
    });
    // Ignoring the decision would leave the reviewer believing they had made one.
    expect(refused.status).toBe(400);
  }, 120_000);

  it('records the rebase in the project activity feed', async () => {
    const activity = await api<JsonEnvelope<{ resourceType: string; action: string }[]>>(
      `/api/v1/projects/${project.id}/activity`,
      200,
      {},
      owner,
    );
    expect(
      activity.data.some((event) => event.resourceType === 'breakdown_screenplay_rebase'),
    ).toBe(true);
  }, 120_000);
});
