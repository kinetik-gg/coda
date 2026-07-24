// Reduces a User-Agent header to a coarse "<browser> on <os>" label at session
// creation time. This is the only user-agent-derived value ever persisted --
// the raw header is discarded once classified. Order matters: browsers and
// operating systems that embed another product's token in their own UA string
// (Edge/Opera embed Chrome; mobile UAs embed a desktop OS token) must be
// checked before the string they contain.

const MAX_USER_AGENT_CLASS_LENGTH = 64;

const BROWSER_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Edge', /Edg\//],
  ['Opera', /OPR\//],
  ['Samsung Internet', /SamsungBrowser\//],
  ['Chrome', /Chrome\//],
  ['Firefox', /Firefox\//],
  ['Safari', /Version\/[\d.]+.*Safari\//],
];

const OS_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['iOS', /iPhone|iPad|iPod/],
  ['Android', /Android/],
  ['ChromeOS', /CrOS/],
  ['Windows', /Windows NT/],
  ['macOS', /Macintosh|Mac OS X/],
  ['Linux', /Linux/],
];

function match(userAgent: string, patterns: ReadonlyArray<readonly [string, RegExp]>): string {
  return patterns.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? 'Other';
}

export function classifyUserAgent(userAgent: string | undefined | null): string {
  const trimmed = userAgent?.trim();
  if (!trimmed) return 'Unknown';
  const browser = match(trimmed, BROWSER_PATTERNS);
  const os = match(trimmed, OS_PATTERNS);
  return `${browser} on ${os}`.slice(0, MAX_USER_AGENT_CLASS_LENGTH);
}
