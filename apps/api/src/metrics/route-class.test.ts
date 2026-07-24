import { describe, expect, it } from 'vitest';
import { classifyRoute } from './route-class';

function requestWithRoute(path: string, baseUrl = ''): Parameters<typeof classifyRoute>[0] {
  return {
    route: { path } as never,
    baseUrl,
    originalUrl: '/should-be-ignored',
    url: '/should-be-ignored',
  };
}

function requestWithoutRoute(target: string): Parameters<typeof classifyRoute>[0] {
  return { route: undefined, baseUrl: '', originalUrl: target, url: target };
}

describe('classifyRoute', () => {
  it('uses the matched Nest/Express route pattern, not the concrete request path', () => {
    expect(classifyRoute(requestWithRoute('/api/v1/screenplays/:screenplayId'))).toBe(
      '/api/v1/screenplays/:screenplayId',
    );
  });

  it('prefixes the matched pattern with a non-root mount path', () => {
    expect(classifyRoute(requestWithRoute('/live', '/api/v1/health'))).toBe('/api/v1/health/live');
  });

  it('collapses every distinct id into the same bounded label', () => {
    const first = classifyRoute(
      requestWithRoute('/api/v1/screenplays/:screenplayId/export.fountain'),
    );
    const second = classifyRoute(
      requestWithRoute('/api/v1/screenplays/:screenplayId/export.fountain'),
    );
    expect(first).toBe(second);
    expect(first).toBe('/api/v1/screenplays/:screenplayId/export.fountain');
  });

  it('maps the SPA wildcard fallback pattern to a fixed static label', () => {
    expect(classifyRoute(requestWithRoute('{*any}'))).toBe('static');
    expect(classifyRoute(requestWithRoute('*'))).toBe('static');
  });

  it('collapses unmatched API paths into a single bounded label regardless of the probed path', () => {
    const targets = [
      '/api/v1/does-not-exist',
      '/api/v1/another-unknown-route',
      '/api/v1/probing-a-thousand-distinct-paths',
      '/api',
    ];
    const classes = new Set(targets.map((target) => classifyRoute(requestWithoutRoute(target))));
    expect(classes).toEqual(new Set(['unmatched']));
  });

  it('collapses unmatched non-API paths (static assets, SPA shell) into a single bounded label', () => {
    const targets = ['/assets/app-8f21ac.js', '/', '/some/deep/client/route', '/favicon.ico'];
    const classes = new Set(targets.map((target) => classifyRoute(requestWithoutRoute(target))));
    expect(classes).toEqual(new Set(['static']));
  });

  it('labels the metrics endpoint itself distinctly when unmatched (e.g. before the route is registered)', () => {
    expect(classifyRoute(requestWithoutRoute('/metrics'))).toBe('metrics');
  });

  it('drops query strings before classification', () => {
    expect(classifyRoute(requestWithoutRoute('/api/v1/setup/status?token=secret'))).toBe(
      'unmatched',
    );
  });

  it('fails closed to the static bucket for malformed request targets', () => {
    expect(classifyRoute(requestWithoutRoute('http://[invalid'))).toBe('static');
  });
});
