import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { bytes, dateTime, duration, errorText, metadataEntries } from './utils';

describe('admin display utilities', () => {
  it('formats byte values across units and handles invalid input', () => {
    expect(bytes(999)).toBe('999 B');
    expect(bytes(1500)).toMatch(/^1[.,]5 KB$/);
    expect(bytes(2_500_000)).toMatch(/^2[.,]5 MB$/);
    expect(bytes('invalid')).toBe('Unavailable');
  });

  it('formats durations and invalid values', () => {
    expect(duration(90)).toBe('1m');
    expect(duration(90_061)).toBe('1d 1h 1m');
    expect(duration(Number.NaN)).toBe('Unavailable');
  });

  it('formats dates with safe empty and invalid fallbacks', () => {
    expect(dateTime(null)).toBe('Never');
    expect(dateTime('not-a-date')).toBe('Unavailable');
    expect(dateTime('2026-07-22T00:00:00.000Z')).not.toBe('Unavailable');
  });

  it('bounds and normalizes metadata for safe display', () => {
    expect(metadataEntries(null)).toEqual([]);
    expect(metadataEntries(['not', 'an', 'object'])).toEqual([]);
    const entries = metadataEntries({
      first_key: 'value',
      nested: { secret: 'not expanded' },
      third: true,
      fourth: 4,
      fifth: null,
      sixth: 'six',
      seventh: 'omitted',
    });
    expect(entries).toHaveLength(6);
    expect(entries[0]).toEqual(['first key', 'value']);
    expect(entries[1]).toEqual(['nested', 'Structured data']);
  });

  it('uses safe API problem details without exposing unknown errors', () => {
    const error = new ApiError({
      type: 'test',
      title: 'Conflict',
      status: 409,
      detail: 'Stale row',
    });
    expect(errorText(error, 'Fallback')).toBe('Stale row');
    expect(errorText(new Error('private'), 'Fallback')).toBe('Fallback');
  });
});
