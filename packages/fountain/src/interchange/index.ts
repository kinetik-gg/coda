import { detectScreenplayFormat } from './detect';
import { importFinalDraft } from './fdx';
import { requireNonEmptySource, type ScreenplayInput } from './input';
import {
  SCREENPLAY_FORMAT_CAPABILITIES,
  ScreenplayInterchangeError,
  type ScreenplayImportResult,
  type ScreenplayInterchangeFormat,
} from './types';

export { detectScreenplayFormat } from './detect';
export { exportFinalDraft, importFinalDraft } from './fdx';
export type { ScreenplayInput } from './input';
export {
  SCREENPLAY_FORMAT_CAPABILITIES,
  ScreenplayInterchangeError,
  type InterchangeFidelity,
  type ScreenplayExportResult,
  type ScreenplayFormatCapability,
  type ScreenplayFormatDetection,
  type ScreenplayImportResult,
  type ScreenplayInterchangeErrorCode,
  type ScreenplayInterchangeFormat,
} from './types';

export function importScreenplay(
  input: ScreenplayInput,
  options: { filename?: string; format?: ScreenplayInterchangeFormat } = {},
): ScreenplayImportResult {
  const detected = options.format ?? detectScreenplayFormat(input, options.filename).format;
  if (detected === 'final-draft') return importFinalDraft(input);
  if (detected === 'fountain') {
    return {
      fountain: requireNonEmptySource(input),
      sourceFormat: 'fountain',
      fidelity: 'native',
      warnings: [],
    };
  }
  if (detected === 'plain-text') {
    const source = requireNonEmptySource(input).replace(/\r\n?/gu, '\n');
    return {
      fountain: source
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => `!${line}`)
        .join('\n\n'),
      sourceFormat: 'plain-text',
      fidelity: 'lossy',
      warnings: ['Plain text has no reliable screenplay structure and was imported as forced action.'],
    };
  }

  const capability = SCREENPLAY_FORMAT_CAPABILITIES.find((entry) => entry.format === detected);
  throw new ScreenplayInterchangeError(
    'UNSUPPORTED_FORMAT',
    capability?.limitations[0] ?? `The ${detected} screenplay format is unsupported.`,
    { format: detected },
  );
}
