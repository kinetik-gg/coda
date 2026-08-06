const tokenRoutes = new Set(['/accept-invitation', '/reset-password']);
const storagePrefix = 'coda:sensitive-route-token:';

interface RouteLocation {
  pathname: string;
  search: string;
  hash: string;
}

interface RouteHistory {
  state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

interface RouteTokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storageKey(pathname: string): string {
  return `${storagePrefix}${pathname}`;
}

function browserSessionStorage(): RouteTokenStorage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function readStoredToken(storage: RouteTokenStorage | undefined, pathname: string): string {
  try {
    return storage?.getItem(storageKey(pathname)) ?? '';
  } catch {
    return '';
  }
}

export function takeSensitiveRouteToken(
  location: RouteLocation,
  history: RouteHistory,
  storage: RouteTokenStorage | undefined = browserSessionStorage(),
): string {
  if (!tokenRoutes.has(location.pathname)) return '';
  const parameters = new URLSearchParams(location.search);
  const token = parameters.get('token') ?? '';
  if (!token) return readStoredToken(storage, location.pathname);
  try {
    storage?.setItem(storageKey(location.pathname), token);
  } catch {
    // The in-memory caller still receives the token when session storage is unavailable.
  }
  parameters.delete('token');
  const remaining = parameters.toString();
  history.replaceState(
    history.state,
    '',
    `${location.pathname}${remaining ? `?${remaining}` : ''}${location.hash}`,
  );
  return token;
}

export function clearSensitiveRouteToken(
  pathname: string,
  storage: RouteTokenStorage | undefined = browserSessionStorage(),
): void {
  try {
    storage?.removeItem(storageKey(pathname));
  } catch {
    // Clearing a consumed token is best-effort when browser storage is unavailable.
  }
}
