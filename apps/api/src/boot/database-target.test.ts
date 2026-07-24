import { describe, expect, it } from 'vitest';
import { parseDatabaseTarget } from './database-target';

describe('parseDatabaseTarget', () => {
  it('extracts only the host and port, defaulting to 5432', () => {
    expect(parseDatabaseTarget('postgresql://user:secret@db.example.com/coda')).toEqual({
      host: 'db.example.com',
      port: 5432,
    });
  });

  it('extracts an explicit port', () => {
    expect(parseDatabaseTarget('postgresql://user:secret@db.example.com:6543/coda')).toEqual({
      host: 'db.example.com',
      port: 6543,
    });
  });

  it('never includes the credentials, database name, or query string', () => {
    const url = 'postgresql://admin:hunter2@db.internal:5432/coda?sslmode=require';
    const target = parseDatabaseTarget(url);
    const serialized = JSON.stringify(target);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('admin');
    expect(serialized).not.toContain('coda');
    expect(serialized).not.toContain('sslmode');
  });

  it('falls back to a placeholder host for an unparsable URL', () => {
    expect(parseDatabaseTarget('not a url')).toEqual({ host: 'unknown', port: 0 });
  });
});
