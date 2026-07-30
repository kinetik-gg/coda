import { api } from '../api';
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
 * Uploads the exact FDX bytes to the reservation's `uploadUrl`, matching the
 * `application/xml` MIME type declared at reservation time exactly (a signed
 * S3 upload rejects a mismatched `content-type`) rather than trusting the
 * browser's own, unreliable guess at `file.type` for `.fdx`.
 */
async function uploadFdxBytes(
  target: Pick<ScreenplayImportArtifactReservation, 'uploadUrl' | 'directUpload'>,
  file: File,
): Promise<void> {
  const response = await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/xml', 'if-none-match': '*' },
    body: file,
    ...(target.directUpload ? {} : { credentials: 'same-origin' as const }),
  });
  if (!response.ok) throw new Error('The Final Draft file could not be uploaded.');
}

function titleFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^./]+$/u, '').trim();
  return stem === '' ? 'Untitled screenplay' : stem.slice(0, 160);
}

/**
 * FDX conversion now runs server-side inside the bounded adapter runtime
 * (#246) instead of synchronously on this thread. The import-artifact
 * pipeline is scoped to an existing screenplay, so this creates a placeholder
 * screenplay first, retains the original XML and a conversion report through
 * the artifact, then applies the resulting Fountain as the screenplay's real
 * content. A failure at any step after the placeholder is created rolls the
 * placeholder back rather than leaving an empty screenplay in the library.
 */
export async function importFdxScreenplay(file: File): Promise<string> {
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
          mimeType: 'application/xml',
          sizeBytes: file.size,
          sourceFormat: 'final-draft',
        }),
      },
    );
    await uploadFdxBytes(reservation, file);
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
