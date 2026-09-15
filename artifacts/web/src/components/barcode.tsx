import { useMemo } from 'react';

/**
 * Self-contained Code 39 barcode (no external dependency, works fully offline).
 * Code 39 covers digits, upper-case letters, and `- . $ / + %` which is exactly
 * what the document numbering scheme uses (e.g. C-IN-2026-000123).
 */

// Each character: 9 elements (bar,space,bar,space,bar,space,bar,space,bar).
// 1 = wide, 0 = narrow.
const PATTERNS: Record<string, string> = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
  '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
  '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
  'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000',
  'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
  'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
  'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
  'S': '001000110', 'T': '000010110', 'U': '110000001', 'V': '011000001',
  'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
  '-': '010000101', '.': '110000100', ' ': '011000100', '$': '010101000',
  '/': '010100010', '+': '010001010', '%': '000101010', '*': '010010100',
};

const NARROW = 2;
const WIDE = 5;
const HEIGHT = 46;

export function Barcode({ value, height = HEIGHT, showValue = true }: { value: string; height?: number; showValue?: boolean }) {
  const bars = useMemo(() => {
    const normalized = String(value ?? '').toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '-');
    if (!normalized) return [];
    const sequence = `*${normalized}*`;
    const out: Array<{ x: number; w: number }> = [];
    let x = 0;
    for (const char of sequence) {
      const pattern = PATTERNS[char] ?? PATTERNS['-'];
      for (let i = 0; i < 9; i += 1) {
        const width = pattern[i] === '1' ? WIDE : NARROW;
        if (i % 2 === 0) out.push({ x, w: width }); // even index = bar
        x += width;
      }
      x += NARROW; // inter-character gap
    }
    return out;
  }, [value]);

  if (bars.length === 0) return null;
  const width = bars.reduce((max, bar) => Math.max(max, bar.x + bar.w), 0) + 4;

  return (
    <div className="inline-block text-center" dir="ltr">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`باركود ${value}`}>
        <rect x="0" y="0" width={width} height={height} fill="#fff" />
        {bars.map((bar, index) => (
          <rect key={index} x={bar.x + 2} y="0" width={bar.w} height={height} fill="#000" />
        ))}
      </svg>
      {showValue && <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 1 }}>{value}</div>}
    </div>
  );
}
