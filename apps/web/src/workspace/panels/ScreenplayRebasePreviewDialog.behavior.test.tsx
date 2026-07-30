// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ScreenplayRebaseEntry,
  ScreenplayRebaseExcerpt,
  ScreenplayRebasePlan,
} from '@coda/contracts';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ api }));

import { ScreenplayRebasePreviewDialog } from './ScreenplayRebasePreviewDialog';

const projectId = '40000000-0000-4000-8000-000000000001';
const previewPath = `/api/v1/projects/${projectId}/screenplay-rebase-preview`;

function excerpt(text: string, start = 0): ScreenplayRebaseExcerpt {
  return {
    range: { start, end: start + text.length },
    text,
    textTruncated: false,
    textHash: 'a'.repeat(64),
  };
}

function entry(overrides: Partial<ScreenplayRebaseEntry> = {}): ScreenplayRebaseEntry {
  return {
    itemSourceReferenceId: 'ref-1',
    itemId: 'item-1',
    classification: 'materially-changed',
    reason: 'replacement-region',
    autoApplicable: false,
    decisionRequired: true,
    staleness: 'stale',
    from: {
      screenplayRevisionId: 'rev-1',
      screenplayVersion: 7,
      pinUpdatedAt: '2026-07-30T09:00:00.000Z',
      excerpt: excerpt('A siren fades.'),
      recordedTextHash: 'a'.repeat(64),
      recordedTextHashMatches: true,
    },
    proposed: {
      ...excerpt('A klaxon fades.'),
      identicalText: false,
      atSourceOffset: true,
      shift: 0,
      contextCodeUnits: 0,
    },
    candidates: [
      {
        ...excerpt('A klaxon fades.'),
        identicalText: false,
        atSourceOffset: true,
        shift: 0,
        contextCodeUnits: 0,
      },
    ],
    candidatesTruncated: false,
    ...overrides,
  };
}

function plan(overrides: Partial<ScreenplayRebasePlan> = {}): ScreenplayRebasePlan {
  const entries = overrides.entries ?? [entry()];
  return {
    planVersion: 1,
    offsetUnit: 'utf16-code-unit',
    projectId,
    screenplayId: 'screenplay-1',
    linkUpdatedAt: '2026-07-30T10:00:00.000Z',
    target: {
      screenplayVersion: 9,
      screenplayRevisionId: null,
      sourceTextHash: 'b'.repeat(64),
      sourceLength: 4_096,
    },
    sourceRevisions: [],
    entries,
    excluded: [],
    summary: {
      referenceCount: entries.length,
      autoCarryCount: entries.filter((item) => item.autoApplicable).length,
      decisionCount: entries.filter((item) => item.decisionRequired).length,
      byClassification: {
        unchanged: 0,
        'shifted-with-identical-text': 0,
        'materially-changed': 0,
        deleted: 0,
        ambiguous: 0,
      },
      excludedCount: 0,
    },
    budget: { maxSearchPasses: 128, searchPassesUsed: 2, exhausted: false },
    computedAt: '2026-07-30T12:00:00.000Z',
    fingerprint: 'c'.repeat(64),
    ...overrides,
  };
}

const applyPath = `/api/v1/projects/${projectId}/screenplay-rebase`;

/** Answers the preview read, and the apply write only if a test opted into one. */
function respond(value: ScreenplayRebasePlan | Error, applyResult?: unknown) {
  api.mockImplementation((path: string) => {
    if (path === applyPath) {
      if (applyResult === undefined) throw new Error('This test did not expect an apply request');
      return applyResult instanceof Error
        ? Promise.reject(applyResult)
        : Promise.resolve(applyResult);
    }
    if (path !== previewPath) throw new Error(`Unexpected request: ${String(path)}`);
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

/** The body the apply mutation sent, for tests that assert what a confirmation authorised. */
function applyBody(): { decisions: { action: string; sourceTextHash?: string }[] } {
  const call = api.mock.calls.find(([path]) => path === applyPath);
  if (!call) throw new Error('No apply request was sent');
  return JSON.parse((call[1] as { body: string }).body) as ReturnType<typeof applyBody>;
}

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={client}>
        <ScreenplayRebasePreviewDialog projectId={projectId} onClose={onClose} />
      </QueryClientProvider>,
    ),
  };
}

