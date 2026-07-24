/**
 * Typed mirrors of the custom properties declared in `tokens.css`.
 *
 * Intended for non-CSS consumers (a future Electron shell chrome, build
 * tooling, screenshot fixtures) that need the same numeric values without
 * parsing CSS. Every value here must stay byte-identical with `tokens.css`.
 */

/** Spacing scale — 2/4px base consistent with existing editor density. */
export const CODA_SPACE = {
  space1: 2,
  space2: 4,
  space3: 6,
  space4: 8,
  space5: 12,
  space6: 16,
  space7: 24,
  space8: 32,
} as const satisfies Record<string, number>;

export type CodaSpaceToken = keyof typeof CODA_SPACE;

/** Typographic scale, in px. Weights are restricted to 400/500/600. */
export const CODA_FONT_SIZE = {
  '2xs': 10,
  xs: 11,
  sm: 12,
  md: 13,
  xl: 20,
} as const satisfies Record<string, number>;

export type CodaFontSizeToken = keyof typeof CODA_FONT_SIZE;

/** The only font weights new UI work may use. */
export const CODA_FONT_WEIGHT = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const satisfies Record<string, number>;

export type CodaFontWeightToken = keyof typeof CODA_FONT_WEIGHT;

/** Line-height for UI text (not prose/document content). */
export const CODA_LINE_HEIGHT_UI = 1.45;

/** Elevation/chrome heights and widths, in px. */
export const CODA_CHROME = {
  hMasthead: 46,
  hMenu: 28,
  hPanelhead: 30,
  hDensrow: 28,
  hStatusbar: 26,
  wRail: 208,
} as const satisfies Record<string, number>;

export type CodaChromeToken = keyof typeof CODA_CHROME;

/**
 * Motion primitives. No new motion tokens exist for this scale — these
 * mirror the values already declared in apps/web/src/global.css so
 * non-CSS consumers have a single typed source for them too.
 */
export const CODA_MOTION = {
  fast: '180ms',
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const satisfies Record<string, string>;

export type CodaMotionToken = keyof typeof CODA_MOTION;
