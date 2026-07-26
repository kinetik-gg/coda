import { describe, expect, it, vi } from 'vitest';
import type { JobDefinition } from '../../scheduler/job-definition';

vi.mock('../../config/env', () => ({ env: () => ({ COLLAB_COMPACTION_TICK_MS: 60_000 }) }));

import { ScreenplayCollabJob, SCREENPLAY_COLLAB_COMPACTION_JOB_KEY } from './screenplay-collab.job';

describe('ScreenplayCollabJob', () => {
  it('registers a singleton compaction job that delegates ticks to the compaction service', () => {
    const registry = { register: vi.fn() };
    const compaction = { tick: vi.fn().mockResolvedValue([]) };
    const job = new ScreenplayCollabJob(registry as never, compaction as never);

    job.onModuleInit();

    expect(registry.register).toHaveBeenCalledTimes(1);
    const definition = registry.register.mock.calls[0]![0] as JobDefinition;
    expect(definition.key).toBe(SCREENPLAY_COLLAB_COMPACTION_JOB_KEY);
    expect(definition.intervalMs).toBe(60_000);
    expect(definition.enabled).toBe(true);
    expect(definition.runOnStartup).toBe(false);

    void definition.handler();
    expect(compaction.tick).toHaveBeenCalledOnce();
  });
});
