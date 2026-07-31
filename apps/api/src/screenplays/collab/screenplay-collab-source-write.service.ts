import { Injectable } from '@nestjs/common';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ScreenplayCollabLogService } from './screenplay-collab-log.service';
import { ScreenplayCollabProjectionService } from './screenplay-collab-projection.service';

/**
 * The one way a writer outside the collaboration transport may set a screenplay's text.
 *
 * A screenplay's Fountain source has two representations — the durable Yjs log the editor renders,
 * and `Screenplay.sourceText`, the plain projection statistics, outline, checkpoints and exports
 * read — and exactly one of them is authoritative at any moment. While no log exists,
 * `Screenplay.sourceText` is the only copy and `ScreenplaysService` writes the row directly. The
 * moment a log exists (the first join bootstraps one) the CRDT becomes the authority, and a plain
 * row write would leave the editor rendering one text while every other surface reported another —
 * issue #343, the same two-sources-of-truth shape as #336.
 *
 * So this service never writes `Screenplay.sourceText` itself. It writes the text into the log and
 * then asks {@link ScreenplayCollabProjectionService} — the sole owner of that column on the
 * collaborative path (#264), and the only place the per-owner source-byte quota is enforced inside
 * a serializable transaction — to re-derive the column from the log it just appended to. The
 * projected value is therefore a function of the CRDT by construction, not a copy that has to be
 * kept in step.
 */
@Injectable()
export class ScreenplayCollabSourceWriteService {
  constructor(
    private readonly log: ScreenplayCollabLogService,
    private readonly projection: ScreenplayCollabProjectionService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Whether the collaborative document is the authority for this screenplay's text. */
  hasDocument(screenplayId: string): Promise<boolean> {
    return this.log.hasDocument(screenplayId);
  }

  /**
   * Makes `sourceText` the collaborative document's text, relays the resulting update to everyone
   * currently in the room, and projects the log back onto `Screenplay.sourceText`. Returns the
   * canonical version the projection resolved, or `undefined` when the screenplay was trashed
   * underneath the write (the projection refuses to revive it — see `project`'s `deletedAt` guard).
   *
   * Idempotent: applying the text the document already holds appends nothing and simply re-projects.
   */
  async applySourceText(
    screenplayId: string,
    authorUserId: string,
    sourceText: string,
  ): Promise<number | undefined> {
    const update = await this.log.rewriteSourceText(screenplayId, authorUserId, sourceText);
    if (update) this.realtime.broadcastScreenplayUpdate(screenplayId, update);
    // The debounced projection this write would otherwise race is dropped: the caller is waiting on
    // a canonical version, so project now, exactly as the gateway's forced flush does.
    this.projection.cancel(screenplayId);
    const version = await this.projection.project(screenplayId);
    if (version !== undefined) this.realtime.broadcastProjection({ screenplayId, version });
    return version;
  }
}
