export type ScreenplayInterchangeFormat =
  'fountain' | 'final-draft' | 'plain-text' | 'fade-in' | 'celtx' | 'movie-magic' | 'highland';

export type InterchangeFidelity = 'native' | 'lossy' | 'unsupported';

export interface ScreenplayFormatCapability {
  format: ScreenplayInterchangeFormat;
  label: string;
  extensions: readonly string[];
  canImport: boolean;
  canExport: boolean;
  fidelity: InterchangeFidelity;
  limitations: readonly string[];
}

export const SCREENPLAY_FORMAT_CAPABILITIES: readonly ScreenplayFormatCapability[] = [
  {
    format: 'fountain',
    label: 'Fountain',
    extensions: ['.fountain', '.spmd'],
    canImport: true,
    canExport: true,
    fidelity: 'native',
    limitations: [],
  },
  {
    format: 'final-draft',
    label: 'Final Draft XML',
    extensions: ['.fdx'],
    canImport: true,
    canExport: true,
    fidelity: 'lossy',
    limitations: [
      'Revisions, production metadata, custom styles, and embedded media are not preserved.',
      'Inline formatting and dual-dialogue layout may be simplified.',
    ],
  },
  {
    format: 'plain-text',
    label: 'Plain text',
    extensions: ['.txt'],
    canImport: true,
    canExport: false,
    fidelity: 'lossy',
    limitations: [
      'Plain text has no reliable screenplay structure; imported text becomes Fountain action.',
    ],
  },
  {
    format: 'fade-in',
    label: 'Fade In project',
    extensions: ['.fadein'],
    canImport: false,
    canExport: false,
    fidelity: 'unsupported',
    limitations: [
      'The proprietary project container is unsupported; export Fountain or FDX first.',
    ],
  },
  {
    format: 'celtx',
    label: 'Celtx project',
    extensions: ['.celtx'],
    canImport: false,
    canExport: false,
    fidelity: 'unsupported',
    limitations: [
      'The proprietary project container is unsupported; export Fountain or FDX first.',
    ],
  },
  {
    format: 'movie-magic',
    label: 'Movie Magic Screenwriter',
    extensions: ['.mmsw', '.scw'],
    canImport: false,
    canExport: false,
    fidelity: 'unsupported',
    limitations: [
      'The proprietary project format is unsupported; export an interchange format first.',
    ],
  },
  {
    format: 'highland',
    label: 'Highland project',
    extensions: ['.highland'],
    canImport: false,
    canExport: false,
    fidelity: 'unsupported',
    limitations: ['The packaged project format is unsupported; export Fountain first.'],
  },
] as const;

export type ScreenplayInterchangeErrorCode =
  | 'EMPTY_INPUT'
  | 'INVALID_FDX'
  | 'INVALID_ENCODING'
  | 'MALFORMED_XML'
  | 'SERIALIZATION_FAILED'
  | 'UNSAFE_XML'
  | 'UNSUPPORTED_FORMAT';

export class ScreenplayInterchangeError extends Error {
  readonly code: ScreenplayInterchangeErrorCode;
  readonly format?: ScreenplayInterchangeFormat;

  constructor(
    code: ScreenplayInterchangeErrorCode,
    message: string,
    options: { cause?: unknown; format?: ScreenplayInterchangeFormat } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ScreenplayInterchangeError';
    this.code = code;
    this.format = options.format;
  }
}

export interface ScreenplayFormatDetection {
  format: ScreenplayInterchangeFormat;
  confidence: 'certain' | 'probable' | 'fallback';
  reason: string;
}

export interface ScreenplayImportResult {
  fountain: string;
  sourceFormat: ScreenplayInterchangeFormat;
  fidelity: Exclude<InterchangeFidelity, 'unsupported'>;
  warnings: readonly string[];
}

export interface ScreenplayExportResult {
  content: string;
  targetFormat: ScreenplayInterchangeFormat;
  mimeType: string;
  suggestedExtension: string;
  fidelity: Exclude<InterchangeFidelity, 'unsupported'>;
  warnings: readonly string[];
}
