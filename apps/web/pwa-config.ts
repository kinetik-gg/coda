import type { ManifestOptions } from 'vite-plugin-pwa';

export const codaManifest = {
  id: '/',
  name: 'Coda',
  short_name: 'Coda',
  description:
    'Write screenplays and turn them into structured breakdowns—on infrastructure you control.',
  lang: 'en',
  dir: 'ltr',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  theme_color: '#111111',
  background_color: '#111111',
  icons: [
    {
      src: '/web-app-manifest-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/web-app-manifest-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/web-app-manifest-maskable-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'maskable',
    },
    {
      src: '/web-app-manifest-maskable-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
} satisfies Partial<ManifestOptions>;

export const navigationFallbackDenylist = [
  /^\/api(?:\/|$)/u,
  /^\/socket\.io(?:\/|$)/u,
  /^\/metrics(?:\/|$)/u,
];
