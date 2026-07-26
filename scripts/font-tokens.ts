/**
 * Type-scale conformance rules for the web client stylesheets.
 *
 * Two invariants are enforced:
 *
 * 1. No stylesheet under `apps/web/src` may express a font size as a raw
 *    pixel literal. Every size comes from the `--coda-font-*` ladder in
 *    `packages/design-tokens/tokens.css`, optionally multiplied by the
 *    workspace density control.
 * 2. Every `var(--coda-font-*)` reference must name a token that the
 *    design-tokens stylesheet actually declares. An undefined custom
 *    property is invalid at computed-value time, so the element silently
 *    inherits its parent size instead of failing loudly.
 *
 * The permitted exceptions are enumerated in `FONT_PX_EXCEPTIONS` below and
 * documented in `AGENTS.md`; they are matched on the declaration value, not
 * on a file or line number, so they cannot drift.
 */

/** A declaration that failed one of the two invariants. */
export interface FontTokenViolation {
  column: number;
  file: string;
  line: number;
  message: string;
  snippet: string;
}

/**
 * Declaration values allowed to carry a pixel literal.
 *
 * `--screenplay-editor-font-size` is user-controlled script typography that
 * drives PDF page fidelity: it is deliberately not part of the interface
 * ladder, and its `14px` fallback is the documented default script size.
 */
const FONT_PX_EXCEPTIONS: readonly RegExp[] = [
  /--screenplay-effective-font-size/u,
  /--screenplay-editor-font-size/u,
];

const FONT_DECLARATION_PATTERN = /(?<![\w-])(font-size|font)\s*:\s*([^;{}]*)/gu;
const PIXEL_LITERAL_PATTERN = /(?<![\w-])\d+(?:\.\d+)?px/u;
const FONT_TOKEN_REFERENCE_PATTERN = /var\(\s*(--coda-font-[a-z0-9-]+)/gu;
const FONT_TOKEN_DECLARATION_PATTERN = /^\s*(--coda-font-[a-z0-9-]+)\s*:/gmu;

/** Reads the `--coda-font-*` custom properties a tokens stylesheet declares. */
export function collectDeclaredFontTokens(tokensCss: string): Set<string> {
  const declared = new Set<string>();
  for (const [, token] of tokensCss.matchAll(FONT_TOKEN_DECLARATION_PATTERN)) {
    if (token) declared.add(token);
  }
  return declared;
}

function locate(source: string, index: number): { column: number; line: number } {
  const preceding = source.slice(0, index);
  const lastBreak = preceding.lastIndexOf('\n');
  return { column: index - lastBreak, line: preceding.split('\n').length };
}

function normalise(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function isFontShorthandWithSize(property: string, value: string): boolean {
  // `font: inherit` and the system keywords carry no size; only shorthand
  // values that actually spell out a size are interesting here.
  return property !== 'font' || /\d/u.test(value);
}

function collectPixelLiteralViolations(file: string, source: string): FontTokenViolation[] {
  const violations: FontTokenViolation[] = [];
  for (const match of source.matchAll(FONT_DECLARATION_PATTERN)) {
    const property = match[1] ?? '';
    const value = normalise(match[2] ?? '');
    if (!isFontShorthandWithSize(property, value)) continue;
    if (!PIXEL_LITERAL_PATTERN.test(value)) continue;
    if (FONT_PX_EXCEPTIONS.some((exception) => exception.test(value))) continue;
    const { column, line } = locate(source, match.index);
    violations.push({
      column,
      file,
      line,
      message: 'hardcoded pixel font size; use a --coda-font-* token',
      snippet: `${property}: ${value}`,
    });
  }
  return violations;
}

function collectUndefinedTokenViolations(
  file: string,
  source: string,
  declaredTokens: ReadonlySet<string>,
): FontTokenViolation[] {
  const violations: FontTokenViolation[] = [];
  for (const match of source.matchAll(FONT_TOKEN_REFERENCE_PATTERN)) {
    const token = match[1] ?? '';
    if (declaredTokens.has(token)) continue;
    const { column, line } = locate(source, match.index);
    violations.push({
      column,
      file,
      line,
      message: `undefined font token ${token}; declare it in packages/design-tokens/tokens.css`,
      snippet: `var(${token})`,
    });
  }
  return violations;
}

/** Applies both invariants to one stylesheet. */
export function inspectStylesheet(
  file: string,
  source: string,
  declaredTokens: ReadonlySet<string>,
): FontTokenViolation[] {
  return [
    ...collectPixelLiteralViolations(file, source),
    ...collectUndefinedTokenViolations(file, source, declaredTokens),
  ];
}

/** Renders violations as one `file:line:column` diagnostic per line. */
export function formatViolations(violations: readonly FontTokenViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.file}:${String(violation.line)}:${String(violation.column)}  ${violation.message}\n    ${violation.snippet}`,
    )
    .join('\n');
}
