import { HttpException, HttpStatus } from '@nestjs/common';

const MAX_CONCURRENT_SNAPSHOT_EXPORTS = 2;

/**
 * Keeps long-lived export streams from consuming the database pool. Nest creates one service
 * instance per process, so this admission controller is deliberately process-local and leaves
 * most pool capacity for normal work.
 */
export class SnapshotExportAdmission {
  /**
   * The noun phrase used in rejection messages; the defaults keep the historical project-snapshot
   * wording while other streaming exports (tracker record CSV) name their own surface.
   */
  constructor(
    private readonly takenLabel = 'project snapshot',
    private readonly fullLabel = 'Project snapshot',
  ) {}

  private active = 0;
  private readonly activeUsers = new Set<string>();

  acquire(userId: string): () => void {
    if (this.activeUsers.has(userId)) {
      throw new HttpException(
        `Another ${this.takenLabel} export is already running`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (this.active >= MAX_CONCURRENT_SNAPSHOT_EXPORTS) {
      throw new HttpException(
        `${this.fullLabel} export capacity is full; retry later`,
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
