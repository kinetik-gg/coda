import { detectScreenplayFormat } from './detect';
import { importFinalDraft } from './fdx';
import { importHtml } from './html';
import { requireNonEmptySource, requireNonEmptyUtf8Source, type ScreenplayInput } from './input';
import {
  SCREENPLAY_FORMAT_CAPABILITIES,
  ScreenplayInterchangeError,
  type ScreenplayImportResult,
  type ScreenplayInterchangeFormat,
} from './types';

export { detectScreenplayFormat } from './detect';
export {
  exportFinalDraft,
  importFinalDraft,
  MAX_FDX_BYTES,
  MAX_FDX_ELEMENT_COUNT,
  MAX_FDX_ELEMENT_DEPTH,
} from './fdx';
export {
  importHtml,
  MAX_HTML_ATTRIBUTES_PER_ELEMENT,
  MAX_HTML_BYTES,
  MAX_HTML_ELEMENT_COUNT,
  MAX_HTML_ELEMENT_DEPTH,
} from './html';
export type { ScreenplayInput } from './input';
export { assertHtmlPreflight, HtmlPreflightError } from './html-preflight';
export type { HtmlPreflightFailureCode, HtmlPreflightLimits } from './html-preflight';
export { assertXmlPreflight, XmlPreflightError } from './xml-preflight';
export type { XmlPreflightFailureCode, XmlPreflightLimits } from './xml-preflight';
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
  if (detected === 'html') return importHtml(input);
  if (detected === 'fountain') {
    return {
      fountain: requireNonEmptyUtf8Source(input),
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
      warnings: [
        'Plain text has no reliable screenplay structure and was imported as forced action.',
      ],
    };
  }

  const capability = SCREENPLAY_FORMAT_CAPABILITIES.find((entry) => entry.format === detected);
  throw new ScreenplayInterchangeError(
    'UNSUPPORTED_FORMAT',
    capability?.limitations[0] ?? `The ${detected} screenplay format is unsupported.`,
    { format: detected },
  );
}
