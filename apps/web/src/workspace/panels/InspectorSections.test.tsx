// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
