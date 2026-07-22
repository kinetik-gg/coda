import { describe, expect, it, vi } from 'vitest';
import { beginApiActivity, getApiActivitySnapshot, subscribeApiActivity } from './api-activity';

describe('API activity', () => {
  it('tracks concurrent reads and writes until each request finishes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeApiActivity(listener);
    const finishLoading = beginApiActivity('loading');
    const finishUpdating = beginApiActivity('updating');

    expect(getApiActivitySnapshot()).toEqual({ loading: 1, updating: 1 });
    finishLoading();
    expect(getApiActivitySnapshot()).toEqual({ loading: 0, updating: 1 });
    finishUpdating();
    finishUpdating();
    expect(getApiActivitySnapshot()).toEqual({ loading: 0, updating: 0 });
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });
});
