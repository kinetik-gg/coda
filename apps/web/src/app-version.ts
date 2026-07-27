/**
 * The shipped version, baked from `apps/web/package.json` by Vite's `define`.
 *
 * Every status bar reports it, so a release bump must not depend on anyone remembering to edit
 * a literal in a component (#193).
 */
declare const __CODA_VERSION__: string;

export const CODA_VERSION: string =
  typeof __CODA_VERSION__ === 'string' ? __CODA_VERSION__ : '0.0.0';

/** `CODA v0.0.7` — the product label every status bar shows. */
export const CODA_PRODUCT_LABEL = `CODA v${CODA_VERSION}`;
