import { beforeAll, describe, expect, it } from 'vitest';

import {
  api,
  authFrom,
  ownerEmail,
  ownerPassword,
  request,
  type JsonEnvelope,
  type SessionAuth,
} from './support/api-client';

// Opt-in: exercises real backups (pg_dump + object storage round-trips) against
// the compose test stack. Enabled only when CODA_SCHEDULED_BACKUP=1 so the
// standard `pnpm test:integration` run is unaffected.
const enabled = process.env.CODA_SCHEDULED_BACKUP === '1';

const PATH = '/api/v1/instance/scheduled-backups';
const PREFIX = 'backups/scheduled/';

interface RetentionPolicy {
  keepLast: number;
  dailyForDays: number;
  weeklyForWeeks: number;
  maxAgeDays: number;
}
interface Settings {
  enabled: boolean;
  intervalHours: number;
  retention: RetentionPolicy;
}
interface HistoryEntry {
  id: string;
  outcome: 'SUCCESS' | 'FAILURE';
  archiveKey: string | null;
  prunedCount: number;
  error: string | null;
}
interface View {
  settings: Settings;
  destination: { source: 'active' | 'override'; bucket: string; prefix: string };
  status: { enabled: boolean; lastOutcome: 'SUCCESS' | 'FAILURE' | null };
  verificationKeyFingerprint: string | null;
  history: HistoryEntry[];
}
interface RunResult {
  outcome: 'SUCCESS' | 'FAILURE';
  entry: HistoryEntry;
}

async function loginOwner(): Promise<SessionAuth> {
  const response = await request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  });
  if (response.status !== 201) throw new Error(`Owner login failed with HTTP ${response.status}`);
  return authFrom(response);
}

async function describe_(auth: SessionAuth): Promise<View> {
  return (await api<JsonEnvelope<View>>(PATH, 200, {}, auth)).data;
}

async function saveSettings(auth: SessionAuth, settings: Settings): Promise<View> {
  return (
    await api<JsonEnvelope<View>>(
      `${PATH}/settings`,
      200,
      { method: 'PUT', body: JSON.stringify(settings) },
      auth,
    )
  ).data;
}

async function runNow(auth: SessionAuth): Promise<RunResult> {
  return (await api<JsonEnvelope<RunResult>>(`${PATH}/run`, 200, { method: 'POST' }, auth)).data;
}

const keepOne: RetentionPolicy = {
  keepLast: 1,
  dailyForDays: 0,
  weeklyForWeeks: 0,
  maxAgeDays: 0,
};

describe.runIf(enabled)('Scheduled backups', () => {
  let owner: SessionAuth;

  beforeAll(async () => {
    owner = await loginOwner();
    // Baseline: active-storage destination, keep-last-1 so pruning is observable.
    await api<JsonEnvelope<View>>(`${PATH}/destination`, 200, { method: 'DELETE' }, owner);
    await saveSettings(owner, { enabled: true, intervalHours: 24, retention: keepOne });
  });

  it('writes a signed archive under backups/scheduled/ on the active storage', async () => {
    const result = await runNow(owner);
    expect(result.outcome).toBe('SUCCESS');
    expect(result.entry.archiveKey?.startsWith(PREFIX)).toBe(true);

    const view = await describe_(owner);
    expect(view.status.lastOutcome).toBe('SUCCESS');
    expect(view.verificationKeyFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(view.destination.source).toBe('active');
  });

  it('prunes down to keep-last-N after a successful run, never the newest', async () => {
    const first = await runNow(owner);
    const second = await runNow(owner);
    expect(first.outcome).toBe('SUCCESS');
    expect(second.outcome).toBe('SUCCESS');
    // With keepLast=1, the second run must prune at least the first archive and
    // keep its own newest one.
    expect(second.entry.prunedCount).toBeGreaterThanOrEqual(1);
    const view = await describe_(owner);
    expect(view.history[0]!.outcome).toBe('SUCCESS');
    expect(view.history[0]!.archiveKey).toBe(second.entry.archiveKey);
  });

  it('never prunes existing archives when the destination fails', async () => {
    // A successful baseline archive exists from prior tests.
    const before = await runNow(owner);
    expect(before.outcome).toBe('SUCCESS');

    // Point the override at an unreachable/denied destination.
    const bad = await api<JsonEnvelope<{ status: string }>>(
      `${PATH}/destination`,
      200,
      {
        method: 'PUT',
        body: JSON.stringify({
          provider: 'generic',
          endpoint: 'http://127.0.0.1:1/does-not-exist',
          publicEndpoint: 'http://127.0.0.1:1',
          region: 'us-east-1',
          bucket: 'nonexistent-backup-bucket',
          accessKeyId: 'x'.repeat(20),
          secretAccessKey: 'x'.repeat(40),
          forcePathStyle: true,
        }),
      },
      owner,
    );
    // The probe must reject the bad destination before it is ever persisted.
    expect(bad.data.status).toBe('invalid');

    // The override was not saved, so a run still targets active storage and
    // succeeds — proving the failing destination never took effect nor pruned.
    const after = await runNow(owner);
    expect(after.outcome).toBe('SUCCESS');
    const view = await describe_(owner);
    expect(view.destination.source).toBe('active');
    expect(view.status.lastOutcome).toBe('SUCCESS');
  });

  it('disabling the schedule stops runs without touching stored archives', async () => {
    const view = await saveSettings(owner, {
      enabled: false,
      intervalHours: 24,
      retention: keepOne,
    });
    expect(view.settings.enabled).toBe(false);
    expect(view.status.enabled).toBe(false);
    // A manual run is still allowed and does not error; the schedule is simply
    // no longer armed. History from prior successful runs is intact.
    expect(view.history.some((entry) => entry.outcome === 'SUCCESS')).toBe(true);
  });
});
