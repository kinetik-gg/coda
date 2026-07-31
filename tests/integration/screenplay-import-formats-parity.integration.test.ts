import { describe, expect, it } from 'vitest';
import { SCREENPLAY_IMPORT_FORMATS } from '../../apps/web/src/screenplays/screenplay-import-formats';

interface ScreenplayAdapterRegistryModule {
  registeredScreenplaySourceFormats(): string[];
  GATED_SCREENPLAY_SOURCE_FORMATS: readonly string[];
}

/**
 * Loaded through a specifier built at runtime, rather than a static import, so
 * this file never asks TypeScript to resolve `screenplay-adapter-registry.ts`'s
 * own module graph under *this* project's compiler options. That graph relies
 * on two things scoped to `apps/api`'s own tsconfig: extension-less dynamic
 * `import()` targets meant for Node-style resolution, and an ambient `sax`
 * type declaration apps/api's `include` sweeps in from `src/**\/*.d.ts`.
 * Neither is visible here, so a static import surfaces unrelated type errors
 * that have nothing to do with what this test actually checks. The cast right
 * below is the one place trust is re-established, and every value it produces
 * is exercised for real by the assertions beneath it.
 */
async function loadAdapterRegistry(): Promise<ScreenplayAdapterRegistryModule> {
  const segments = [
    '..',
    '..',
    'apps',
    'api',
    'src',
    'imports',
    'adapter-runtime',
    'screenplay-adapter-registry',
  ];
  return (await import(segments.join('/'))) as ScreenplayAdapterRegistryModule;
}

/**
 * #313: the import file picker in `ScreenplaysScreen.tsx` maintained its own
 * list of accepted screenplay formats, entirely independent of the server-side
 * adapter registry (`apps/api/src/imports/adapter-runtime/screenplay-adapter-registry.ts`).
 * When epic #235 landed HTML, DOCX, PDF, and RTF adapters there, nothing kept
 * the two lists in agreement, so all four were registered and working
 * end-to-end on the server yet unreachable from the browser.
 *
 * This test is the seam that replaces the hand-maintained duplicate: it does
 * not derive the web's list from the registry at build time (the web bundle
 * cannot import `apps/api` — that would pull server-only parser dependencies
 * into the browser bundle), so instead it asserts the two independently
 * authored lists agree, in both directions, at test time. A sixth adapter
 * that is not marked `serverAdapter: true` in `SCREENPLAY_IMPORT_FORMATS`
 * fails this test.
 */
describe('screenplay import formats: UI and server-adapter registry agree', () => {
  it('exposes every registered, non-gated adapter format to the UI as server-routed', async () => {
    const registry = await loadAdapterRegistry();
    const gated = new Set<string>(registry.GATED_SCREENPLAY_SOURCE_FORMATS);
    const registered = registry
      .registeredScreenplaySourceFormats()
      .filter((format) => !gated.has(format));
    const webServerRouted = SCREENPLAY_IMPORT_FORMATS.filter((format) => format.serverAdapter).map(
      (format) => format.sourceFormat,
    );
    expect([...webServerRouted].sort()).toEqual([...registered].sort());
  });

  it('never exposes a gated format — the runtime-test adapter deliberately hangs and exhausts its heap', async () => {
    const registry = await loadAdapterRegistry();
    const gated = new Set<string>(registry.GATED_SCREENPLAY_SOURCE_FORMATS);
    expect(gated.size).toBeGreaterThan(0);
    for (const format of SCREENPLAY_IMPORT_FORMATS) {
      expect(gated.has(format.sourceFormat)).toBe(false);
    }
  });

  it('keeps every UI-declared source format unique', () => {
    const sourceFormats = SCREENPLAY_IMPORT_FORMATS.map((format) => format.sourceFormat);
    expect(new Set(sourceFormats).size).toBe(sourceFormats.length);
  });
});
