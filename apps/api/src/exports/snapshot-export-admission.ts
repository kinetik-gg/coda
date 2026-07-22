import { HttpException, HttpStatus } from '@nestjs/common';

const MAX_CONCURRENT_SNAPSHOT_EXPORTS = 2;

/**
 * Keeps long-lived snapshot transactions from consuming the database pool.
 * Nest creates one ExportsService per process, so this admission controller is
 * deliberately process-local and leaves most pool capacity for normal work.
 */
export class SnapshotExportAdmission {
  private active = 0;
  private readonly activeUsers = new Set<string>();

  acquire(userId: string): () => void {
    if (this.activeUsers.has(userId)) {
      throw new HttpException(
        'Another project snapshot export is already running',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (this.active >= MAX_CONCURRENT_SNAPSHOT_EXPORTS) {
      throw new HttpException(
        'Project snapshot export capacity is full; retry later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.active += 1;
    this.activeUsers.add(userId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.activeUsers.delete(userId);
    };
  }
}
