import { BadRequestException } from '@nestjs/common';

/**
 * Opaque keyset cursor shared by every id-paginated list surface (breakdown items, tracker
 * records): the wire token is the base64url of `{ id }`, and decoding only ever yields that shape.
 */
export function encodeCursor(id: string) {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { id: string } {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id: string };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
