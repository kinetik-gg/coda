/**
 * The archive half of DOCX hardening: everything between "20 MB of untrusted
 * bytes" and "five XML strings the walker may look at".
 *
 * A DOCX is a ZIP, so it inherits every ZIP attack the qualification spike (#247,
 * `docs/adr-rtf-docx-parser-qualification.md`) measured. The critical finding
 * there is that the adapter runtime cannot help: `resourceLimits.maxOldGeneration
 * SizeMb` bounds the V8 heap, and a decompressed buffer's backing store is
 * external memory the heap ceiling never sees. Inflating one 500 MiB zip bomb
 * through a library that decompresses before it measures took process RSS from
 * 47.8 MB to 1,169.0 MB while `heapUsed` moved 10.6 MB -> 13.8 MB. The caps this
 * module passes to `readBoundedZipPackage` — enforced from the central directory
 * before inflation and again on the byte counter *during* inflation — are
 * therefore the only real bound on memory here.
 *
 * On top of the byte caps this module also refuses the structural attacks a size
 * cap cannot see: macro-bearing packages, duplicate entry names, entry names that
 * escape the archive root, `[Content_Types].xml` overrides naming a part outside
 * the package, and relationship targets whose `..` segments resolve above the
 * package root. That last one is the indirection `yauzl` cannot protect against —
 * its own path safety applies to physical entry names, not to a target string a
 * hostile `document.xml.rels` invents.
 */
import { ScreenplayAdapterSourceError } from '@coda/contracts';
import type { ScreenplayAdapterContext, ScreenplayAdapterLimits } from '@coda/contracts';
import {
  BoundedZipReadError,
  readBoundedZipPackage,
  type BoundedZipPackageLimits,
} from '../../../parser-qualification/bounded-zip-reader';
import { attributeValue, decodeXmlPart, parseXmlPart } from './docx-xml';

const CONTENT_TYPES_PART = '[Content_Types].xml';
const PACKAGE_RELS_PART = '_rels/.rels';
const DEFAULT_DOCUMENT_PART = 'word/document.xml';

/**
 * The compression ratio above which an entry is a bomb rather than a document.
 * XML compresses well — a real `word/document.xml` lands around 8-15x, and the
 * most repetitive legitimate part seen in the qualification fixtures stayed
 * under 40x — so 200x is far outside anything a word processor emits while still
 * rejecting the all-zero payloads a bomb is built from (those exceed 1,000x).
 * There is no operator-configured analogue to derive this from.
 */
const DOCX_MAX_COMPRESSION_RATIO = 200;

/**
 * An OOXML package for a screenplay is a handful of parts plus fonts and images.
 * Several hundred entries is already unusual; tens of thousands is an attempt to
 * make the central-directory walk itself the attack.
 */
const DOCX_MAX_ENTRY_COUNT = 512;

/** Entry names that mean the package carries VBA, whatever its content types claim. */
const MACRO_ENTRY_PATTERN = /(^|\/)(vbaProject\.bin|vbaData\.xml|vbaProjectSignature\.bin)$/iu;

/** Content types that mean the same thing from the other direction. */
const MACRO_CONTENT_TYPE_PATTERN = /vbaProject|macroEnabled/iu;

const OFFICE_DOCUMENT_RELATIONSHIP = /\/officeDocument$/u;
const MAIN_DOCUMENT_CONTENT_TYPE =
  /wordprocessingml\.document(\.macroEnabled)?\.main\+xml|wordprocessingml\.template\.main\+xml/u;

export interface DocxRelationship {
  readonly id: string;
  readonly type: string;
  /** Package-absolute part name for an internal target; the raw string for an external one. */
  readonly target: string;
  readonly external: boolean;
}

export interface DocxPackage {
  readonly documentPartName: string;
  readonly documentXml: string;
  readonly stylesPartName: string;
  readonly stylesXml?: string;
  readonly numberingPartName: string;
  readonly numberingXml?: string;
  readonly relationships: ReadonlyMap<string, DocxRelationship>;
  readonly entryNames: readonly string[];
  /** Parts carrying images, embedded objects, fonts — counted, never dereferenced. */
  readonly binaryPartCount: number;
}

/**
 * Package caps derived from the run's configured limits. `maxEntryBytes` is the
 * input ceiling because no single part of a document can legitimately exceed the
 * document; the aggregate allows 4x that, since an archive of well-compressing
 * XML can honestly inflate past its own file size without being an attack.
 */
export function docxPackageLimits(limits: ScreenplayAdapterLimits): BoundedZipPackageLimits {
  return {
    maxEntryBytes: limits.maxInputBytes,
    maxCompressionRatio: DOCX_MAX_COMPRESSION_RATIO,
    maxEntryCount: DOCX_MAX_ENTRY_COUNT,
    maxTotalUncompressedBytes: limits.maxInputBytes * 4,
  };
}

