import { describe, expect, it } from 'vitest';
import { ProjectImportAdmission } from './project-import-admission';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('ProjectImportAdmission', () => {
  it('holds capacity until import work settles, independent of the response lifecycle', async () => {
    const admission = new ProjectImportAdmission();
    const first = deferred<string>();
    const second = deferred<string>();
    const firstRun = admission.run(() => first.promise);
    const secondRun = admission.run(() => second.promise);

    await expect(admission.run(() => Promise.resolve('third'))).rejects.toMatchObject({
      status: 503,
    });
    first.resolve('first');
    await expect(firstRun).resolves.toBe('first');
    await expect(admission.run(() => Promise.resolve('third'))).resolves.toBe('third');
    second.resolve('second');
    await expect(secondRun).resolves.toBe('second');
  });

  it('releases capacity after a failed import', async () => {
    const admission = new ProjectImportAdmission();

    await expect(admission.run(() => Promise.reject(new Error('invalid import')))).rejects.toThrow(
      'invalid import',
    );
    await expect(admission.run(() => Promise.resolve('recovered'))).resolves.toBe('recovered');
  });
});
