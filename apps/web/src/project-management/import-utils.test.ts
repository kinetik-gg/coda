// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readImportFile } from './import-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('project import reader', () => {
  it('reads text files and reports completion', async () => {
    const progress = vi.fn();
    await expect(readImportFile(new File(['{"ok":true}'], 'project.json'), progress)).resolves.toBe(
      '{"ok":true}',
    );
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it('reports readable failures without leaking browser details', async () => {
    class FailingReader {
      onprogress: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      result: string | ArrayBuffer | null = null;
      readAsText() {
        this.onerror?.();
      }
    }
    vi.stubGlobal('FileReader', FailingReader);
    await expect(readImportFile(new File(['x'], 'project.json'), vi.fn())).rejects.toThrow(
      'The selected import file could not be read.',
    );
  });

  it('rejects non-text reader results and handles computable progress', async () => {
    class BinaryReader {
      onprogress: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      result: string | ArrayBuffer | null = new ArrayBuffer(1);
      readAsText() {
        this.onprogress?.({
          lengthComputable: true,
          loaded: 1,
          total: 2,
        } as ProgressEvent<FileReader>);
        this.onload?.();
      }
    }
    vi.stubGlobal('FileReader', BinaryReader);
    const progress = vi.fn();
    await expect(readImportFile(new File(['x'], 'project.json'), progress)).rejects.toThrow(
      'The selected import file is not text.',
    );
    expect(progress).toHaveBeenCalledWith(50);
  });
});