/** Turns an attributable archive rejection into an attributable conversion rejection. */
function toSourceError(error: unknown): ScreenplayAdapterSourceError {
  if (!(error instanceof BoundedZipReadError)) {
    // `yauzl` raises its own errors mid-stream — notably when an entry produces
    // more bytes than its header declared. They are rejections, not defects, but
    // their wording is an implementation detail, so they get a stable message.
    if (error instanceof ScreenplayAdapterSourceError) return error;
    return new ScreenplayAdapterSourceError(
      'This DOCX package was rejected: it could not be read as a valid archive.',
    );
  }
  const detail: Record<string, string> = {
    'declared-size-exceeded': 'a part declares more data than the import ceiling allows',
    'compression-ratio-exceeded': 'a part is compressed far beyond any plausible document',
    'stream-exceeded-cap': 'a part produced more data than it declared',
    'unsafe-entry-name': 'a part name attempts to escape the package',
    'entry-count-exceeded': 'the package contains too many parts',
    'total-size-exceeded': 'the package declares more data in total than the import ceiling allows',
    'duplicate-entry': 'the package contains the same part twice',
    'archive-error': 'the package is not a readable archive',
  };
  return new ScreenplayAdapterSourceError(
    `This DOCX package was rejected: ${detail[error.reason] ?? 'it could not be read'}.`,
  );
}

function assertZipSignature(bytes: Uint8Array): void {
  const empty = bytes.byteLength < 4;
  const signed =
    !empty && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!signed) {
    throw new ScreenplayAdapterSourceError(
      'This file is not a DOCX package (no ZIP archive signature).',
    );
  }
}

/**
 * Resolves an OOXML part reference against the part that made it, rejecting
 * anything that climbs above the package root. Returns a package-absolute name
 * with no leading slash, matching how zip entry names are spelled.
 */
export function resolvePackagePath(fromPart: string, target: string): string {
  const absolute = target.startsWith('/');
  const base = absolute ? [] : fromPart.split('/').slice(0, -1);
  const segments = absolute ? target.slice(1).split('/') : [...base, ...target.split('/')];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') {
      resolved.push(segment);
      continue;
    }
    if (resolved.length === 0) {
      throw new ScreenplayAdapterSourceError(
        'This DOCX package was rejected: a part reference resolves outside the package.',
      );
    }
    resolved.pop();
  }
  return resolved.join('/');
}

function assertNoMacros(entryNames: readonly string[], contentTypesXml: string | undefined): void {
  const macroEntry = entryNames.find((name) => MACRO_ENTRY_PATTERN.test(name));
  const macroContentType = contentTypesXml
    ? MACRO_CONTENT_TYPE_PATTERN.test(contentTypesXml)
    : false;
  if (macroEntry || macroContentType) {
    throw new ScreenplayAdapterSourceError(
      'This DOCX package contains macros (VBA), which are never executed and never imported. ' +
        'Re-save it as a macro-free .docx and try again.',
    );
  }
}

interface ContentTypesIndex {
  readonly overrides: ReadonlyMap<string, string>;
}

/**
 * Reads `[Content_Types].xml`, validating every `Override` part name as it goes.
 * A part name that is relative, or that resolves above the root, is rejected
 * rather than ignored: the only reason to write one is to make a consumer
 * dereference something the package does not own.
 */
async function readContentTypes(
  xml: string | undefined,
  context: ScreenplayAdapterContext,
): Promise<ContentTypesIndex> {
  const overrides = new Map<string, string>();
  if (xml === undefined) return { overrides };
  await parseXmlPart(
    CONTENT_TYPES_PART,
    xml,
    {
      onOpen: (tag, local): void => {
        if (local !== 'Override') return;
        const partName = attributeValue(tag, 'PartName');
        const contentType = attributeValue(tag, 'ContentType');
        if (partName === undefined || contentType === undefined) return;
        if (!partName.startsWith('/')) {
          throw new ScreenplayAdapterSourceError(
            'This DOCX package was rejected: a content-type override names a relative part.',
          );
        }
        overrides.set(resolvePackagePath('', partName), contentType);
      },
    },
    context,
  );
  return { overrides };
}

/**
 * Reads a `.rels` part into a relationship index, resolving internal targets to
 * package-absolute names and refusing any that escape the package. External
 * targets keep their raw string and are flagged: the walker records them as
 * hyperlink text and never dereferences them, since this adapter has no network.
 */
export async function readRelationships(
  partName: string,
  ownerPart: string,
  xml: string | undefined,
  context: ScreenplayAdapterContext,
): Promise<Map<string, DocxRelationship>> {
  const relationships = new Map<string, DocxRelationship>();
  if (xml === undefined) return relationships;
  await parseXmlPart(
    partName,
    xml,
    {
      onOpen: (tag, local): void => {
        if (local !== 'Relationship') return;
        const id = attributeValue(tag, 'Id');
        const target = attributeValue(tag, 'Target');
        if (id === undefined || target === undefined) return;
        const external = (attributeValue(tag, 'TargetMode') ?? '').toLowerCase() === 'external';
        relationships.set(id, {
          id,
          type: attributeValue(tag, 'Type') ?? '',
          target: external ? target : resolvePackagePath(ownerPart, target),
          external,
        });
      },
    },
    context,
  );
  return relationships;
}

