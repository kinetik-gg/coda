import { expect, test } from '@playwright/test';

test('installs the branded app shell without caching private application data', async ({
  context,
  page,
  request,
}) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/site.webmanifest');

  const manifestResponse = await request.get('/site.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()['content-type']).toMatch(/manifest|json/u);
  const manifest = (await manifestResponse.json()) as {
    icons: Array<{ src: string; type: string }>;
  };
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain(icon.type);
  }
  for (const [asset, contentType] of [
    ['/favicon.svg', /^image\/svg\+xml/],
    ['/favicon-96x96.png', /^image\/png/],
    ['/favicon.ico', /^image\/(?:x-icon|vnd\.microsoft\.icon)/],
    ['/apple-touch-icon.png', /^image\/png/],
  ] as const) {
    const response = await request.get(asset);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toMatch(contentType);
  }

  await page.evaluate(() => fetch('/api/v1/setup/status'));
  const cachedUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      urls.push(...(await cache.keys()).map(({ url }) => url));
    }
    return urls;
  });
  expect(cachedUrls).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(/\/api(?:\/|$)/u),
      expect.stringMatching(/\/socket\.io(?:\/|$)/u),
      expect.stringMatching(/\/metrics(?:\/|$)/u),
    ]),
  );

  await context.setOffline(true);
  await expect(
    page.evaluate(() => fetch('/api/v1/setup/status').then((response) => response.status)),
  ).rejects.toThrow();
  await page.goto('/pwa-offline-check', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Coda could not reach its API.')).toBeVisible();
});
