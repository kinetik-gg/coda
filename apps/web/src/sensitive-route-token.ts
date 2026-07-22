const tokenRoutes = new Set(['/accept-invitation', '/reset-password']);

interface RouteLocation {
  pathname: string;
  search: string;
  hash: string;
}

interface RouteHistory {
  state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export function takeSensitiveRouteToken(location: RouteLocation, history: RouteHistory): string {
  if (!tokenRoutes.has(location.pathname)) return '';
  const parameters = new URLSearchParams(location.search);
  const token = parameters.get('token') ?? '';
  if (!token) return '';
  parameters.delete('token');
  const remaining = parameters.toString();
  history.replaceState(
    history.state,
    '',
    `${location.pathname}${remaining ? `?${remaining}` : ''}${location.hash}`,
  );
  return token;
}
