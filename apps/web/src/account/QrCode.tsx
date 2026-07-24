import { useMemo } from 'react';
import { encodeQrMatrix } from './qr-code';

/**
 * Renders `value` as a crisp, theme-agnostic QR code SVG. The code is always
 * drawn dark-on-light with a quiet zone so any authenticator app can scan it
 * regardless of the surrounding interface theme.
 */
export function QrCode({ value, size = 176 }: { value: string; size?: number }) {
  const { path, dimension } = useMemo(() => {
    const matrix = encodeQrMatrix(value);
    const quiet = 4;
    const dim = matrix.length + quiet * 2;
    const segments: string[] = [];
    for (let row = 0; row < matrix.length; row += 1) {
      for (let column = 0; column < matrix.length; column += 1) {
        if (matrix[row]![column]) {
          segments.push(`M${column + quiet} ${row + quiet}h1v1h-1z`);
        }
      }
    }
    return { path: segments.join(''), dimension: dim };
  }, [value]);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${dimension} ${dimension}`}
      role="img"
      aria-label="QR code for authenticator app enrollment"
      shapeRendering="crispEdges"
      style={{ background: '#ffffff', borderRadius: 6, display: 'block' }}
    >
      <path d={path} fill="#000000" />
    </svg>
  );
}
