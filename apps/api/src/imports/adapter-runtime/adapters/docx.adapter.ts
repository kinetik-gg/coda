import { ScreenplayAdapterSourceError } from '@coda/contracts';
import type {
  ScreenplayAdapter,
  ScreenplayAdapterContext,
  ScreenplayAdapterInput,
  ScreenplayAdapterOutput,
  ScreenplayConversionWarning,
} from '@coda/contracts';
import { readDocxPackage, type DocxPackage } from './docx/docx-package';
import { parseDocxDocument } from './docx/docx-document';
import { parseDocxNumbering, parseDocxStyles } from './docx/docx-styles';
import { buildDocxConversion } from './docx/docx-fountain';

/**
 * The source-format slug this adapter answers for. It matches the value the
 * artifact reservation flow already accepts for Word documents, so the
 * artifact's `sourceFormat` column stays meaningful outside the runtime.
 */
export const DOCX_SOURCE_FORMAT = 'docx';

/**
 * DOCX import, built on the primitive #247 qualified rather than on a one-call
 * DOCX library.
 *
 * The FDX (#246) and HTML (#250) adapters are thin because their conversion
 * lives in `@coda/fountain`, which parses a single hostile *string*. DOCX cannot
 * follow them there: it needs archive access (`yauzl`), and `@coda/fountain` is
 * a dependency-free package shared with the browser bundle, which has a
 * 512,000-byte entry-chunk budget. So the conversion lives here, server-side,
 * split across four modules — `docx-package` (archive), `docx-xml` (per-part
 * decode, preflight, and SAX walk), `docx-document`/`docx-styles` (the
 * WordprocessingML model), and `docx-fountain` (mapping and report).
 *
 * The one thing it does share with them is the XML preflight: `docx-xml` runs
 * `@coda/fountain`'s `assertXmlPreflight` over *every* part it decodes, which is
 * exactly why #246 extracted it.
 *
 * The whole pipeline is `await`ed part by part and chunk by chunk. That is not
 * incidental — the runtime's soft deadline is a timer that only fires when the
 * adapter returns to its event loop, and an adapter that never does is hard
 * `terminate()`d instead of reporting an attributable `timeout`.
 */
class DocxAdapter implements ScreenplayAdapter {
  readonly id = 'coda.docx';
  readonly version = '1';
  readonly sourceFormats = [DOCX_SOURCE_FORMAT] as const;

  async convert(
    input: ScreenplayAdapterInput,
    context: ScreenplayAdapterContext,
  ): Promise<ScreenplayAdapterOutput> {
    context.throwIfCancelled();
    const docxPackage = await readDocxPackage(input.bytes, context);
    context.reportProgress({ stage: 'package', completed: 1, total: 3 });

    const styleNames = await parseDocxStyles(
      docxPackage.stylesPartName,
      docxPackage.stylesXml,
      context,
    );
    const numbering = await parseDocxNumbering(
      docxPackage.numberingPartName,
      docxPackage.numberingXml,
      context,
    );
    context.reportProgress({ stage: 'styles', completed: 2, total: 3 });

    const document = await parseDocxDocument(
      docxPackage.documentXml,
      {
        partName: docxPackage.documentPartName,
        relationships: docxPackage.relationships,
        numbering,
        styleNames,
      },
      context,
    );
    context.throwIfCancelled();
    context.reportProgress({ stage: 'document', completed: 3, total: 3 });

    const conversion = buildDocxConversion(document, {
      limits: context.limits,
      packageWarnings: packageWarnings(docxPackage),
    });
    if (conversion.elements.length === 0) {
      throw new ScreenplayAdapterSourceError(
        'This DOCX package contains no text to import.',
      );
    }
    return conversion;
  }
}

/**
 * Document-level notes about the package itself, as opposed to any one
 * paragraph. Both say something the reader cannot see from the converted text:
 * that content was left behind, or that every classification below was a guess.
 */
function packageWarnings(docxPackage: DocxPackage): ScreenplayConversionWarning[] {
  const warnings: ScreenplayConversionWarning[] = [];
  if (docxPackage.binaryPartCount > 0) {
    warnings.push({
      code: 'DOCX_BINARY_PARTS_SKIPPED',
      message:
        `${docxPackage.binaryPartCount} non-XML parts (images, fonts, or embedded objects) ` +
        'were left in the retained original and not imported.',
    });
  }
  if (docxPackage.stylesXml === undefined) {
    warnings.push({
      code: 'DOCX_STYLES_MISSING',
      message:
        'This package has no styles part, so every paragraph was classified from its text alone.',
    });
  }
  return warnings;
}

export function createDocxAdapter(): ScreenplayAdapter {
  return new DocxAdapter();
}
