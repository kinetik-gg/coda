export type ApiActivityKind = 'loading' | 'updating';

export interface ApiActivitySnapshot {
  loading: number;
  updating: number;
}

const activeRequests = new Map<number, ApiActivityKind>();
const listeners = new Set<() => void>();
let nextRequestId = 0;
let snapshot: ApiActivitySnapshot = { loading: 0, updating: 0 };

function publish(): void {
  let loading = 0;
  let updating = 0;
  for (const kind of activeRequests.values()) {
    if (kind === 'loading') loading += 1;
    else updating += 1;
  }
  snapshot = { loading, updating };
  for (const listener of listeners) listener();
}

export function beginApiActivity(kind: ApiActivityKind): () => void {
  const requestId = ++nextRequestId;
  activeRequests.set(requestId, kind);
  publish();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    activeRequests.delete(requestId);
    publish();
  };
}

export function subscribeApiActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getApiActivitySnapshot(): ApiActivitySnapshot {
  return snapshot;
}
