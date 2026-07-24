import { describe, expect, it } from 'vitest';
import {
  CODA_CHROME,
  CODA_FONT_SIZE,
  CODA_FONT_WEIGHT,
  CODA_LINE_HEIGHT_UI,
  CODA_MOTION,
  CODA_SPACE,
} from './index';

describe('design tokens', () => {
  it('mirrors the binding spacing scale', () => {
    expect(CODA_SPACE).toEqual({
      space1: 2,
      space2: 4,
      space3: 6,
      space4: 8,
      space5: 12,
      space6: 16,
      space7: 24,
      space8: 32,
    });
  });

  it('mirrors the binding type scale', () => {
    expect(CODA_FONT_SIZE).toEqual({
      '2xs': 10,
      xs: 11,
      sm: 12,
      md: 13,
      xl: 20,
    });
    expect(CODA_FONT_WEIGHT).toEqual({ regular: 400, medium: 500, semibold: 600 });
    expect(CODA_LINE_HEIGHT_UI).toBe(1.45);
  });

  it('mirrors the binding chrome scale', () => {
    expect(CODA_CHROME).toEqual({
      hMasthead: 46,
      hMenu: 28,
      hPanelhead: 30,
      hDensrow: 28,
      hStatusbar: 26,
      wRail: 208,
    });
  });

  it('mirrors the reused motion primitives', () => {
    expect(CODA_MOTION).toEqual({
      fast: '180ms',
      easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
    });
  });
});
