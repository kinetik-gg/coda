// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalFountainFilename, downloadFountain } from './fountain-download';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('canonicalFountainFilename', () => {
  it.each([
    ['draft.txt', 'draft.fountain'],
    ['draft.spmd', 'draft.fountain'],
    ['draft.fountain', 'draft.fountain'],
  ])('exports %s as %s', (source, expected) => {
    expect(canonicalFountainFilename(source)).toBe(expected);
  });

  it.each([
    ['', 'screenplay.fountain'],
    ['   ', 'screenplay.fountain'],
    ['Working Draft', 'Working Draft.fountain'],
  ])('uses a safe canonical name for %j', (source, expected) => {
    expect(canonicalFountainFilename(source)).toBe(expected);
  });

  it('downloads the exact current source and revokes the object URL', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn((blob: Blob) => {
      expect(blob).toBeInstanceOf(Blob);
      return 'blob:screenplay';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const createElement = vi.spyOn(document, 'createElement');

    downloadFountain('draft.txt', 'INT. ROOM - DAY\r\nExact source');

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('text/plain;charset=utf-8');
    const anchor = createElement.mock.results.find(
      (result) => result.value instanceof HTMLAnchorElement,
    )?.value as HTMLAnchorElement;
    expect(anchor.download).toBe('draft.fountain');
    expect(anchor.href).toBe('blob:screenplay');
    expect(click).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:screenplay');
  });
});
