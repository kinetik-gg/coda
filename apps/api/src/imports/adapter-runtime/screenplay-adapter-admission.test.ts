import { describe, expect, it, vi } from 'vitest';
import { ScreenplayAdapterAdmission } from './screenplay-adapter-admission';

const config = vi.hoisted(() => ({ SCREENPLAY_ADAPTER_MAX_CONCURRENT: 2 }));

vi.mock('../../config/env', () => ({ env: () => config }));

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('ScreenplayAdapterAdmission', () => {
  it('admits up to the configured ceiling and refuses beyond it', async () => {
    const admission = new ScreenplayAdapterAdmission();
    const first = deferred();
    const second = deferred();
    const running = [admission.run(() => first.promise), admission.run(() => second.promise)];
    expect(admission.inFlight).toBe(2);
    await expect(admission.run(() => Promise.resolve('third'))).resolves.toEqual({
      admitted: false,
    });
    first.release();
    second.release();
    await Promise.all(running);
    expect(admission.inFlight).toBe(0);
  });

  it('releases the slot when the operation rejects, so a kill cannot strand capacity', async () => {
    const admission = new ScreenplayAdapterAdmission();
    await expect(admission.run(() => Promise.reject(new Error('terminated')))).rejects.toThrow(
      'terminated',
    );
    expect(admission.inFlight).toBe(0);
    await expect(admission.run(() => Promise.resolve('ok'))).resolves.toEqual({
      admitted: true,
      value: 'ok',
    });
  });

  it('distinguishes a refused admission from an operation that yielded nothing', async () => {
    const admission = new ScreenplayAdapterAdmission();
    await expect(admission.run(() => Promise.resolve(undefined))).resolves.toEqual({
      admitted: true,
      value: undefined,
    });
  });
});