/**
 * Picks the main document part the way the OPC specification says to — follow the
 * package relationship of type `.../officeDocument` — and falls back through the
 * content-type override to the conventional name. A hostile package cannot use
 * this to reach outside itself: every candidate has already been resolved through
 * {@link resolvePackagePath}, and a name that is not an actual zip entry simply
 * fails to be found later.
 */
function selectDocumentPart(
  packageRelationships: ReadonlyMap<string, DocxRelationship>,
  contentTypes: ContentTypesIndex,
): string {
  for (const relationship of packageRelationships.values()) {
    if (!relationship.external && OFFICE_DOCUMENT_RELATIONSHIP.test(relationship.type)) {
      return relationship.target;
    }
  }
  for (const [partName, contentType] of contentTypes.overrides) {
    if (MAIN_DOCUMENT_CONTENT_TYPE.test(contentType)) return partName;
  }
  return DEFAULT_DOCUMENT_PART;
}

/** `word/document.xml` -> `word/_rels/document.xml.rels`. */
function relationshipPartFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  const directory = slash < 0 ? '' : partName.slice(0, slash + 1);
  const base = slash < 0 ? partName : partName.slice(slash + 1);
  return `${directory}_rels/${base}.rels`;
}

function siblingPart(partName: string, sibling: string): string {
  const slash = partName.lastIndexOf('/');
  return slash < 0 ? sibling : `${partName.slice(0, slash + 1)}${sibling}`;
}

function countBinaryParts(entryNames: readonly string[]): number {
  return entryNames.filter((name) => !name.endsWith('/') && !name.endsWith('.xml')).length;
}

async function readPackagePass(
  archive: Buffer,
  wanted: readonly string[],
  limits: BoundedZipPackageLimits,
): Promise<{ entryNames: readonly string[]; parts: ReadonlyMap<string, Buffer> }> {
  try {
    return await readBoundedZipPackage(archive, wanted, limits);
  } catch (error) {
    throw toSourceError(error);
  }
}

/**
 * Opens a DOCX and returns the parts the walker needs, having rejected every
 * hostile package shape on the way.
 *
 * Two passes over the central directory, not one: the main document part's name
 * is only known after `[Content_Types].xml` and `_rels/.rels` have been read, and
 * a package is entitled to name it something other than `word/document.xml`.
 * Both passes re-run every entry guard, and `yauzl.fromBuffer` reads only the
 * central directory to open an archive, so the second pass inflates nothing it
 * did not ask for.
 */
export async function readDocxPackage(
  bytes: Uint8Array,
  context: ScreenplayAdapterContext,
): Promise<DocxPackage> {
  assertZipSignature(bytes);
  const archive = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const limits = docxPackageLimits(context.limits);

  const first = await readPackagePass(archive, [CONTENT_TYPES_PART, PACKAGE_RELS_PART], limits);
  const contentTypesXml = decodeOptional(CONTENT_TYPES_PART, first.parts, context.limits);
  assertNoMacros(first.entryNames, contentTypesXml);
  context.throwIfCancelled();

  const contentTypes = await readContentTypes(contentTypesXml, context);
  // A relationship part resolves its targets against the part it belongs to, not
  // against its own location: `_rels/.rels` belongs to the package root, and
  // `word/_rels/document.xml.rels` belongs to `word/document.xml`.
  const packageRelationships = await readRelationships(
    PACKAGE_RELS_PART,
    '',
    decodeOptional(PACKAGE_RELS_PART, first.parts, context.limits),
    context,
  );
  const documentPartName = selectDocumentPart(packageRelationships, contentTypes);
  const documentRelsPart = relationshipPartFor(documentPartName);
  const stylesPart = siblingPart(documentPartName, 'styles.xml');
  const numberingPart = siblingPart(documentPartName, 'numbering.xml');

  const second = await readPackagePass(
    archive,
    [documentPartName, documentRelsPart, stylesPart, numberingPart],
    limits,
  );
  const documentXml = decodeOptional(documentPartName, second.parts, context.limits);
  if (documentXml === undefined) {
    throw new ScreenplayAdapterSourceError(
      `This DOCX package has no main document part (${documentPartName}).`,
    );
  }
  return {
    documentPartName,
    documentXml,
    stylesPartName: stylesPart,
    stylesXml: decodeOptional(stylesPart, second.parts, context.limits),
    numberingPartName: numberingPart,
    numberingXml: decodeOptional(numberingPart, second.parts, context.limits),
    relationships: await readRelationships(
      documentRelsPart,
      documentPartName,
      decodeOptional(documentRelsPart, second.parts, context.limits),
      context,
    ),
    entryNames: second.entryNames,
    binaryPartCount: countBinaryParts(second.entryNames),
  };
}

function decodeOptional(
  partName: string,
  parts: ReadonlyMap<string, Buffer>,
  limits: ScreenplayAdapterLimits,
): string | undefined {
  const bytes = parts.get(partName);
  return bytes === undefined ? undefined : decodeXmlPart(partName, bytes, limits);
}
