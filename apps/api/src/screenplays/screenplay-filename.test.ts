import { describe, expect, it } from 'vitest';
import {
  fountainFilenameFromTitle,
  normalizeImportedFilename,
  safeDownloadFilename,
  titleFromFountain,
} from './screenplay-filename';

describe('screenplay filenames and imported titles', () => {
  it('creates portable Fountain filenames from screenplay titles', () => {
    expect(fountainFilenameFromTitle('Hujan di Jakarta')).toBe('hujan-di-jakarta.fountain');
    expect(fountainFilenameFromTitle('???')).toBe('untitled-screenplay.fountain');
  });

  it('removes client paths and unsafe attachment characters', () => {
    expect(normalizeImportedFilename('C:\\scripts\\Pilot.fountain')).toBe('Pilot.fountain');
    expect(safeDownloadFilename('Babak: Satu.fountain')).toBe('Babak_ Satu.fountain');
    expect(safeDownloadFilename('../bad"\r\nX-Evil: yes.fountain')).toBe(
      'bad_X-Evil_ yes.fountain',
    );
  });

  it('reads inline and multiline Fountain title-page titles', () => {
    expect(titleFromFountain('fallback.fountain', '\uFEFFTitle: The Long Road\r\nAuthor: A')).toBe(
      'The Long Road',
    );
    expect(titleFromFountain('fallback.fountain', 'Title:\n    A Tale\n    of Two Cities\n')).toBe(
      'A Tale of Two Cities',
    );
  });

  it('falls back to the imported filename when no title page exists', () => {
    expect(titleFromFountain('My Draft.fountain', 'INT. ROOM - DAY')).toBe('My Draft');
  });
});
