/**
 * Local type surface for `sax` (1.6.1), the streaming XML parser qualified in
 * `docs/adr-rtf-docx-parser-qualification.md` for OOXML part parsing.
 *
 * `sax` ships no types of its own. This declares only the subset the DOCX
 * adapter uses rather than adding `@types/sax`, because a new dependency — even
 * a types-only one — has to clear the same evidence bar (`pnpm audit`,
 * `pnpm credits:check`, dependency review) that the ADR applied to the runtime
 * packages, for no benefit over the declarations below.
 */
declare module 'sax' {
  export interface SaxTag {
    readonly name: string;
    readonly attributes: Record<string, string>;
    readonly isSelfClosing: boolean;
  }

  export interface SaxParserOptions {
    /** Trim whitespace around text nodes. Kept false: OOXML runs carry significant spaces. */
    readonly trim?: boolean;
    readonly normalize?: boolean;
    /** Lowercase tag and attribute names. Kept false so `w:p` survives verbatim. */
    readonly lowercase?: boolean;
    /** Namespace resolution. Kept false; the walker matches on local names itself. */
    readonly xmlns?: boolean;
    readonly position?: boolean;
    /** Accept only the five predefined XML entities; anything else raises an error. */
    readonly strictEntities?: boolean;
  }

  export interface SaxParser {
    onopentag: ((tag: SaxTag) => void) | undefined;
    onclosetag: ((name: string) => void) | undefined;
    ontext: ((text: string) => void) | undefined;
    oncdata: ((text: string) => void) | undefined;
    ondoctype: ((doctype: string) => void) | undefined;
    onerror: ((error: Error) => void) | undefined;
    onend: (() => void) | undefined;
    write(chunk: string): SaxParser;
    close(): SaxParser;
    resume(): SaxParser;
  }

  export function parser(strict: boolean, options?: SaxParserOptions): SaxParser;
}
