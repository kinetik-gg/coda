// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument }));

import { PdfViewer } from './PdfViewer';

class ImmediateResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as never);
  }
  disconnect() {}
  unobserve() {}
}

class ImmediateIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as never);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds = [];
}

function pdfFixture() {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    cleanup: vi.fn(),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  };
  const document = { numPages: 2, getPage: vi.fn().mockResolvedValue(page), destroy: vi.fn() };
  return { page, document, loadingTask: { promise: Promise.resolve(document), destroy: vi.fn() } };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ImmediateResizeObserver);
  vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(1);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 820,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => ({
      getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
      putImageData: vi.fn(),
    })),
  });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) =>
      name.includes('body') || name.includes('panel') ? '#101010' : '#f0f0f0',
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
});

describe('PdfViewer', () => {
  it('loads, measures, lazily renders, dark-maps, and reports visible pages', async () => {
    const fixture = pdfFixture();
    getDocument.mockReturnValue(fixture.loadingTask);
    document.documentElement.dataset.theme = 'coda-dark';
    const onPageCount = vi.fn();
    const onPageChange = vi.fn();
    const { container, rerender } = render(
      <PdfViewer
        url="https://objects.test/script.pdf"
        page={1}
        darkView
        zoom={1.25}
        onPageCount={onPageCount}
        onPageChange={onPageChange}
      />,
    );
    await waitFor(() => expect(onPageCount).toHaveBeenCalledWith(2));
    await waitFor(() => expect(screen.getAllByLabelText(/PDF page/)).toHaveLength(2));
    await waitFor(() => expect(fixture.page.render).toHaveBeenCalled());

    const positions = container.querySelectorAll('[class*="pagePosition"]');
    Object.defineProperty(positions[0], 'offsetTop', { configurable: true, value: 0 });
    Object.defineProperty(positions[1], 'offsetTop', { configurable: true, value: 500 });
    const viewer = container.firstElementChild as HTMLElement;
    Object.defineProperty(viewer, 'scrollTop', { configurable: true, value: 600 });
    fireEvent.scroll(viewer);
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(
      <PdfViewer
        url="https://objects.test/script.pdf"
        page={2}
        darkView={false}
        onPageCount={onPageCount}
      />,
    );
    expect(viewer).toHaveAttribute('aria-busy', 'false');
  });

  it('renders document loading failures and destroys an unfinished task', async () => {
    const destroy = vi.fn();
    getDocument.mockReturnValue({ promise: Promise.reject(new Error('Unreadable PDF')), destroy });
    const { unmount } = render(<PdfViewer url="bad.pdf" page={1} onPageCount={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unreadable PDF');
    unmount();
    expect(destroy).toHaveBeenCalled();
  });
});
