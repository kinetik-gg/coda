import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env';
import { HEARTBEAT_JOB_KEY, heartbeatJob } from './built-in-jobs';

function envWith(enabled: boolean): Env {
  return {
    SCHEDULER_HEARTBEAT_ENABLED: enabled,
    SCHEDULER_HEARTBEAT_INTERVAL_MS: 3_600_000,
  } as Env;
}

describe('heartbeatJob', () => {
  it('is absent when the heartbeat is disabled', () => {
    expect(heartbeatJob(envWith(false))).toBeNull();
  });

  it('is a startup job whose handler resolves when enabled', async () => {
    const job = heartbeatJob(envWith(true));
    expect(job).toMatchObject({
      key: HEARTBEAT_JOB_KEY,
      runOnStartup: true,
      intervalMs: 3_600_000,
    });
    await expect(job?.handler()).resolves.toBeUndefined();
  });
});
