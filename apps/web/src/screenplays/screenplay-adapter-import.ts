import { api } from '../api';
import type { ScreenplayImportFormat } from './screenplay-import-formats';
import type { Screenplay } from './types';

interface ScreenplayImportArtifactReservation {
  id: string;
  version: number;
  uploadUrl: string;
  directUpload: boolean;
}

interface ScreenplayImportArtifactConversion {
  convertedFountain: string;
}

/**
 * Uploads the exact original bytes to the reservation's `uploadUrl`, matching
 * the MIME type declared at reservation time exactly (a signed S3 upload
 * rejects a mismatched `content-type`) rather than trusting the browser's own,
 * unreliable guess at `file.type`.
 */
async function uploadOriginalBytes(
  target: Pick<ScreenplayImportArtifactReservation, 'uploadUrl' | 'directUpload'>,
  file: File,
  mimeType: string,
): Promise<void> {
  const response = await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': mimeType, 'if-none-match': '*' },
    body: file,
    ...(target.directUpload ? {} : { credentials: 'same-origin' as const }),
  });
  if (!response.ok) throw new Error('The screenplay file could not be uploaded.');
}

function titleFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^./]+$/u, '').trim();
  return stem === '' ? 'Untitled screenplay' : stem.slice(0, 160);
}

/**
 * Imports `file` through the bounded server-side adapter runtime (#246):
 * conversion for every format in `screenplay-import-formats.ts` marked
 * `serverAdapter: true` (FDX, HTML, DOCX, PDF, RTF) must not happen on this
 * thread, either because it needs a parser too heavy to ship to the browser
 * or because a hostile document could hang or exhaust a browser tab.
 *
 * The import-artifact pipeline is scoped to an existing screenplay, so this
 * creates a placeholder screenplay first, retains the original bytes and a
 * conversion report through the artifact, then applies the resulting
 * Fountain as the screenplay's real content. A failure at any step after the
 * placeholder is created rolls the placeholder back rather than leaving an
 * empty screenplay in the library.
 */
export async function importScreenplayViaAdapter(
  file: File,
  format: Pick<ScreenplayImportFormat, 'sourceFormat' | 'mimeTypes'>,
): Promise<string> {
  const mimeType = format.mimeTypes[0] ?? 'application/octet-stream';
  const screenplay = await api<Screenplay>('/api/v1/screenplays', {
    method: 'POST',
    body: JSON.stringify({ title: titleFromFilename(file.name) }),
  });
  try {
    const reservation = await api<ScreenplayImportArtifactReservation>(
      `/api/v1/screenplays/${screenplay.id}/import-artifacts`,
      {
        method: 'POST',
        body: JSON.stringify({
          originalFilename: file.name,
          mimeType,
          sizeBytes: file.size,
          sourceFormat: format.sourceFormat,
        }),
      },
    );
    await uploadOriginalBytes(reservation, file, mimeType);
    const converted = await api<ScreenplayImportArtifactConversion>(
      `/api/v1/screenplays/${screenplay.id}/import-artifacts/${reservation.id}/convert`,
      { method: 'POST', body: JSON.stringify({ version: reservation.version }) },
    );
    await api<Screenplay>(`/api/v1/screenplays/${screenplay.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sourceText: converted.convertedFountain,
        version: screenplay.version,
      }),
    });
    return screenplay.id;
  } catch (error) {
    await api(`/api/v1/screenplays/${screenplay.id}`, { method: 'DELETE' }).catch(() => undefined);
    throw error;
  }
}
