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

export async function uploadToSignedUrl(url: string, file: File): Promise<void> {
  const finishActivity = beginApiActivity('updating');
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    });
    if (!response.ok) throw new Error('The object store rejected the upload.');
  } finally {
    finishActivity();
  }
}
