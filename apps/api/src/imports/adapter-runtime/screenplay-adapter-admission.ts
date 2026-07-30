import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';

export type ScreenplayAdapterAdmissionResult<T> =
  { admitted: false } | { admitted: true; value: T };

/**
 * Admission control for adapter threads.
 *
 * Rejecting rather than queueing is deliberate. A conversion holds a whole OS
 * thread with its own heap for up to the configured deadline, so an unbounded
 * queue would let a burst of imports reserve far more memory than the instance
 * has, and would make the caller's wait unbounded even though every individual
 * run is bounded. The ceiling is therefore also the instance's worst-case adapter
 * memory: `SCREENPLAY_ADAPTER_MAX_CONCURRENT` x
 * `SCREENPLAY_ADAPTER_MAX_OLD_GENERATION_MB`.
 *
 * Slots are process-local. That is sufficient because a conversion is bounded by
 * a single request and never survives a restart: there is no durable job to claim
 * and so no cross-replica queue to coordinate. A replicated deployment bounds
 * each replica independently.
 */
@Injectable()
export class ScreenplayAdapterAdmission {
  private active = 0;

  /** Slots currently held. Exposed for the metrics/diagnostics surface and tests. */
  get inFlight(): number {
    return this.active;
  }

  /**
   * Runs `operation` in a slot, or reports saturation immediately. The slot is
   * released on every path, including a rejection, so a terminated thread can
   * never strand capacity. The result is a discriminated union rather than an
   * optional so that a conversion which legitimately yields nothing is not
   * mistaken for a refused admission.
   */
  async run<T>(operation: () => Promise<T>): Promise<ScreenplayAdapterAdmissionResult<T>> {
    if (this.active >= env().SCREENPLAY_ADAPTER_MAX_CONCURRENT) return { admitted: false };
    this.active += 1;
    try {
      return { admitted: true, value: await operation() };
    } finally {
      this.active -= 1;
    }
  }
}
