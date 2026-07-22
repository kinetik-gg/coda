const DEFAULT_FILENAME = 'untitled-screenplay.fountain';

function lastPathSegment(value: string): string {
  return value.replace(/\\/g, '/').split('/').at(-1) ?? '';
}

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
}

export function fountainFilenameFromTitle(title: string): string {
  const stem = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return stem ? `${stem}.fountain` : DEFAULT_FILENAME;
}

export function normalizeImportedFilename(filename: string): string {
  const basename = stripControlCharacters(lastPathSegment(filename));
  return basename || DEFAULT_FILENAME;
}

export function safeDownloadFilename(filename: string): string {
  const normalized = normalizeImportedFilename(filename);
  const stem = normalized.replace(/\.(?:fountain|spmd|txt)$/i, '');
  const safeStem = stem
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .trim()
    .slice(0, 200);
  return `${safeStem || 'screenplay'}.fountain`;
}

export function titleFromFountain(filename: string, sourceText: string): string {
  const lines = sourceText.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^Title:\s*(.*)$/i.exec(lines[index] ?? '');
    if (!match) {
      if (lines[index]?.trim() === '') break;
      continue;
    }
    const inlineTitle = match[1]?.trim();
    if (inlineTitle) return inlineTitle.slice(0, 160);
    const continuation: string[] = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? '';
      if (!/^\s+\S/.test(line)) break;
      continuation.push(line.trim());
    }
    const multilineTitle = continuation.join(' ').trim();
    if (multilineTitle) return multilineTitle.slice(0, 160);
    break;
  }

  const basename = normalizeImportedFilename(filename).replace(/\.(?:fountain|spmd|txt)$/i, '');
  return basename.trim().slice(0, 160) || 'Untitled Screenplay';
}
