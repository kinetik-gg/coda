import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SnapshotExportAdmission } from './snapshot-export-admission';

describe('SnapshotExportAdmission', () => {
  it('allows one export per user and keeps a bounded global allocation', () => {
    const admission = new SnapshotExportAdmission();
    const releaseFirst = admission.acquire('user-1');
    const releaseSecond = admission.acquire('user-2');

    for (const userId of ['user-1', 'user-3']) {
      try {
        admission.acquire(userId);
        throw new Error('Expected admission to reject the export');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    releaseFirst();
    releaseFirst();
    const releaseThird = admission.acquire('user-3');
    releaseSecond();
    releaseThird();
  });
});
