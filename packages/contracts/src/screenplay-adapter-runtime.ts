import { z } from 'zod';
import {
  SCREENPLAY_CONVERSION_MAX_ELEMENTS,
  SCREENPLAY_CONVERSION_MAX_SOURCE_CHARACTERS,
  SCREENPLAY_CONVERSION_MAX_WARNINGS,
  screenplayConversionElementSchema,
  screenplayConversionWarningSchema,
  screenplaySourceFormatSchema,
} from './screenplay-conversion';
import type {
  ScreenplayConversionElement,
  ScreenplayConversionWarning,
  ScreenplaySourceFormat,
} from './screenplay-conversion';

/**
 * Wire version of the host <-> adapter-worker protocol. The host refuses a reply
 * that does not echo the version it sent, so a worker left over from a rolling
 * deploy can never be mistaken for a current one.
 */
export const SCREENPLAY_ADAPTER_PROTOCOL_VERSION = 1;

/**
 * Extra wall-clock the host waits after the worker's own soft deadline before it
 * hard-terminates the thread. The soft deadline lets a cooperative adapter emit
 * an attributable `timeout` failure; the hard terminate is what actually
 * guarantees the slot is released, because an adapter spinning in synchronous
 * code never returns to its event loop to notice the soft deadline at all.
 */
export const SCREENPLAY_ADAPTER_TERMINATION_GRACE_MS = 2_000;

/** Hard floor on the young-generation and stack allowances given to an adapter thread. */
export const SCREENPLAY_ADAPTER_YOUNG_GENERATION_MB = 32;
export const SCREENPLAY_ADAPTER_STACK_MB = 4;

/**
 * Why a conversion did not produce a report. Every terminal non-success outcome
 * of the runtime is exactly one of these, so callers never have to interpret a
 * free-text message to decide whether to retry, re-upload, or give up.
 *
 * - `unsupported-format` — no adapter is registered for the source format.
 * - `input-too-large` — the original exceeds the runtime's input ceiling.
 * - `output-too-large` — converted Fountain exceeded the output-character ceiling.
 * - `element-limit` — the report exceeded the element or warning ceiling.
 * - `invalid-source` — the adapter rejected the document (malformed, hostile, empty).
 * - `timeout` — the deadline elapsed; the thread was terminated.
 * - `memory` — the thread hit its heap ceiling and was destroyed by V8.
 * - `cancelled` — the caller aborted; the thread was terminated.
 * - `capacity` — no admission slot was free.
 * - `protocol-error` — the worker replied with something the host cannot trust.
 * - `internal` — the runtime itself failed (spawn error, unreadable original).
 */
export const screenplayAdapterFailureReasonSchema = z.enum([
  'unsupported-format',
  'input-too-large',
  'output-too-large',
  'element-limit',
  'invalid-source',
  'timeout',
  'memory',
  'cancelled',
  'capacity',
  'protocol-error',
  'internal',
]);

/**
 * The ceilings a single conversion runs under. They are resolved once per run by
 * the host from operator configuration and handed to the worker, so the adapter
 * and the runtime always agree on the same numbers and an adapter never has to
 * read configuration itself.
 */
export const screenplayAdapterLimitsSchema = z.object({
  /** Soft deadline inside the worker. The host terminates at this plus the grace. */
  timeoutMs: z.number().int().min(1_000).max(600_000),
  /** Largest original the runtime will read into the worker. */
  maxInputBytes: z.number().int().min(1).max(262_144_000),
  /** Largest converted Fountain snapshot, in UTF-16 code units. */
  maxOutputCharacters: z.number().int().min(1).max(SCREENPLAY_CONVERSION_MAX_SOURCE_CHARACTERS),
  /** Largest number of per-element report entries. */
  maxElements: z.number().int().min(1).max(SCREENPLAY_CONVERSION_MAX_ELEMENTS),
  /** Largest number of document-level warnings. */
  maxWarnings: z.number().int().min(1).max(SCREENPLAY_CONVERSION_MAX_WARNINGS),
});

/**
 * Coarse progress. `completed`/`total` are adapter-defined units (pages, parts,
 * paragraphs) described by `stage`; the runtime never interprets them and a
 * silent adapter is entirely legal.
 */
export const screenplayAdapterProgressSchema = z.object({
  stage: z.string().trim().min(1).max(80),
  completed: z.number().int().min(0),
  total: z.number().int().min(0),
});

/** Handed to the worker through `workerData`. One request per thread, no message loop. */
export const screenplayAdapterWorkerRequestSchema = z.object({
  protocolVersion: z.literal(SCREENPLAY_ADAPTER_PROTOCOL_VERSION),
  requestId: z.string().trim().min(1).max(64),
  sourceFormat: screenplaySourceFormatSchema,
  originalFilename: z.string().trim().min(1).max(255),
  limits: screenplayAdapterLimitsSchema,
});

