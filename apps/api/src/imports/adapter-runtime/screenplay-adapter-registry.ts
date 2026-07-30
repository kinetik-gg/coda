import type { ScreenplayAdapter, ScreenplaySourceFormat } from '@coda/contracts';
import { FDX_SOURCE_FORMAT } from './adapters/fdx.adapter';
import { PDF_SOURCE_FORMAT } from './adapters/pdf.adapter';
import { RUNTIME_TEST_SOURCE_FORMAT } from './adapters/runtime-test.adapter';

/** A factory that imports an adapter's module the first time its format arrives. */
export type ScreenplayAdapterLoader = () => Promise<ScreenplayAdapter>;

/**
 * Format dispatch for the adapter runtime.
 *
 * Loaders are lazy on purpose: a parser dependency for one format must not be
 * evaluated when a document of another format is imported, so a heavy or
 * dependency-bearing adapter costs nothing until it is actually used. Adapters
 * added by #246 onwards register here and nowhere else.
 *
 * This module is imported by the worker thread, so it deliberately reads no
 * configuration — the host decides which formats are admissible and rejects the
 * rest before a thread is ever spawned.
 */
const loaders = new Map<ScreenplaySourceFormat, ScreenplayAdapterLoader>([
  [
    RUNTIME_TEST_SOURCE_FORMAT,
    async () => (await import('./adapters/runtime-test.adapter')).createRuntimeTestAdapter(),
  ],
  [FDX_SOURCE_FORMAT, async () => (await import('./adapters/fdx.adapter')).createFdxAdapter()],
  [PDF_SOURCE_FORMAT, async () => (await import('./adapters/pdf.adapter')).createPdfAdapter()],
]);

/**
 * Formats that must never be dispatched on a production instance. The runtime
 * test adapter can deliberately hang and deliberately exhaust its heap; it is
 * safe inside the runtime's bounds but there is no reason to expose it.
 */
export const GATED_SCREENPLAY_SOURCE_FORMATS: readonly ScreenplaySourceFormat[] = [
  RUNTIME_TEST_SOURCE_FORMAT,
];

/** Every source format compiled into this build, before configuration gating. */
export function registeredScreenplaySourceFormats(): ScreenplaySourceFormat[] {
  return [...loaders.keys()].sort();
}

/**
 * Resolves the adapter for `sourceFormat`, or `undefined` when the format has no
 * adapter in this build. The caller turns that into an `unsupported-format`
 * failure; throwing here would be indistinguishable from an adapter that failed
 * to load.
 */
export async function loadScreenplayAdapter(
  sourceFormat: ScreenplaySourceFormat,
): Promise<ScreenplayAdapter | undefined> {
  const loader = loaders.get(sourceFormat);
  if (!loader) return undefined;
  const adapter = await loader();
  if (!adapter.sourceFormats.includes(sourceFormat)) {
    throw new Error(`Adapter ${adapter.id} does not declare ${sourceFormat}`);
  }
  return adapter;
}
