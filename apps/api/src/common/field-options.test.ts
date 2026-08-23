import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  assertOptionsAllowed,
  reconcileRankedOptions,
  type RankedOptionDelegate,
} from './field-options';

function delegate(): RankedOptionDelegate & {
  updateMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
} {
  return {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  };
}

describe('assertOptionsAllowed', () => {
  it('refuses options on non-enum fields', () => {
    expect(() => assertOptionsAllowed('TEXT', [{ label: 'nope' }])).toThrow(BadRequestException);
    expect(assertOptionsAllowed('MULTI_ENUM', [{ label: 'ok' }])).toBeUndefined();
    expect(assertOptionsAllowed('TEXT', undefined)).toBeUndefined();
    expect(assertOptionsAllowed('TEXT', [])).toBeUndefined();
  });

  it('refuses case-insensitive duplicate labels', () => {
    expect(() => assertOptionsAllowed('ENUM', [{ label: 'Open' }, { label: 'open' }])).toThrow(
      'Option labels must be unique',
    );
  });
});

describe('reconcileRankedOptions', () => {
  it('archives missing options and updates known ids in request order', async () => {
    const tx = delegate();
    await reconcileRankedOptions(
      tx,
      'field-1',
      [{ id: 'a' }, { id: 'b' }],
      [
        { id: 'b', label: 'Renamed', color: null },
        { id: 'a', label: 'First', color: 'red' },
      ],
    );
    expect(tx.updateMany).toHaveBeenCalledWith({
      where: { fieldId: 'field-1', id: { notIn: ['b', 'a'] }, archivedAt: null },
      data: { archivedAt: expect.any(Date) as Date },
    });
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(tx.create).not.toHaveBeenCalled();
    const secondCall = tx.update.mock.calls[1]?.[0] as unknown as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(secondCall.where.id).toBe('a');
    expect(secondCall.data.position).toEqual(expect.any(String));
    expect(secondCall.data.archivedAt).toBeNull();
  });

  it('creates unknown ids with fresh ranks', async () => {
    const tx = delegate();
    await reconcileRankedOptions(tx, 'field-1', [], [{ label: 'New' }]);
    expect(tx.updateMany).toHaveBeenCalledWith({
      where: { fieldId: 'field-1', id: { notIn: [] }, archivedAt: null },
      data: { archivedAt: expect.any(Date) as Date },
    });
    expect(tx.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fieldId: 'field-1', label: 'New' }) as Record<
        string,
        unknown
      >,
    });
  });

  it('rejects duplicated and foreign ids', async () => {
    const tx = delegate();
    await expect(
      reconcileRankedOptions(
        tx,
        'f',
        [{ id: 'a' }],
        [
          { id: 'a', label: 'x' },
          { id: 'a', label: 'y' },
        ],
      ),
    ).rejects.toThrow(new BadRequestException('Each field option may only appear once'));
    await expect(
      reconcileRankedOptions(tx, 'f', [], [{ id: 'ghost', label: 'x' }]),
    ).rejects.toThrow('A field option does not belong to this field');
    expect(tx.updateMany).not.toHaveBeenCalled();
  });
});
