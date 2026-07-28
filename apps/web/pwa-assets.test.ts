import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codaManifest, navigationFallbackDenylist } from './pwa-config';

const publicAsset = (name: string) => readFileSync(new URL(`./public/${name}`, import.meta.url));

function pngMetadata(name: string) {
  const png = publicAsset(name);
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png[25],
  };
}

function icoSizes() {
  const ico = publicAsset('favicon.ico');
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    return [ico[offset] || 256, ico[offset + 1] || 256];
  });
}

describe('PWA assets and metadata', () => {
  it('declares the platform-specific document head metadata', () => {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
    expect(html).toContain('<meta name="theme-color" content="#111111"');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Coda"');
    expect(html).toContain('rel="icon" href="/favicon.svg" type="image/svg+xml"');
    expect(html).toContain('rel="icon" href="/favicon-96x96.png" sizes="96x96" type="image/png"');
    expect(html).toContain('rel="shortcut icon" href="/favicon.ico"');
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"');
  });

  it('defines a stable installable manifest with separate regular and maskable icons', () => {
    expect(codaManifest).toMatchObject({
      id: '/',
      name: 'Coda',
      short_name: 'Coda',
      lang: 'en',
      dir: 'ltr',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#111111',
      background_color: '#111111',
    });
    expect(codaManifest.icons.map(({ sizes, purpose }) => [sizes, purpose])).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['192x192', 'maskable'],
      ['512x512', 'maskable'],
    ]);
  });

  it('ships every declared asset at the expected dimensions and ICO sizes', () => {
    expect(pngMetadata('favicon-96x96.png')).toMatchObject({ width: 96, height: 96 });
    expect(pngMetadata('apple-touch-icon.png')).toMatchObject({ width: 180, height: 180 });
    for (const icon of codaManifest.icons) {
      const size = Number.parseInt(icon.sizes, 10);
      expect(pngMetadata(icon.src.slice(1))).toMatchObject({ width: size, height: size });
    }
    expect(icoSizes()).toEqual([
      [48, 48],
      [32, 32],
      [16, 16],
    ]);
    expect(publicAsset('favicon.svg').length).toBeGreaterThan(0);
  });

  it('uses alpha only for regular icons and fully opaque canvases for maskable icons', () => {
    expect(pngMetadata('web-app-manifest-192x192.png').colorType).toBe(6);
    expect(pngMetadata('web-app-manifest-512x512.png').colorType).toBe(6);
    expect([0, 2]).toContain(pngMetadata('web-app-manifest-maskable-192x192.png').colorType);
    expect([0, 2]).toContain(pngMetadata('web-app-manifest-maskable-512x512.png').colorType);
  });

  it('denies private and operational routes from the navigation fallback', () => {
    for (const route of ['/api/v1/auth/session', '/socket.io/', '/metrics']) {
      expect(navigationFallbackDenylist.some((pattern) => pattern.test(route))).toBe(true);
    }
    expect(navigationFallbackDenylist.some((pattern) => pattern.test('/screenplays/example'))).toBe(
      false,
    );
  });
});