const workerEnvelope = {
  protocolVersion: z.literal(SCREENPLAY_ADAPTER_PROTOCOL_VERSION),
  requestId: z.string().trim().min(1).max(64),
};

/**
 * Worker -> host. Zero or more `progress` messages followed by exactly one
 * `result` or `failure`. A worker that exits without a terminal message is a
 * `protocol-error` once the host observes the exit.
 */
export const screenplayAdapterWorkerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...workerEnvelope,
    type: z.literal('progress'),
    progress: screenplayAdapterProgressSchema,
  }),
  z.object({
    ...workerEnvelope,
    type: z.literal('result'),
    adapter: z.object({
      id: z.string().trim().min(1).max(120),
      version: z.string().trim().min(1).max(64),
    }),
    convertedFountain: z.string().max(SCREENPLAY_CONVERSION_MAX_SOURCE_CHARACTERS),
    elements: z.array(screenplayConversionElementSchema).max(SCREENPLAY_CONVERSION_MAX_ELEMENTS),
    warnings: z.array(screenplayConversionWarningSchema).max(SCREENPLAY_CONVERSION_MAX_WARNINGS),
  }),
  z.object({
    ...workerEnvelope,
    type: z.literal('failure'),
    reason: screenplayAdapterFailureReasonSchema,
    message: z.string().trim().min(1).max(1_000),
  }),
]);

/** Body of the server-side conversion call: optimistic concurrency only. */
export const convertScreenplayImportArtifactSchema = z.object({
  version: z.number().int().min(1),
});

export type ScreenplayAdapterFailureReason = z.infer<typeof screenplayAdapterFailureReasonSchema>;
export type ScreenplayAdapterLimits = z.infer<typeof screenplayAdapterLimitsSchema>;
export type ScreenplayAdapterProgress = z.infer<typeof screenplayAdapterProgressSchema>;
export type ScreenplayAdapterWorkerRequest = z.infer<typeof screenplayAdapterWorkerRequestSchema>;
export type ScreenplayAdapterWorkerMessage = z.infer<typeof screenplayAdapterWorkerMessageSchema>;
export type ConvertScreenplayImportArtifact = z.infer<typeof convertScreenplayImportArtifactSchema>;

/** The original document, exactly as uploaded. Adapters must not assume any encoding. */
export interface ScreenplayAdapterInput {
  readonly sourceFormat: ScreenplaySourceFormat;
  readonly originalFilename: string;
  readonly bytes: Uint8Array;
}

/**
 * Everything the runtime gives an adapter besides the bytes. An adapter must not
 * reach for configuration, the database, the network, or the filesystem: the
 * thread it runs in is expected to be terminable at any instant.
 */
export interface ScreenplayAdapterContext {
  /**
   * Aborted when the soft deadline elapses. Adapters doing chunked work must
   * either await something or call {@link throwIfCancelled} between chunks; a
   * purely synchronous loop will be killed by the host instead, which costs the
   * caller an unattributable `timeout` rather than a clean one.
   */
  readonly signal: AbortSignal;
  readonly limits: ScreenplayAdapterLimits;
  /** Best-effort progress. Dropped silently once the run is no longer current. */
  reportProgress(progress: ScreenplayAdapterProgress): void;
  /** Throws {@link ScreenplayAdapterAbortError} when {@link signal} has aborted. */
  throwIfCancelled(): void;
}

/**
 * What an adapter returns. Deliberately *not* a full conversion report: the
 * runtime owns `schemaVersion`, `sourceFormat`, `adapter`, `generatedAt`, and the
 * `summary` counts, so an adapter structurally cannot emit a report whose summary
 * disagrees with its elements.
 */
export interface ScreenplayAdapterOutput {
  convertedFountain: string;
  elements: ScreenplayConversionElement[];
  warnings: ScreenplayConversionWarning[];
}

/**
 * The whole surface a format adapter implements. Registered lazily by source
 * format so no parser is loaded until a document of that format arrives.
 */
export interface ScreenplayAdapter {
  /** Stable identity recorded in every report this adapter produces. */
  readonly id: string;
  readonly version: string;
  readonly sourceFormats: readonly ScreenplaySourceFormat[];
  convert(
    input: ScreenplayAdapterInput,
    context: ScreenplayAdapterContext,
  ): Promise<ScreenplayAdapterOutput>;
}

/**
 * Thrown inside the worker when the soft deadline elapsed. Adapters should let it
 * propagate rather than catching it, so the failure stays attributable.
 */
export class ScreenplayAdapterAbortError extends Error {
  constructor(message = 'Screenplay conversion was cancelled') {
    super(message);
    this.name = 'ScreenplayAdapterAbortError';
  }
}

/**
 * Thrown by an adapter that has decided the document cannot be converted. Any
 * other thrown value is reported as `invalid-source` too, but carries a generic
 * message so an adapter bug cannot leak internals to an API client.
 */
export class ScreenplayAdapterSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScreenplayAdapterSourceError';
  }
}
