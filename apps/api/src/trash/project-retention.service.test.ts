import { describe, expect, it, vi } from 'vitest';
import { ProjectRetentionService } from './project-retention.service';

function service(sweeps: {
  projects?: ReturnType<typeof vi.fn>;
  screenplays?: ReturnType<typeof vi.fn>;
  trackers?: ReturnType<typeof vi.fn>;
}) {
  const trash = { purgeExpiredProjects: sweeps.projects ?? vi.fn().mockResolvedValue(0) };
  const screenplayTrash = {
    purgeExpiredScreenplays: sweeps.screenplays ?? vi.fn().mockResolvedValue(0),
  };
  const trackerTrash = { purgeExpiredTrackers: sweeps.trackers ?? vi.fn().mockResolvedValue(0) };
  const retention = new ProjectRetentionService(
    trash as never,
    screenplayTrash as never,
    trackerTrash as never,
  );
  return { retention, trash, screenplayTrash, trackerTrash };
}

// `cleanup` is the private scheduler body; the interval arm only re-runs it.
async function cleanup(retention: ProjectRetentionService): Promise<void> {
  await (retention as unknown as { cleanup: () => Promise<void> }).cleanup();
}

describe('ProjectRetentionService', () => {
  it('sweeps expired projects, then screenplays, then trackers, and reports each count', async () => {
    const projects = vi.fn().mockResolvedValue(2);
    const screenplays = vi.fn().mockResolvedValue(3);
    const trackers = vi.fn().mockResolvedValue(5);
    const { retention } = service({ projects, screenplays, trackers });

    await cleanup(retention);

    expect(projects).toHaveBeenCalledTimes(1);
    expect(screenplays).toHaveBeenCalledTimes(1);
    expect(trackers).toHaveBeenCalledTimes(1);
    const order = [
      projects.mock.invocationCallOrder[0]!,
      screenplays.mock.invocationCallOrder[0]!,
      trackers.mock.invocationCallOrder[0]!,
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(retention.status()).toMatchObject({
      id: 'project-retention',
      state: 'idle',
      lastPurgedProjects: 2,
      lastPurgedScreenplays: 3,
      lastPurgedTrackers: 5,
      lastFailureAt: null,
      nextRunAt: expect.any(Date) as Date,
    });
  });

  it('marks the run failed but still completes when one sweep throws', async () => {
    const trackers = vi.fn().mockRejectedValue(new Error('purge exploded'));
    const { retention } = service({ trackers });

    await cleanup(retention);

    const status = retention.status();
    expect(status.state).toBe('degraded');
    expect(status.lastPurgedTrackers).toBe(0);
    expect(status.lastCompletedAt).not.toBeNull();
    expect(status.lastFailureMessage).toBe(
      'The cleanup job failed; inspect server logs for details.',
    );
  });
});
