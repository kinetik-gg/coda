import { describe, expect, it } from 'vitest';
import { mapPdfPixelsToTheme, parseHexColor } from './pdf-theme';

describe('PDF theme mapping', () => {
  it('parses short and full theme colors', () => {
    expect(parseHexColor('#fff')).toEqual([255, 255, 255]);
    expect(parseHexColor('#11111b')).toEqual([17, 17, 27]);
    expect(parseHexColor('black')).toBeUndefined();
  });

  it('maps paper to the theme background and ink to its light text', () => {
    const pixels = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    mapPdfPixelsToTheme(pixels, [17, 17, 27], [205, 214, 244]);
    expect([...pixels]).toEqual([17, 17, 27, 255, 205, 214, 244, 255]);
  });
});
