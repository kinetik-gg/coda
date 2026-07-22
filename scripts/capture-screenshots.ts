import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const email = process.env.CODA_E2E_EMAIL;
  const password = process.env.CODA_E2E_PASSWORD;
  if (!email || !password) throw new Error('Screenshot credentials are required.');

  const output = resolve('docs/assets');
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch(
    process.env.CODA_E2E_CHROME_PATH
      ? { executablePath: process.env.CODA_E2E_CHROME_PATH }
      : undefined,
  );

  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(process.env.CODA_E2E_URL ?? 'http://127.0.0.1:3000');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
    await page.screenshot({ path: resolve(output, 'projects.png') });

    await page.getByRole('button', { name: /The Quiet Signal/ }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    await page.getByText('Sequences', { exact: true }).first().waitFor();
    await page.screenshot({ path: resolve(output, 'workspace.png') });

    const logo = await readFile(resolve('apps/web/src/assets/coda.svg'));
    const social = await browser.newPage({ viewport: { width: 1280, height: 640 } });
    await social.setContent(`
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; width: 1280px; height: 640px; display: grid; place-items: center;
          background: #111; color: #fff; font-family: Inter, system-ui, sans-serif; }
        main { width: 1040px; display: grid; gap: 34px; }
        img { width: 300px; height: auto; }
        h1 { max-width: 940px; margin: 0; font-size: 54px; line-height: 1.08; font-weight: 560;
          letter-spacing: -0.035em; }
        p { margin: 0; color: #aaa; font: 24px/1.4 ui-monospace, SFMono-Regular, monospace; }
        span { color: #3161ff; }
      </style>
      <main>
        <img alt="Coda" src="data:image/svg+xml;base64,${logo.toString('base64')}" />
        <h1>Turn source PDFs into <span>structured breakdowns.</span></h1>
        <p>Self-hosted · Flexible hierarchies · Custom fields</p>
      </main>
    `);
    await social.screenshot({ path: resolve(output, 'social-preview.png') });
  } finally {
    await browser.close();
  }
}

void main();
