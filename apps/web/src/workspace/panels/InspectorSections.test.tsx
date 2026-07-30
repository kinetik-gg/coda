// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectorReferences } from './InspectorSections';
import type { BreakdownItem } from './types';

afterEach(cleanup);

function item(sourceReferences: BreakdownItem['sourceReferences']): BreakdownItem {
  return {
    id: 'item',
    entityTypeId: 'shot',
    parentId: null,
    title: 'Opening',
    displayCode: 'SH-1',
    description: null,
    version: 1,
    values: [],
    sourceReferences,
  };
}

describe('InspectorReferences pin staleness (#240)', () => {
  it('shows nothing extra for a legacy unpinned reference', () => {
    render(
      <InspectorReferences
        item={item([{ id: 'ref', sourceDocumentId: 'doc', startPage: 2, endPage: 4 }])}
      />,
    );
    expect(screen.getByText('Pages 2–4')).toBeTruthy();
    expect(screen.queryByText(/Screenplay pin/)).toBeNull();
  });

  it('reports a current pin distinctly from a stale one', () => {
    render(
      <InspectorReferences
        item={item([
          {
            id: 'ref',
            sourceDocumentId: 'doc',
            startPage: 2,
            endPage: 4,
            resolution: 'pinned',
            pin: null,
            staleness: 'current',
          },
        ])}
      />,
    );
    expect(screen.getByText('Screenplay pin current')).toBeTruthy();
  });

  it('flags a stale pin without altering the page range shown', () => {
    render(
      <InspectorReferences
        item={item([
          {
            id: 'ref',
            sourceDocumentId: 'doc',
            startPage: 2,
            endPage: 4,
            resolution: 'pinned',
            pin: null,
            staleness: 'stale',
          },
        ])}
      />,
    );
    expect(screen.getByText('Pages 2–4')).toBeTruthy();
    expect(screen.getByText('Screenplay pin stale — screenplay has changed')).toBeTruthy();
  });

  it('reports unavailable for a pin whose screenplay was trashed or purged', () => {
    render(
      <InspectorReferences
        item={item([
          {
            id: 'ref',
            sourceDocumentId: 'doc',
            startPage: 2,
            endPage: 4,
            resolution: 'unavailable',
            pin: null,
            staleness: null,
          },
        ])}
      />,
    );
    expect(screen.getByText('Screenplay pin unavailable')).toBeTruthy();
  });

  it('renders each reference independently when a page mixes pin states', () => {
    render(
      <InspectorReferences
        item={item([
          {
            id: 'ref-1',
            sourceDocumentId: 'doc',
            startPage: 1,
            endPage: 2,
            resolution: 'pinned',
            pin: null,
            staleness: 'stale',
          },
          { id: 'ref-2', sourceDocumentId: 'doc', startPage: 3, endPage: 5 },
        ])}
      />,
    );
    expect(screen.getByText('Screenplay pin stale — screenplay has changed')).toBeTruthy();
    expect(screen.getByText('Pages 3–5')).toBeTruthy();
  });
});

function reference(overrides: Partial<BreakdownItem['sourceReferences'][number]> = {}) {
  return { id: 'ref', sourceDocumentId: 'doc', startPage: 1, endPage: 2, ...overrides };
}

describe('InspectorReferences rebase entry point (#242)', () => {
  it('offers a review only once a pin is both pinned and stale', () => {
    const onReviewRebase = vi.fn();
    render(
      <InspectorReferences
        item={item([reference({ resolution: 'pinned', pin: null, staleness: 'stale' })])}
        onReviewRebase={onReviewRebase}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review rebase' }));
    expect(onReviewRebase).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a current pin', { resolution: 'pinned', pin: null, staleness: 'current' } as const],
    ['an unavailable pin', { resolution: 'unavailable', pin: null, staleness: null } as const],
    ['an unpinned reference', {} as const],
  ])('offers no review for %s', (_label, overrides) => {
    // Neither `unavailable` nor `unpinned` is stale — there is no pinned revision on one side of the
    // comparison — so offering a rebase would promise a decision the server would refuse to describe.
    render(<InspectorReferences item={item([reference(overrides)])} onReviewRebase={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Review rebase' })).toBeNull();
  });

  it('offers no review at all when the panel supplies no handler', () => {
    render(
      <InspectorReferences
        item={item([reference({ resolution: 'pinned', pin: null, staleness: 'stale' })])}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Review rebase' })).toBeNull();
  });
});
