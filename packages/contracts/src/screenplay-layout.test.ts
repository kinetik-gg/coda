import { describe, expect, it } from 'vitest';
import {
  SCREENPLAY_LAYOUT_MAX_BYTES,
  saveScreenplayLayoutSchema,
  screenplayLayoutSchema,
} from './screenplay-layout';

describe('screenplayLayoutSchema', () => {
  it('accepts an opaque layout with a positive integer schemaVersion', () => {
    const parsed = screenplayLayoutSchema.parse({ schemaVersion: 2, root: { kind: 'panel' } });
    expect(parsed).toMatchObject({ schemaVersion: 2, root: { kind: 'panel' } });
  });

  it('rejects a missing or non-positive schemaVersion', () => {
    expect(screenplayLayoutSchema.safeParse({ root: {} }).success).toBe(false);
    expect(screenplayLayoutSchema.safeParse({ schemaVersion: 0 }).success).toBe(false);
    expect(screenplayLayoutSchema.safeParse({ schemaVersion: 1.5 }).success).toBe(false);
  });

  it('rejects a layout larger than the byte cap', () => {
    const oversized = { schemaVersion: 1, blob: 'x'.repeat(SCREENPLAY_LAYOUT_MAX_BYTES) };
    expect(screenplayLayoutSchema.safeParse(oversized).success).toBe(false);
  });
});

describe('saveScreenplayLayoutSchema', () => {
  it('requires a layout and a non-negative expectedRevision', () => {
    expect(
      saveScreenplayLayoutSchema.safeParse({
        layout: { schemaVersion: 2 },
        expectedRevision: 0,
      }).success,
    ).toBe(true);
    expect(
      saveScreenplayLayoutSchema.safeParse({ layout: { schemaVersion: 2 }, expectedRevision: -1 })
        .success,
    ).toBe(false);
    expect(saveScreenplayLayoutSchema.safeParse({ layout: { schemaVersion: 2 } }).success).toBe(
      false,
    );
  });

  it('rejects unknown top-level keys', () => {
    expect(
      saveScreenplayLayoutSchema.safeParse({
        layout: { schemaVersion: 2 },
        expectedRevision: 0,
        extra: true,
      }).success,
    ).toBe(false);
  });
});
