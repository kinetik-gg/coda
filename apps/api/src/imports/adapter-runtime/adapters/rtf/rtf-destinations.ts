/**
 * Which RTF destinations carry no screenplay text and must be skipped whole.
 *
 * RTF hides an enormous amount of non-document data in destination groups: font
 * and colour tables, style sheets, revision-save identifier lists, embedded
 * pictures and OLE objects, list definitions, and application-private blobs. A
 * reader that walks into them emits their contents as if they were prose, which
 * is how naive RTF-to-text converters produce pages of hex from a single pasted
 * image.
 *
 * Two mechanisms cover this. `{\*\name ...}` marks any destination as ignorable
 * by construction, including ones invented after this code was written, and is
 * handled generically by the walker. This table covers the destinations that are
 * *not* marked ignorable but still hold no body text — a reader is expected to
 * know them by name.
 */

/**
 * Destinations skipped in full. Keyed by control word without its backslash.
 *
 * `fldinst` is here as belt and braces: field instructions are normally written
 * as `{\*\fldinst ...}`, and skipping them while keeping `{\fldrslt ...}` is
 * what makes a page-number or cross-reference field contribute its rendered
 * text instead of its formula.
 */
const SKIPPED_DESTINATIONS: ReadonlySet<string> = new Set([
  'aftnsep',
  'aftnsepc',
  'annotation',
  'atnauthor',
  'atndate',
  'atnid',
  'atnparent',
  'atnref',
  'atntime',
  'bkmkend',
  'bkmkstart',
  'colorschememapping',
  'colortbl',
  'datastore',
  'do',
  'docvar',
  'falt',
  'fchars',
  'ffdeftext',
  'ffname',
  'filetbl',
  'fldinst',
  'fonttbl',
  'footer',
  'footerf',
  'footerl',
  'footerr',
  'footnote',
  'ftncn',
  'ftnsep',
  'ftnsepc',
  'generator',
  'header',
  'headerf',
  'headerl',
  'headerr',
  'info',
  'latentstyles',
  'lchars',
  'listtable',
  'listoverridetable',
  'mmathPr',
  'nesttableprops',
  'nonshppict',
  'objdata',
  'object',
  'objclass',
  'objname',
  'operator',
  'panose',
  'pict',
  'private1',
  'protusertbl',
  'pntxta',
  'pntxtb',
  'result',
  'revtbl',
  'rsidtbl',
  'shpgrp',
  'shpinst',
  'shppict',
  'stylesheet',
  'svb',
  'tc',
  'tcn',
  'template',
  'themedata',
  'upr',
  'userprops',
  'xe',
  'xmlnstbl',
  'xmlopen',
]);

/**
 * Destinations whose loss is worth telling the reader about, mapped to the words
 * a reader would use. The rest — font tables, revision identifiers, private
 * blobs — carry nothing a screenplay reader could act on, so warning about them
 * would be noise that crowds out the warnings that matter.
 */
const NOTABLE_DESTINATIONS: ReadonlyMap<string, string> = new Map([
  ['annotation', 'comments'],
  ['do', 'drawing objects'],
  ['footer', 'page footers'],
  ['footerf', 'page footers'],
  ['footerl', 'page footers'],
  ['footerr', 'page footers'],
  ['footnote', 'footnotes'],
  ['header', 'page headers'],
  ['headerf', 'page headers'],
  ['headerl', 'page headers'],
  ['headerr', 'page headers'],
  ['nonshppict', 'embedded images'],
  ['object', 'embedded objects'],
  ['objdata', 'embedded objects'],
  ['pict', 'embedded images'],
  ['shppict', 'embedded images'],
  ['shpinst', 'drawing objects'],
]);

/** Whether `word` names a destination whose entire group carries no body text. */
export function isSkippedDestination(word: string): boolean {
  return SKIPPED_DESTINATIONS.has(word);
}

/** A reader-facing name for a skipped destination, or `undefined` when not worth reporting. */
export function notableDestinationLabel(word: string): string | undefined {
  return NOTABLE_DESTINATIONS.get(word);
}
