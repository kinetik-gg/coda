/**
 * DOCX package fixtures — one well-formed screenplay package plus the hostile
 * variants #248's coverage matrix is built from.
 *
 * These sit next to `adversarial-zip-fixtures.ts` and reuse its dependency-free
 * `buildZip`, for the same reason it exists: a fixture generator that used a ZIP
 * or OOXML library would be testing that library's agreement with itself rather
 * than this adapter's defences.
 *
 * Every fixture here is deliberately *small*. #247 lost a CI cycle to a suite
 * that passed locally and timed out on the runner, where the cost turned out to
 * be fixture construction (a CRC32 pass plus deflate over tens of megabytes) and
 * not the code under test. A 4 KiB entry against a 1 KiB cap exercises exactly
 * the same branch as a 40 MiB entry against a 20 MiB cap, so the caps are made
 * small in the tests instead of the documents being made large here.
 */
import { buildZip } from './adversarial-zip-fixtures';

const WORDPROCESSING_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface DocxParagraphSpec {
  readonly text?: string;
  /** Value written to `w:pStyle`, which the styles part maps to a style name. */
  readonly style?: string;
  readonly alignment?: string;
  readonly numId?: string;
  readonly pageBreakBefore?: boolean;
  /** Raw XML spliced inside the paragraph, for drawings, fields, and tracked changes. */
  readonly extra?: string;
  readonly inTable?: boolean;
}

