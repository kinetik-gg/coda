import { describe, expect, it } from 'vitest';
import { resolveWorkspaceStatus } from './workspace-status';

describe('resolveWorkspaceStatus', () => {
  it('prioritizes layout persistence and writes over reads', () => {
    expect(
      resolveWorkspaceStatus({
        saveState: 'saving',
        savedNoticeVisible: false,
        loading: 2,
        updating: 1,
      }),
    ).toBe('saving');
    expect(
      resolveWorkspaceStatus({
        saveState: 'saved',
        savedNoticeVisible: false,
        loading: 2,
        updating: 1,
      }),
    ).toBe('updating');
  });

  it('settles from saved to idle when there is no activity', () => {
    expect(
      resolveWorkspaceStatus({
        saveState: 'saved',
        savedNoticeVisible: true,
        loading: 0,
        updating: 0,
      }),
    ).toBe('saved');
    expect(
      resolveWorkspaceStatus({
        saveState: 'saved',
        savedNoticeVisible: false,
        loading: 0,
        updating: 0,
      }),
    ).toBe('idle');
  });
});
