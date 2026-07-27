import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { collectDeclaredFontTokens, formatViolations, inspectStylesheet } from './font-tokens';

const tokensCss = readFileSync('packages/design-tokens/tokens.css', 'utf8');
const tokensTs = readFileSync('packages/design-tokens/src/index.ts', 'utf8');
const tokens = collectDeclaredFontTokens(tokensCss);

describe('collectDeclaredFontTokens', () => {
  it('reads every step of the shipped ladder', () => {
    expect([...tokens].sort()).toEqual([
      '--coda-font-2xl',
      '--coda-font-2xs',
      '--coda-font-lg',
      '--coda-font-md',
      '--coda-font-sm',
      '--coda-font-xl',
      '--coda-font-xs',
    ]);
  });

  it('ignores custom properties from other families', () => {
    expect(collectDeclaredFontTokens(':root { --coda-space-1: 2px; }').size).toBe(0);
  });

  it('keeps the stylesheet ladder identical to the typed mirror', () => {
    const fromCss = [...tokensCss.matchAll(/^\s*--coda-font-([a-z0-9]+)\s*:\s*(\d+)px;/gmu)].map(
      (match) => `${match[1]}=${match[2]}`,
    );
    const fromTs = [
      ...(/CODA_FONT_SIZE = \{(?<body>[^}]*)\}/u.exec(tokensTs)?.groups?.body ?? '').matchAll(
        /'?([a-z0-9]+)'?\s*:\s*(\d+)/gu,
      ),
    ].map((match) => `${match[1]}=${match[2]}`);
    expect(fromCss).toEqual(fromTs);
    expect(fromCss).toEqual(['2xs=11', 'xs=12', 'sm=13', 'md=15', 'lg=17', 'xl=20', '2xl=28']);
  });
});

describe('inspectStylesheet', () => {
  it('accepts declarations built from the ladder', () => {
    const source = [
      '.row {',
      '  font-size: var(--coda-font-md);',
      '}',
      '.cell {',
      '  font: 500 var(--coda-font-2xs) Inter, sans-serif;',
      '}',
    ].join('\n');
    expect(inspectStylesheet('a.css', source, tokens)).toEqual([]);
  });

  it('accepts a density-scaled token', () => {
    const source = '.p { font-size: calc(var(--coda-font-xs) * var(--workspace-text-scale, 1)); }';
    expect(inspectStylesheet('a.css', source, tokens)).toEqual([]);
  });

  it('rejects a pixel literal on font-size', () => {
    const violations = inspectStylesheet('a.css', '.p {\n  font-size: 11px;\n}', tokens);
    expect(violations).toEqual([
      {
        column: 3,
        file: 'a.css',
        line: 2,
        message: 'hardcoded pixel font size; use a --coda-font-* token',
        snippet: 'font-size: 11px',
      },
    ]);
  });

  it('rejects a pixel literal hidden in the font shorthand', () => {
    const violations = inspectStylesheet('a.css', ".p { font: 400 9px 'Space Mono'; }", tokens);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.snippet).toBe("font: 400 9px 'Space Mono'");
  });

  it('rejects a pixel literal inside a clamp or calc', () => {
    const source = '.p { font-size: clamp(11px, 2.8vw, 15px); }';
    expect(inspectStylesheet('a.css', source, tokens)).toHaveLength(1);
  });

  it('ignores keyword-only font shorthands', () => {
    expect(inspectStylesheet('a.css', '.p { font: inherit; }', tokens)).toEqual([]);
  });

  it('ignores pixel literals on unrelated properties', () => {
    const source = '.p { line-height: 18px; letter-spacing: 1px; --font-size-hint: 9px; }';
    expect(inspectStylesheet('a.css', source, tokens)).toEqual([]);
  });

  it('permits the documented screenplay typography exception', () => {
    const source =
      '.editor { font-size: var(--screenplay-effective-font-size, var(--screenplay-editor-font-size, 14px)); }';
    expect(inspectStylesheet('a.css', source, tokens)).toEqual([]);
  });

  it('permits em-relative sizes derived from the script font', () => {
    expect(inspectStylesheet('a.css', '.note { font-size: 0.92em; }', tokens)).toEqual([]);
  });

  it('rejects a reference to an undeclared font token', () => {
    const violations = inspectStylesheet(
      'a.css',
      '.p { font-size: var(--coda-font-3xl); }',
      tokens,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('undefined font token --coda-font-3xl');
  });
});

describe('formatViolations', () => {
  it('renders one addressable diagnostic per violation', () => {
    const violations = inspectStylesheet('a.css', '.p {\n  font-size: 11px;\n}', tokens);
    expect(formatViolations(violations)).toBe(
      'a.css:2:3  hardcoded pixel font size; use a --coda-font-* token\n    font-size: 11px',
    );
  });
});