export interface DocxFixtureOptions {
  readonly paragraphs?: readonly DocxParagraphSpec[];
  readonly documentXml?: string;
  readonly contentTypesXml?: string;
  readonly packageRelsXml?: string;
  readonly documentRelsXml?: string;
  /** `null` omits the part entirely. */
  readonly stylesXml?: string | null;
  readonly numberingXml?: string | null;
  readonly extraEntries?: readonly { name: string; data: Buffer | string; deflate?: boolean }[];
  readonly omitDocument?: boolean;
  /** Style id -> style name pairs written into `word/styles.xml`. */
  readonly styles?: Readonly<Record<string, string>>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function paragraphXml(spec: DocxParagraphSpec): string {
  const properties: string[] = [];
  if (spec.style) properties.push(`<w:pStyle w:val="${escapeXml(spec.style)}"/>`);
  if (spec.alignment) properties.push(`<w:jc w:val="${escapeXml(spec.alignment)}"/>`);
  if (spec.pageBreakBefore) properties.push('<w:pageBreakBefore/>');
  if (spec.numId) properties.push(`<w:numPr><w:numId w:val="${escapeXml(spec.numId)}"/></w:numPr>`);
  const pPr = properties.length > 0 ? `<w:pPr>${properties.join('')}</w:pPr>` : '';
  const run =
    spec.text === undefined
      ? ''
      : `<w:r><w:t xml:space="preserve">${escapeXml(spec.text)}</w:t></w:r>`;
  const paragraph = `<w:p>${pPr}${run}${spec.extra ?? ''}</w:p>`;
  return spec.inTable ? `<w:tbl><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>` : paragraph;
}

export function docxDocumentXml(paragraphs: readonly DocxParagraphSpec[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${WORDPROCESSING_NAMESPACE}" xmlns:r="${RELATIONSHIPS_NAMESPACE}">` +
    `<w:body>${paragraphs.map(paragraphXml).join('')}<w:sectPr/></w:body></w:document>`
  );
}

function stylesXmlFor(styles: Readonly<Record<string, string>>): string {
  const entries = Object.entries(styles)
    .map(
      ([id, name]) =>
        `<w:style w:type="paragraph" w:styleId="${escapeXml(id)}">` +
        `<w:name w:val="${escapeXml(name)}"/></w:style>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:styles xmlns:w="${WORDPROCESSING_NAMESPACE}">${entries}</w:styles>`
  );
}

const DEFAULT_NUMBERING_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:numbering xmlns:w="${WORDPROCESSING_NAMESPACE}">` +
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

export const DEFAULT_CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const DEFAULT_PACKAGE_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">` +
  `<Relationship Id="rId1" Type="${RELATIONSHIPS_NAMESPACE}/officeDocument" Target="word/document.xml"/>` +
  '</Relationships>';

const DEFAULT_DOCUMENT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">` +
  `<Relationship Id="rId10" Type="${RELATIONSHIPS_NAMESPACE}/hyperlink" Target="https://example.test/notes" TargetMode="External"/>` +
  '</Relationships>';

const DEFAULT_STYLES: Readonly<Record<string, string>> = {
  SceneHeading: 'Scene Heading',
  Action: 'Action',
  Character: 'Character',
  Dialogue: 'Dialogue',
  Parenthetical: 'Parenthetical',
  Transition: 'Transition',
  ScriptTitle: 'Title',
  ScriptAuthor: 'Author',
};

/** Builds a DOCX package, with any part replaceable or omitted. */
export function buildDocxFixture(options: DocxFixtureOptions = {}): Buffer {
  const entries: { name: string; data: Buffer; deflate: boolean }[] = [];
  const push = (name: string, data: Buffer | string, deflate = true): void => {
    entries.push({
      name,
      data: typeof data === 'string' ? Buffer.from(data, 'utf8') : data,
      deflate,
    });
  };
  push('[Content_Types].xml', options.contentTypesXml ?? DEFAULT_CONTENT_TYPES_XML);
  push('_rels/.rels', options.packageRelsXml ?? DEFAULT_PACKAGE_RELS_XML);
  if (!options.omitDocument) {
    push(
      'word/document.xml',
      options.documentXml ?? docxDocumentXml(options.paragraphs ?? [{ text: 'FADE IN:' }]),
    );
  }
  push('word/_rels/document.xml.rels', options.documentRelsXml ?? DEFAULT_DOCUMENT_RELS_XML);
  if (options.stylesXml !== null) {
    push('word/styles.xml', options.stylesXml ?? stylesXmlFor(options.styles ?? DEFAULT_STYLES));
  }
  if (options.numberingXml !== null) {
    push('word/numbering.xml', options.numberingXml ?? DEFAULT_NUMBERING_XML);
  }
  for (const extra of options.extraEntries ?? []) {
    push(extra.name, extra.data, extra.deflate ?? true);
  }
  return buildZip(entries);
}

/** A short, fully styled screenplay: the happy path every hostile fixture is contrasted with. */
export const SCREENPLAY_PARAGRAPHS: readonly DocxParagraphSpec[] = [
  { text: 'The Long Way Down', style: 'ScriptTitle' },
  { text: 'Rae Dominguez', style: 'ScriptAuthor' },
  { text: 'INT. RADIO STATION - NIGHT', style: 'SceneHeading' },
  { text: 'A console glows. RAE leans into the microphone.', style: 'Action' },
  { text: 'RAE', style: 'Character' },
  { text: 'still on air', style: 'Parenthetical' },
  { text: "It's three in the morning and nobody is listening.", style: 'Dialogue' },
  { text: 'CUT TO:', style: 'Transition' },
  { text: 'EXT. PARKING LOT - CONTINUOUS', style: 'SceneHeading' },
  { text: 'Rain. A single car.', style: 'Action' },
];

/** The same script with no styles part at all, so classification is heuristic. */
export function unstyledScreenplayDocxFixture(): Buffer {
  return buildDocxFixture({
    stylesXml: null,
    paragraphs: [
      { text: 'INT. RADIO STATION - NIGHT' },
      { text: 'A console glows.' },
      { text: 'RAE' },
      { text: "It's three in the morning." },
      { text: 'CUT TO:' },
    ],
  });
}

/** A package carrying a VBA project: the macro rejection, by entry name. */
export function macroDocxFixture(): Buffer {
  return buildDocxFixture({
    paragraphs: SCREENPLAY_PARAGRAPHS,
    extraEntries: [{ name: 'word/vbaProject.bin', data: Buffer.from('MZ macro payload') }],
  });
}

/** The same rejection reached from the other direction: a macro-enabled content type. */
export function macroContentTypeDocxFixture(): Buffer {
  return buildDocxFixture({
    contentTypesXml: DEFAULT_CONTENT_TYPES_XML.replace(
      'wordprocessingml.document.main+xml',
      'wordprocessingml.document.macroEnabled.main+xml',
    ),
  });
}

/** A path-traversal entry name riding alongside otherwise valid parts. */
export function traversalDocxFixture(): Buffer {
  return buildDocxFixture({
    extraEntries: [
      { name: '../../../../etc/passwd', data: 'root:x:0:0::/root:/bin/sh\n', deflate: false },
    ],
  });
}

/** Two `word/document.xml` entries — the classic which-part-wins confusion attack. */
export function duplicatePartDocxFixture(): Buffer {
  return buildDocxFixture({
    extraEntries: [{ name: 'word/document.xml', data: docxDocumentXml([{ text: 'Replaced.' }]) }],
  });
}

/** A relationship target that climbs out of the package root. */
export function relationshipEscapeDocxFixture(): Buffer {
  return buildDocxFixture({
    documentRelsXml:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">` +
      `<Relationship Id="rId9" Type="${RELATIONSHIPS_NAMESPACE}/image" Target="../../../../etc/passwd"/>` +
      '</Relationships>',
  });
}

/** A content-type override naming a part relatively instead of package-absolutely. */
export function contentTypeEscapeDocxFixture(): Buffer {
  return buildDocxFixture({
    contentTypesXml: DEFAULT_CONTENT_TYPES_XML.replace(
      'PartName="/word/document.xml"',
      'PartName="../../secrets.xml"',
    ),
  });
}

/** A document part nested `depth` levels deep, to exercise the preflight depth ceiling. */
export function deeplyNestedDocxFixture(depth: number): Buffer {
  const open = '<w:tbl><w:tr><w:tc>'.repeat(depth);
  const close = '</w:tc></w:tr></w:tbl>'.repeat(depth);
  return buildDocxFixture({
    documentXml:
      `<w:document xmlns:w="${WORDPROCESSING_NAMESPACE}"><w:body>` +
      `${open}<w:p><w:r><w:t>deep</w:t></w:r></w:p>${close}</w:body></w:document>`,
  });
}

/** A zip nested inside the package, which a recursing parser would descend into. */
export function nestedArchiveDocxFixture(): Buffer {
  const inner = buildZip([{ name: 'inner.txt', data: Buffer.from('leaf', 'utf8'), deflate: true }]);
  return buildDocxFixture({
    extraEntries: [{ name: 'word/embeddings/nested.zip', data: inner, deflate: false }],
  });
}
