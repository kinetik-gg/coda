import { describe, expect, it } from 'vitest';
import {
  SCREENPLAY_IMPORT_ACCEPT,
  SCREENPLAY_IMPORT_EXTENSION_PATTERN,
  SCREENPLAY_IMPORT_FORMATS,
  screenplayImportFormatFor,
} from './screenplay-import-formats';

describe('SCREENPLAY_IMPORT_EXTENSION_PATTERN', () => {
  it('matches every registered extension, case-insensitively', () => {
    for (const format of SCREENPLAY_IMPORT_FORMATS) {
      for (const extension of format.extensions) {
        expect(SCREENPLAY_IMPORT_EXTENSION_PATTERN.test(`script${extension}`)).toBe(true);
        expect(SCREENPLAY_IMPORT_EXTENSION_PATTERN.test(`script${extension.toUpperCase()}`)).toBe(
          true,
        );
      }
    }
  });

  it('rejects an unregistered extension', () => {
    expect(SCREENPLAY_IMPORT_EXTENSION_PATTERN.test('script.pages')).toBe(false);
    expect(SCREENPLAY_IMPORT_EXTENSION_PATTERN.test('script')).toBe(false);
  });
});

describe('SCREENPLAY_IMPORT_ACCEPT', () => {
  it('lists every registered extension and MIME type', () => {
    const tokens = SCREENPLAY_IMPORT_ACCEPT.split(',');
    for (const format of SCREENPLAY_IMPORT_FORMATS) {
      for (const extension of format.extensions) expect(tokens).toContain(extension);
      for (const mimeType of format.mimeTypes) expect(tokens).toContain(mimeType);
    }
  });

  it('includes the four adapters this issue wires up, with a MIME type distinct from the old text-only set', () => {
    expect(SCREENPLAY_IMPORT_ACCEPT).toContain('.html');
    expect(SCREENPLAY_IMPORT_ACCEPT).toContain('.docx');
    expect(SCREENPLAY_IMPORT_ACCEPT).toContain('.pdf');
    expect(SCREENPLAY_IMPORT_ACCEPT).toContain('.rtf');
    expect(SCREENPLAY_IMPORT_ACCEPT).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(SCREENPLAY_IMPORT_ACCEPT).toContain('application/pdf');
  });
});

describe('screenplayImportFormatFor', () => {
  it('finds the format for a recognized extension, case-insensitively and with a path prefix', () => {
    expect(screenplayImportFormatFor('script.PDF')?.sourceFormat).toBe('pdf');
    expect(screenplayImportFormatFor('/tmp/uploads/script.docx')?.sourceFormat).toBe('docx');
  });

  it('returns undefined for an unrecognized or missing extension', () => {
    expect(screenplayImportFormatFor('script.pages')).toBeUndefined();
    expect(screenplayImportFormatFor('script')).toBeUndefined();
  });

  it('marks every adapter-registered format as server-routed', () => {
    for (const sourceFormat of ['final-draft', 'html', 'docx', 'pdf', 'rtf']) {
      const format = SCREENPLAY_IMPORT_FORMATS.find((entry) => entry.sourceFormat === sourceFormat);
      expect(format?.serverAdapter).toBe(true);
    }
  });
});
