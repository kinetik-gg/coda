import type { Env } from './env';

type BrowserOriginConfig = Pick<Env, 'APP_ORIGIN' | 'DEV_ALLOWED_ORIGINS' | 'NODE_ENV'>;

export function isBrowserOriginAllowed(
  origin: string | undefined,
  config: BrowserOriginConfig,
): boolean {
  if (!origin) return false;
  try {
    const candidate = new URL(origin).origin;
    if (candidate === new URL(config.APP_ORIGIN).origin) return true;
    return config.NODE_ENV !== 'production' && config.DEV_ALLOWED_ORIGINS.includes(candidate);
  } catch {
    return false;
  }
}

export function requiresAllowedBrowserOrigin(method: string, pathname: string): boolean {
  const normalizedMethod = method.toUpperCase();
  const normalizedPathname = pathname.toLowerCase();
  const apiRequest = normalizedPathname === '/api' || normalizedPathname.startsWith('/api/');
  return apiRequest || (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD');
}
