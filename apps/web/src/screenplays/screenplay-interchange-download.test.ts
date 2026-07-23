// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalFinalDraftFilename, downloadFinalDraft } from './screenplay-interchange-download';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Final Draft download', () => {
  it.each([
    ['draft.fountain', 'draft.fdx'],
    ['draft.spmd', 'draft.fdx'],
    ['Draft', 'Draft.fdx'],
  ])('normalizes %s', (input, expected) => {
    expect(canonicalFinalDraftFilename(input)).toBe(expected);
  });

  it('downloads serialized Final Draft XML', () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => 'blob:fdx');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    downloadFinalDraft('draft.fountain', 'INT. ROOM - DAY\n');

    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });
});
