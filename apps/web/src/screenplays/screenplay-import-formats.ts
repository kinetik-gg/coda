/**
 * Every screenplay format the import file picker in `ScreenplaysScreen.tsx`
 * accepts, and how each one gets from a `File` into a screenplay.
 *
 * `.fdx`, `.html`, `.docx`, `.pdf`, and `.rtf` are parsed by the bounded
 * server-side adapter runtime (`apps/api/src/imports/adapter-runtime`): the
 * browser only uploads the original bytes through
 * `screenplay-adapter-import.ts` and never runs an untrusted parser itself.
 * Every other extension is converted in this tab by `@coda/fountain`.
 *
 * This module is the *only* place the import guard or the file input's
 * `accept` attribute may name an extension. Issue #313 existed because those
 * two were hand-maintained independently of the server-side adapter registry
 * (`apps/api/src/imports/adapter-runtime/screenplay-adapter-registry.ts`), so
 * four adapters landed server-side and stayed unreachable from the browser.
 * `tests/integration/screenplay-import-formats-parity.integration.test.ts`
 * fails the build the moment a newly registered, non-gated adapter format has
 * no `serverAdapter: true` entry here, so a sixth adapter cannot repeat it.
 */
export interface ScreenplayImportFormat {
  /** Matches the `ScreenplaySourceFormat` the server-side adapter registry uses. */
  readonly sourceFormat: string;
  /** Case-insensitive filename extensions recognized as this format, dot included. */
  readonly extensions: readonly string[];
  /** Offered to the native file picker; kept narrow so the OS filter stays useful. */
  readonly mimeTypes: readonly string[];
  /**
   * `true` when the format must be uploaded as-is and converted by the
   * server-side adapter runtime rather than parsed in this tab — every binary
   * format, and any format substantial enough that a hostile document could
   * hang or exhaust a browser tab the way FDX could before #246 moved it
   * server-side.
   */
  readonly serverAdapter: boolean;
}

export const SCREENPLAY_IMPORT_FORMATS: readonly ScreenplayImportFormat[] = [
  {
    sourceFormat: 'fountain',
    extensions: ['.fountain', '.spmd'],
    mimeTypes: ['text/plain'],
    serverAdapter: false,
  },
  {
    sourceFormat: 'plain-text',
    extensions: ['.txt'],
    mimeTypes: ['text/plain'],
    serverAdapter: false,
  },
  { sourceFormat: 'fade-in', extensions: ['.fadein'], mimeTypes: [], serverAdapter: false },
  { sourceFormat: 'celtx', extensions: ['.celtx'], mimeTypes: [], serverAdapter: false },
  {
    sourceFormat: 'movie-magic',
    extensions: ['.mmsw', '.scw'],
    mimeTypes: [],
    serverAdapter: false,
  },
  { sourceFormat: 'highland', extensions: ['.highland'], mimeTypes: [], serverAdapter: false },
  {
    sourceFormat: 'final-draft',
    extensions: ['.fdx'],
    mimeTypes: ['application/xml', 'text/xml'],
    serverAdapter: true,
  },
  {
    sourceFormat: 'html',
    extensions: ['.html', '.htm'],
    mimeTypes: ['text/html'],
    serverAdapter: true,
  },
  {
    sourceFormat: 'docx',
    extensions: ['.docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    serverAdapter: true,
  },
  {
    sourceFormat: 'pdf',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    serverAdapter: true,
  },
  {
    sourceFormat: 'rtf',
    extensions: ['.rtf'],
    mimeTypes: ['application/rtf', 'text/rtf'],
    serverAdapter: true,
  },
];

const extensionAlternation = SCREENPLAY_IMPORT_FORMATS.flatMap((format) => format.extensions)
  .map((extension) => extension.slice(1))
  .join('|');

/** Matches a filename ending in any recognized import extension, case-insensitively. */
export const SCREENPLAY_IMPORT_EXTENSION_PATTERN = new RegExp(
  `\\.(?:${extensionAlternation})$`,
  'i',
);

/** The `accept` attribute for the import `<input type="file">`. */
export const SCREENPLAY_IMPORT_ACCEPT = [
  ...SCREENPLAY_IMPORT_FORMATS.flatMap((format) => format.extensions),
  ...new Set(SCREENPLAY_IMPORT_FORMATS.flatMap((format) => format.mimeTypes)),
].join(',');

function extensionOf(filename: string): string | undefined {
  return /\.[^./\\]+$/.exec(filename.trim().toLowerCase())?.[0];
}

/** The registered format for `filename`, or `undefined` when its extension is not recognized. */
export function screenplayImportFormatFor(filename: string): ScreenplayImportFormat | undefined {
  const extension = extensionOf(filename);
  if (!extension) return undefined;
  return SCREENPLAY_IMPORT_FORMATS.find((format) => format.extensions.includes(extension));
}
