export interface RestoreProgress {
  event: 'progress';
  phase: string;
  key?: string;
  index?: number;
  total?: number;
}

type RestoreMessage =
  | RestoreProgress
  | { status: 'complete'; appVersion?: string; createdAt?: string }
  | { status: 'error'; message?: string };

export interface RestoreResult {
  appVersion?: string;
  createdAt?: string;
}

const IMPORT_PATH = '/api/v1/setup/import';

/**
 * Upload a signed backup archive to the first-run import endpoint and drive the restore, surfacing
 * newline-delimited JSON progress as it streams back. Resolves once the server reports completion and
 * rejects with a clear message on any failure — a rejected setup token or an already-initialized
 * instance (before streaming), a signature/verification failure (a terminal error line), or a
 * truncated stream. The signature and format version are verified server-side before any write, so a
 * pre-completion failure leaves the target untouched.
 */
export async function streamSetupRestore(
  file: Blob,
  setupToken: string | undefined,
  onProgress: (progress: RestoreProgress) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<RestoreResult> {
  const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
  if (setupToken) headers['x-coda-setup-token'] = setupToken;
  const response = await fetchImpl(IMPORT_PATH, {
    method: 'POST',
    headers,
    body: file,
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(await problemDetail(response));
  if (!response.body) throw new Error('The server did not return a restore progress stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed: RestoreResult | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) completed = handleLine(line, onProgress) ?? completed;
      newlineIndex = buffer.indexOf('\n');
    }
    if (done) break;
  }
  if (!completed) {
    throw new Error('The restore ended before it completed. The instance was left uninitialized.');
  }
  return completed;
}

function handleLine(
  line: string,
  onProgress: (progress: RestoreProgress) => void,
): RestoreResult | undefined {
  const message = JSON.parse(line) as RestoreMessage;
  if ('event' in message && message.event === 'progress') {
    onProgress(message);
    return undefined;
  }
  if ('status' in message && message.status === 'error') {
    throw new Error(message.message ?? 'The restore failed.');
  }
  if ('status' in message && message.status === 'complete') {
    return { appVersion: message.appVersion, createdAt: message.createdAt };
  }
  return undefined;
}

async function problemDetail(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as { detail?: string; title?: string };
    return problem.detail ?? problem.title ?? 'The restore could not be started.';
  } catch {
    return 'The restore could not be started.';
  }
}
