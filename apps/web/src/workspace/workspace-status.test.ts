import { describe, expect, it } from 'vitest';
import { resolveBreakdownSaveState } from './workspace-status';

describe('resolveBreakdownSaveState', () => {
  it('prioritizes layout persistence over read activity', () => {
    expect(resolveBreakdownSaveState({ persistState: 'saving', loading: 2, updating: 1 })).toBe(
      'saving',
    );
    expect(resolveBreakdownSaveState({ persistState: 'dirty', loading: 2, updating: 1 })).toBe(
      'unsaved',
    );
    expect(resolveBreakdownSaveState({ persistState: 'saved', loading: 2, updating: 1 })).toBe(
      'updating',
    );
  });

  it('falls back through read activity to a settled saved state', () => {
    expect(resolveBreakdownSaveState({ persistState: 'saved', loading: 1, updating: 0 })).toBe(
      'loading',
    );
    expect(resolveBreakdownSaveState({ persistState: 'saved', loading: 0, updating: 0 })).toBe(
      'saved',
    );
  });

  it('maps a failed write to the canonical failed state', () => {
    expect(resolveBreakdownSaveState({ persistState: 'error', loading: 0, updating: 0 })).toBe(
      'failed',
    );
  });
});