// Braces matter: an arrow that *returns* the mock registers it as a teardown hook, and vitest then
// calls it with no arguments at the end of every test.
beforeEach(() => {
  api.mockReset();
});
afterEach(cleanup);

describe('reviewing a rebase writes nothing', () => {
  it('reads the plan once and issues no other request at all', async () => {
    respond(plan());
    renderDialog();
    await screen.findByText(/1 range needs a decision/);

    // The whole point of #242: opening and completing a review must leave the breakdown untouched.
    expect(api).toHaveBeenCalledTimes(1);
    const [path, init] = api.mock.calls[0] as [string, { method?: string } | undefined];
    expect(path).toBe(previewPath);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('records a decision locally without sending anything', async () => {
    respond(plan());
    renderDialog();
    await screen.findByText(/1 range needs a decision/);
    expect(screen.getByText('0 of 1 decisions recorded')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Keep the current pin/ }));
    await waitFor(() => expect(screen.getByText('1 of 1 decisions recorded')).toBeInTheDocument());
    // Still exactly the one read. A decision is a choice, not a write.
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the dialog is closed after a review', async () => {
    respond(plan());
    const { onClose } = renderDialog();
    await screen.findByText(/1 range needs a decision/);
    fireEvent.click(screen.getByRole('radio', { name: /Keep the current pin/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('will not let the plan be applied until every reviewable range is answered', async () => {
    respond(plan());
    renderDialog();
    await screen.findByText(/1 range needs a decision/);

    // Offering a control the API would reject is what this repo's link state already refuses to do,
    // and here the rejected request would be one that moved pins nobody had looked at.
    expect(screen.getByRole('button', { name: 'Apply rebase' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Keep the current pin/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply rebase' })).toBeEnabled());
    // Enabling a button is still not a write.
    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe('applying a rebase', () => {
  it('sends only decisions the reviewer recorded, naming the candidate they chose', async () => {
    respond(plan(), { summary: { movedCount: 1 } });
    const { onClose } = renderDialog();
    await screen.findByText(/1 range needs a decision/);

    fireEvent.click(screen.getByRole('radio', { name: /Proposed/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply rebase' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Apply rebase' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const body = applyBody();
    expect(body).toMatchObject({ planVersion: 1, fingerprint: 'c'.repeat(64) });
    // The chosen candidate's own range and hash, straight off the plan — never an invented anchor.
    expect(body.decisions).toEqual([
      {
        itemSourceReferenceId: 'ref-1',
        action: 'retarget',
        source: { start: 0, end: 'A klaxon fades.'.length },
        sourceTextHash: 'a'.repeat(64),
      },
    ]);
  });

  it('sends a keep decision rather than omitting the reference', async () => {
    respond(plan(), { summary: { movedCount: 0 } });
    renderDialog();
    await screen.findByText(/1 range needs a decision/);
    fireEvent.click(screen.getByRole('radio', { name: /Keep the current pin/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply rebase' }));

    await waitFor(() => expect(applyBody().decisions).toHaveLength(1));
    // Omitting it would read on the server as "no decision", which for a reviewable range is a
    // refusal — the reviewer's explicit "leave it alone" has to travel as its own recorded answer.
    expect(applyBody().decisions[0]).toEqual({
      itemSourceReferenceId: 'ref-1',
      action: 'keep',
    });
  });

  it('records no decision for a range the engine carries on its own', async () => {
    const carried = entry({
      itemSourceReferenceId: 'ref-2',
      classification: 'shifted-with-identical-text',
      autoApplicable: true,
      decisionRequired: false,
    });
    respond(plan({ entries: [carried] }), { summary: { movedCount: 1 } });
    renderDialog();
    await screen.findByText('1 range carries over unchanged.');
    fireEvent.click(screen.getByRole('button', { name: 'Apply rebase' }));

    // A decision here would misrepresent an automatic move as a confirmed one in the audit trail.
    await waitFor(() => expect(applyBody().decisions).toEqual([]));
  });

  it('keeps the dialog open and explains itself when the apply is refused', async () => {
    respond(plan(), new Error('stale'));
    const { onClose } = renderDialog();
    await screen.findByText(/1 range needs a decision/);
    fireEvent.click(screen.getByRole('radio', { name: /Keep the current pin/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply rebase' }));

    expect(await screen.findByText(/The rebase was not applied/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the unhappy cases are told apart at a glance', () => {
  it('offers every candidate and proposes none when the text matches in several places', async () => {
    respond(
      plan({
        entries: [
          entry({
            classification: 'ambiguous',
            reason: 'multiple-identical-matches',
            proposed: null,
            candidates: [
              {
                ...excerpt('ECHO', 7),
                identicalText: true,
                atSourceOffset: false,
                shift: 1,
                contextCodeUnits: 0,
              },
              {
                ...excerpt('ECHO', 21),
                identicalText: true,
                atSourceOffset: false,
                shift: 15,
                contextCodeUnits: 0,
              },
            ],
          }),
        ],
      }),
    );
    renderDialog();
    expect(await screen.findByText('Needs a choice')).toBeInTheDocument();
    expect(
      screen.getByText(
        /appears in more than one place and the surrounding lines did not settle it/,
      ),
    ).toBeInTheDocument();
    // Two candidates plus "keep the current pin"; nothing is pre-selected on the reviewer's behalf.
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByText(/^Proposed/)).not.toBeInTheDocument();
  });

  it('says plainly that a deleted range has nothing to move to', async () => {
    respond(
      plan({
        entries: [
          entry({
            classification: 'deleted',
            reason: 'replacement-region-empty',
            proposed: null,
            candidates: [],
          }),
        ],
      }),
    );
    renderDialog();
    expect(await screen.findByText('Deleted')).toBeInTheDocument();
    expect(screen.getByText('The text is gone and nothing took its place.')).toBeInTheDocument();
    expect(
      screen.getByText(/proposes no new anchor, so the pin can only be kept as it is/),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });

  it('raises an alert when a pin disagrees with its own revision', async () => {
    respond(
      plan({
        entries: [
          entry({
            classification: 'ambiguous',
            reason: 'recorded-hash-mismatch',
            proposed: null,
            candidates: [],
            from: { ...entry().from, recordedTextHashMatches: false },
          }),
        ],
      }),
    );
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /recorded text does not match the revision it names/,
    );
    expect(screen.getByText(/no re-anchor can be trusted/)).toBeInTheDocument();
  });

  it('marks the plan’s own proposal on a materially changed range without auto-applying it', async () => {
    respond(plan());
    renderDialog();
    expect(await screen.findByText('Text changed')).toBeInTheDocument();
    expect(screen.getByText(/^Proposed ·/)).toBeInTheDocument();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Proposed/ }).checked).toBe(false);
  });
});

describe('the summary and the excluded bucket', () => {
  it('summarises auto-carried ranges instead of listing them as decisions', async () => {
    const carried = entry({
      itemSourceReferenceId: 'ref-2',
      classification: 'shifted-with-identical-text',
      reason: 'inside-unchanged-suffix',
      autoApplicable: true,
      decisionRequired: false,
    });
    respond(plan({ entries: [carried] }));
    renderDialog();
    expect(await screen.findByText('1 range carries over unchanged.')).toBeInTheDocument();
    expect(screen.getByText(/Every pinned range carries over on its own/)).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('lists unpinned and unavailable references apart, never as rebasable', async () => {
    respond(
      plan({
        entries: [],
        excluded: [
          { itemSourceReferenceId: 'ref-3', itemId: 'item-1', reason: 'unpinned' },
          { itemSourceReferenceId: 'ref-4', itemId: 'item-1', reason: 'pin-unavailable' },
        ],
        summary: {
          referenceCount: 0,
          autoCarryCount: 0,
          decisionCount: 0,
          byClassification: {
            unchanged: 0,
            'shifted-with-identical-text': 0,
            'materially-changed': 0,
            deleted: 0,
            ambiguous: 0,
          },
          excludedCount: 2,
        },
      }),
    );
    renderDialog();
    expect(await screen.findByText('Cannot be rebased')).toBeInTheDocument();
    expect(screen.getByText(/Pin it before it can be rebased/)).toBeInTheDocument();
    expect(screen.getByText(/pinned revision is no longer available/)).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('offers a retry rather than a half-rendered plan when the read fails', async () => {
    respond(new Error('nope'));
    renderDialog();
    expect(await screen.findByText('The rebase preview could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
