export type Rgb = readonly [red: number, green: number, blue: number];

export function parseHexColor(value: string): Rgb | undefined {
  const normalized = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(normalized);
  if (short) {
    return [
      Number.parseInt(short[1]! + short[1]!, 16),
      Number.parseInt(short[2]! + short[2]!, 16),
      Number.parseInt(short[3]! + short[3]!, 16),
    ];
  }
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(normalized);
  if (!full) return undefined;
  return [
    Number.parseInt(full[1]!, 16),
    Number.parseInt(full[2]!, 16),
    Number.parseInt(full[3]!, 16),
  ];
}

export function mapPdfPixelsToTheme(pixels: Uint8ClampedArray, page: Rgb, ink: Rgb): void {
  for (let index = 0; index < pixels.length; index += 4) {
    // Integer Rec. 709 luminance weights. White becomes the page color and black becomes ink.
    const luminance =
      (54 * pixels[index]! + 183 * pixels[index + 1]! + 19 * pixels[index + 2]!) >> 8;
    const inkWeight = 255 - luminance;
    pixels[index] = Math.round((page[0] * luminance + ink[0] * inkWeight) / 255);
    pixels[index + 1] = Math.round((page[1] * luminance + ink[1] * inkWeight) / 255);
    pixels[index + 2] = Math.round((page[2] * luminance + ink[2] * inkWeight) / 255);
  }
}
