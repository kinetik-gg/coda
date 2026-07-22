// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildScreenplayContext } from './screenplay-context-model';
import { buildScreenplayPreview, type ScreenplayPreviewModel } from './screenplay-preview-model';
import { buildScreenplayStatistics } from './screenplay-statistics-model';
import { ScreenplayStatisticsPanel } from './ScreenplayStatisticsPanel';

afterEach(cleanup);

const source = `INT. STUDIO - DAY

ALICE
This is the opening line.

BOB
And this is the reply.
`;

const preview: ScreenplayPreviewModel = {
  paperSize: 'a4',
  printableBlocks: [],
  scenes: [],
  pages: [
    {
      id: 'page-1',
      pageNumber: 1,
      blocks: [],
      lines: [
        {
          id: 'line-1',
          blockId: 'block-1',
          kind: 'scene-heading',
          text: 'INT. STUDIO - DAY',
          x: 0,
          baselineY: 0,
          width: 0,
          columns: 55,
          align: 'left',
          font: 'bold',
          sourceStart: 0,
          sourceEnd: 17,
        },
      ],
    },
  ],
};

function statistics(sourceText: string, model = buildScreenplayPreview(sourceText)) {
  return buildScreenplayStatistics(sourceText, buildScreenplayContext(sourceText), model);
}

describe('ScreenplayStatisticsPanel', () => {
  it('renders the selected compact view and reveals a screenplay entity', () => {
    const onReveal = vi.fn();
    render(
      <ScreenplayStatisticsPanel
        model={statistics(source, preview)}
        view="characters"
        onReveal={onReveal}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /ALICE/u }));

    expect(onReveal).toHaveBeenCalledWith(source.indexOf('ALICE'));
    expect(screen.getByText(/does not prove physical presence/u)).toBeTruthy();
    expect(screen.getAllByText(/Avg 5\.0 words\/block/u)).toHaveLength(2);
    expect(screen.getAllByText(/est\. speaking 0\.04 min at 130 wpm/u)).toHaveLength(2);
  });

  it('defaults to the overview without rendering a second control header', () => {
    render(
      <ScreenplayStatisticsPanel model={statistics(source, preview)} onReveal={() => undefined} />,
    );

    expect(screen.getByRole('region', { name: 'Screenplay totals' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Reading estimates')).toBeInTheDocument();
    expect(screen.getByText('200 wpm')).toBeInTheDocument();
    expect(screen.getByText('130 wpm')).toBeInTheDocument();
  });

  it('renders scene pacing, structural tags, and scene navigation', () => {
    const richSource = `INT. STUDIO - DAY

ALICE
We need to begin now.

BOB
I am ready.

EXT. PARK - NIGHT

ALICE crosses the empty park and studies the locked gate.
`;
    const onReveal = vi.fn();
    render(
      <ScreenplayStatisticsPanel
        model={statistics(richSource, buildScreenplayPreview(richSource, { paperSize: 'a4' }))}
        view="scenes"
        onReveal={onReveal}
      />,
    );

    expect(screen.getByRole('region', { name: 'Scene pacing summary' })).toBeInTheDocument();
    expect(screen.getByText('No dialogue')).toBeInTheDocument();
    expect(screen.getByText('no dialogue')).toBeInTheDocument();
    expect(screen.getAllByText(/dialogue density/u)).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /EXT\. PARK - NIGHT/u }));
    expect(onReveal).toHaveBeenCalledWith(richSource.indexOf('EXT. PARK - NIGHT'));
  });

  it('renders location, setting, and time shares with navigable structured rows', () => {
    const richSource = `INT. STUDIO - DAY

ALICE
Hello.

EXT. PARK - NIGHT

BOB
Goodbye.
`;
    const onReveal = vi.fn();
    render(
      <ScreenplayStatisticsPanel
        model={statistics(richSource)}
        view="locations"
        onReveal={onReveal}
      />,
    );

    expect(screen.getByText('Interior / exterior')).toBeInTheDocument();
    expect(screen.getByText('Time of day')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Location reuse summary' })).toBeInTheDocument();
    expect(screen.getByText('Avg scenes/location')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /STUDIO/u }));
    fireEvent.click(screen.getByRole('button', { name: /NIGHT/u }));
    expect(onReveal).toHaveBeenNthCalledWith(1, richSource.indexOf('STUDIO'));
    expect(onReveal).toHaveBeenNthCalledWith(2, richSource.indexOf('NIGHT'));
  });

  it('shows pacing distribution and speaking co-occurrence', () => {
    const richSource = `INT. STUDIO - DAY

ALICE
Hello.

BOB
Hi.
`;
    render(
      <ScreenplayStatisticsPanel
        model={statistics(richSource)}
        view="structure"
        onReveal={() => undefined}
      />,
    );

    expect(screen.getByText('Pacing distribution')).toBeInTheDocument();
    expect(screen.getByText('ALICE + BOB')).toBeInTheDocument();
    expect(screen.getByText(/1 scenes ·\s*100%/u)).toBeInTheDocument();
    expect(screen.getByText('Structural consistency')).toBeInTheDocument();
    expect(screen.getByText('Repeated language')).toBeInTheDocument();
  });

  it('reveals repeated language at its first source occurrence', () => {
    const repeatedSource = `INT. ROOM - DAY

Repeat this phrase, repeat this phrase.
`;
    const onReveal = vi.fn();
    render(
      <ScreenplayStatisticsPanel
        model={statistics(repeatedSource)}
        view="structure"
        onReveal={onReveal}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'repeat2×' }));
    expect(onReveal).toHaveBeenCalledWith(repeatedSource.indexOf('Repeat'));
    expect(screen.getByRole('button', { name: 'repeat this phrase2×' })).toBeInTheDocument();
  });

  it.each([
    ['characters', 'No character cues found.'],
    ['scenes', 'No scene headings found.'],
    ['locations', 'No structured data found.'],
    ['structure', 'No shared speaking scenes found.'],
  ] as const)('renders the %s empty state', (view, emptyLabel) => {
    const emptyPreview: ScreenplayPreviewModel = {
      paperSize: 'letter',
      pages: [],
      printableBlocks: [],
      scenes: [],
    };
    render(
      <ScreenplayStatisticsPanel
        model={statistics('', emptyPreview)}
        view={view}
        onReveal={() => undefined}
      />,
    );

    expect(screen.getAllByText(emptyLabel).length).toBeGreaterThan(0);
  });
});
