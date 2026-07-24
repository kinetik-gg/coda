import type { ProblemDetails } from '@coda/contracts';
import { beginApiActivity } from './api-activity';

function csrfToken(): string | undefined {
  const entry = document.cookie.split('; ').find((value) => value.startsWith('coda_csrf='));
  return entry ? decodeURIComponent(entry.slice('coda_csrf='.length)) : undefined;
}

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const csrf = csrfToken();
  if (csrf && !['GET', 'HEAD'].includes(init.method ?? 'GET')) headers.set('x-coda-csrf', csrf);
  const method = (init.method ?? 'GET').toUpperCase();
  const finishActivity = beginApiActivity(
    ['GET', 'HEAD'].includes(method) ? 'loading' : 'updating',
  );
  try {
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    if (!response.ok) throw new ApiError((await response.json()) as ProblemDetails);
    const payload = (await response.json()) as { data: T };
    return payload.data;
  } finally {
    finishActivity();
  }
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export async function apiCursorPage<T>(
  path: string,
  init: RequestInit = {},
): Promise<CursorPage<T>> {
  const headers = new Headers(init.headers);
  const finishActivity = beginApiActivity('loading');
  try {
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    if (!response.ok) throw new ApiError((await response.json()) as ProblemDetails);
    const payload = (await response.json()) as {
      data: T[];
      meta?: { nextCursor?: string | null };
    };
    return { items: payload.data, nextCursor: payload.meta?.nextCursor ?? null };
  } finally {
    finishActivity();
  }
}

/** An upload target the API issued, with the capability that decides how to send it. */
export interface UploadTarget {
  uploadUrl: string;
  /**
   * True when the backend can receive the bytes directly (an S3 presigned PUT);
   * false when the upload is proxied through the app. The client selects the
   * path from this flag instead of assuming presigned S3.
   */
  directUpload: boolean;
}

/**
 * Transfers `file` to the URL the API issued, choosing the path from the
 * advertised {@link UploadTarget.directUpload} capability rather than assuming an
 * S3 presigned PUT.
 */
export async function uploadFile(target: UploadTarget, file: File): Promise<void> {
  if (target.directUpload) {
    await uploadToSignedUrl(target.uploadUrl, file);
    return;
  }
  await uploadProxied(target.uploadUrl, file);
}

/** Direct upload to a presigned object-store URL (conditional create via If-None-Match). */
export async function uploadToSignedUrl(url: string, file: File): Promise<void> {
  const finishActivity = beginApiActivity('updating');
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': file.type, 'if-none-match': '*' },
      body: file,
    });
    if (!response.ok) throw new Error('The object store rejected the upload.');
  } finally {
    finishActivity();
  }
}

/** App-proxied upload; the same-origin API enforces the size/type/conditional-create checks. */
async function uploadProxied(url: string, file: File): Promise<void> {
  const finishActivity = beginApiActivity('updating');
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error('The upload was rejected.');
  } finally {
    finishActivity();
  }
}
