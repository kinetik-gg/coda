// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateScreenplayPreviewPageWidth, ScreenplayPreview } from './ScreenplayPreview';
import { screenplayPaper } from './screenplay-paper';
import type { ScreenplaySceneOutlineItem } from './screenplay-preview-model';

const source = [
  'Title: Blue Hour',
  '',
  'INT. ROOM - DAY #1#',
  '',
  'ADA',
  'Hello.',
  '',
  'EXT. STREET - NIGHT #2#',
].join('\n');

const scrollIntoView = vi.fn();

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ScreenplayPreview', () => {
  it('renders physically constrained pages and publishes scene outline data', async () => {
    const onOutlineChange = vi.fn<(scenes: readonly ScreenplaySceneOutlineItem[]) => void>();
    render(<ScreenplayPreview source={source} onOutlineChange={onOutlineChange} />);

    expect(screen.getByRole('region', { name: 'Screenplay preview' })).toHaveAttribute(
      'data-paper-size',
      'letter',
    );
    expect(screen.getByRole('article', { name: 'Title page' })).toBeInTheDocument();
    const firstBodyPage = screen.getByRole('article', { name: 'Page 1' });
    expect(firstBodyPage).toBeInTheDocument();
    expect(firstBodyPage.querySelector('[class*="pageNumber"]')).toBeNull();
    expect(screen.getByText('Hello.')).toBeInTheDocument();
    await waitFor(() => expect(onOutlineChange).toHaveBeenCalledOnce());
    const outline = onOutlineChange.mock.calls[0]?.[0];
    expect(outline?.map(({ label }) => label)).toEqual(['INT. ROOM - DAY', 'EXT. STREET - NIGHT']);
    expect(outline?.every(({ sourceStart }) => Number.isInteger(sourceStart))).toBe(true);
  });

  it('switches to the A4 physical aspect ratio', () => {
    render(<ScreenplayPreview source={source} paperSize="a4" />);
    expect(screen.getByRole('region', { name: 'Screenplay preview' })).toHaveAttribute(
      'data-paper-size',
      'a4',
    );
    expect(
      screen
        .getByRole('article', { name: 'Page 1' })
        .style.getPropertyValue('--screenplay-page-aspect'),
    ).toBe('595.28 / 841.89');
    expect(screen.getByRole('document', { name: 'Page 1 content' }).getAttribute('viewBox')).toBe(
      '0 0 595.28 841.89',
    );
  });

  it('exposes controlled fit, zoom, and page-view modes without changing page geometry', () => {
    const result = render(
      <ScreenplayPreview source={source} paperSize="a4" zoom="fit-page" pageView="two-page" />,
    );
    const preview = screen.getByRole('region', { name: 'Screenplay preview' });
    const bodyPage = screen.getByRole('article', { name: 'Page 1' });

    expect(preview).toHaveAttribute('data-preview-zoom', 'fit-page');
    expect(preview).toHaveAttribute('data-page-view', 'two-page');
    expect(bodyPage.style.getPropertyValue('--screenplay-page-aspect')).toBe('595.28 / 841.89');
    expect(screen.getByRole('document', { name: 'Page 1 content' })).toHaveAttribute(
      'viewBox',
      '0 0 595.28 841.89',
    );

    result.rerender(
      <ScreenplayPreview source={source} paperSize="a4" zoom={150} pageView="single-page" />,
    );
    expect(preview).toHaveAttribute('data-preview-zoom', '150');
    expect(preview).toHaveAttribute('data-page-view', 'single-page');
    expect(preview.style.getPropertyValue('--screenplay-preview-preset-width')).toBe('892.92px');
    expect(bodyPage.style.getPropertyValue('--screenplay-page-aspect')).toBe('595.28 / 841.89');
  });

  it('fits pages to available width or height and accounts for two-page spreads', () => {
    const paper = screenplayPaper('a4');
    expect(
      calculateScreenplayPreviewPageWidth(
        { width: 1000, height: 800 },
        paper,
        'fit-width',
        'single-page',
      ),
    ).toBe(944);
    expect(
      calculateScreenplayPreviewPageWidth(
        { width: 1000, height: 800 },
        paper,
        'fit-width',
        'two-page',
      ),
    ).toBe(463);
    expect(
      calculateScreenplayPreviewPageWidth(
        { width: 1000, height: 800 },
        paper,
        'fit-page',
        'single-page',
      ),
    ).toBeCloseTo(732 * (595.28 / 841.89));
  });

  it('syncs an active editor offset without reporting the programmatic preview scroll', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const onSourceOffsetChange = vi.fn();
    const result = render(
      <ScreenplayPreview source={source} onSourceOffsetChange={onSourceOffsetChange} />,
    );
    const scroller = result.container.querySelector('[class*="pages"]') as HTMLElement;
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this === scroller) return rect(100);
      return (this as HTMLElement | SVGElement).dataset.sourceStart ===
        String(source.indexOf('Hello.'))
        ? rect(600)
        : rect(0);
    });
    result.rerender(
      <ScreenplayPreview
        source={source}
        activeSourceOffset={source.indexOf('Hello.')}
        onSourceOffsetChange={onSourceOffsetChange}
      />,
    );
    await waitFor(() => expect(scroller.scrollTop).toBe(410));
    fireEvent.scroll(scroller);
    expect(onSourceOffsetChange).not.toHaveBeenCalled();
    frames.forEach((callback) => callback(0));
  });

  it('keeps a persisted disabled scroll-sync setting from moving the preview', async () => {
    const result = render(
      <ScreenplayPreview
        source={source}
        activeSourceOffset={source.indexOf('Hello.')}
        scrollSync={false}
      />,
    );
    const scroller = result.container.querySelector('[class*="pages"]') as HTMLElement;
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this === scroller) return rect(100);
      return (this as HTMLElement | SVGElement).dataset.sourceStart ===
        String(source.indexOf('Hello.'))
        ? rect(600)
        : rect(0);
    });

    result.rerender(
      <ScreenplayPreview
        source={source}
        activeSourceOffset={source.indexOf('Hello.')}
        activeSourceSelection={{
          anchor: source.indexOf('Hello.'),
          head: source.indexOf('Hello.'),
          from: source.indexOf('Hello.'),
          to: source.indexOf('Hello.'),
        }}
        scrollSync={false}
      />,
    );

    await waitFor(() => expect(scroller.scrollTop).toBe(0));
  });

  it('reports the block nearest the top when the preview scrolls', () => {
    const onSourceOffsetChange = vi.fn();
    const result = render(
      <ScreenplayPreview source={source} onSourceOffsetChange={onSourceOffsetChange} />,
    );
    const scroller = result.container.querySelector('[class*="pages"]') as HTMLElement;
    const blocks = Array.from(scroller.querySelectorAll<HTMLElement>('[data-source-start]'));
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(0));
    const blockRects = blocks.map((block, index) =>
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(index * 100)),
    );
    fireEvent.scroll(scroller);
    expect(onSourceOffsetChange).toHaveBeenCalledWith(Number(blocks[0]?.dataset.sourceStart));
    fireEvent.scroll(scroller);
    expect(onSourceOffsetChange).toHaveBeenCalledOnce();

    blockRects[1]?.mockReturnValue(rect(20));
    fireEvent.scroll(scroller);
    expect(onSourceOffsetChange).toHaveBeenLastCalledWith(Number(blocks[1]?.dataset.sourceStart));
  });

  it('reports direct block activation and renders a useful blank page', () => {
    const onSourceOffsetChange = vi.fn();
    const result = render(
      <ScreenplayPreview source={source} onSourceOffsetChange={onSourceOffsetChange} />,
    );
    fireEvent.click(screen.getByText('Hello.'));
    expect(onSourceOffsetChange).toHaveBeenCalledWith(source.indexOf('Hello.'));
    result.rerender(<ScreenplayPreview source="" />);
    expect(screen.getByText('Start writing to preview your screenplay.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Jump to scene' })).not.toBeInTheDocument();
  });

  it('highlights an editor selection and reports exact half-open preview text offsets', () => {
    const onSourceSelectionChange = vi.fn();
    const textStart = source.indexOf('Hello.');
    render(
      <ScreenplayPreview
        source={source}
        activeSourceSelection={{
          anchor: textStart,
          head: textStart + 5,
          from: textStart,
          to: textStart + 5,
        }}
        onSourceSelectionChange={onSourceSelectionChange}
      />,
    );

    const dialogueText = screen.getByText('Hello.');
    const dialogue = dialogueText.closest('[data-layout-line]');
    const highlight = dialogue?.parentElement?.querySelector('[class*="sourceHighlight"]');
    const textNode = dialogueText.firstChild;
    expect(highlight).toHaveAttribute('width', String(5 * ((1228 / 2048) * 12)));
    expect(dialogue).not.toBeNull();
    expect(textNode).not.toBeNull();
    const range = document.createRange();
    range.setStart(textNode!, 1);
    range.setEnd(textNode!, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(dialogue!);

    expect(onSourceSelectionChange).toHaveBeenCalledWith({
      anchor: textStart + 1,
      head: textStart + 4,
      from: textStart + 1,
      to: textStart + 4,
    });
  });

  it('places prewrapped lines at canonical point coordinates without browser reflow', () => {
    render(<ScreenplayPreview source={source} paperSize="a4" />);
    const dialogue = screen.getByText('Hello.').closest('[data-layout-line]');
    expect(dialogue).toHaveAttribute('x', '173.25');
    expect(dialogue).toHaveAttribute('text-anchor', 'start');
    expect(dialogue).toHaveAttribute('xml:space', 'preserve');
    expect(dialogue).toHaveAttribute('data-source-start', String(source.indexOf('Hello.')));
  });

  it('renders one caret on the following line at a shared hard-wrap boundary', () => {
    const wrappedSource = 'A'.repeat(61);
    const result = render(
      <ScreenplayPreview
        source={wrappedSource}
        paperSize="a4"
        activeSourceSelection={{ anchor: 60, head: 60, from: 60, to: 60 }}
      />,
    );

    expect(result.container.querySelectorAll('[class*="previewCaret"]')).toHaveLength(1);
    expect(
      result.container.querySelector('[class*="previewCaret"]')?.parentElement,
    ).toHaveTextContent('A');
  });
});

function rect(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 100,
    bottom: top + 20,
    left: 0,
    width: 100,
    height: 20,
    toJSON: () => ({}),
  };
}
