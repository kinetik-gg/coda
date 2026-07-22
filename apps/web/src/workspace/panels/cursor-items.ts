import { apiCursorPage, type CursorPage } from '../../api';

export const ENTITY_PAGE_SIZE = 250;

export function withCursor(path: string, cursor?: string): string {
  if (!cursor) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}cursor=${encodeURIComponent(cursor)}`;
}

export async function fetchAllCursorItems<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  const visited = new Set<string>();
  let cursor: string | undefined;
  do {
    const page: CursorPage<T> = await apiCursorPage<T>(withCursor(path, cursor), { signal });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && visited.has(cursor)) throw new Error('The item cursor did not advance.');
    if (cursor) visited.add(cursor);
  } while (cursor);
  return items;
}
