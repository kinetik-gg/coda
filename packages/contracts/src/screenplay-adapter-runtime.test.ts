import { describe, expect, it } from 'vitest';
import {
  SCREENPLAY_ADAPTER_PROTOCOL_VERSION,
  SCREENPLAY_ADAPTER_TERMINATION_GRACE_MS,
  convertScreenplayImportArtifactSchema,
  screenplayAdapterFailureReasonSchema,
  screenplayAdapterLimitsSchema,
  screenplayAdapterWorkerMessageSchema,
  screenplayAdapterWorkerRequestSchema,
} from './screenplay-adapter-runtime';

const limits = {
  timeoutMs: 30_000,
  maxInputBytes: 1_048_576,
  maxOutputCharacters: 500_000,
  maxElements: 5_000,
  maxWarnings: 100,
};

function envelope() {
  return { protocolVersion: SCREENPLAY_ADAPTER_PROTOCOL_VERSION, requestId: 'request-1' };
}

describe('screenplay adapter runtime contract', () => {
  it('keeps a positive termination grace so the soft deadline can win first', () => {
    expect(SCREENPLAY_ADAPTER_TERMINATION_GRACE_MS).toBeGreaterThan(0);
  });

  it('bounds every limit on both sides', () => {
    expect(screenplayAdapterLimitsSchema.parse(limits)).toEqual(limits);
    expect(() => screenplayAdapterLimitsSchema.parse({ ...limits, timeoutMs: 999 })).toThrow();
    expect(() => screenplayAdapterLimitsSchema.parse({ ...limits, timeoutMs: 600_001 })).toThrow();
    expect(() => screenplayAdapterLimitsSchema.parse({ ...limits, maxElements: 0 })).toThrow();
    expect(() =>
      screenplayAdapterLimitsSchema.parse({ ...limits, maxOutputCharacters: 5_000_001 }),
    ).toThrow();
  });

  it('refuses a worker request that does not carry the current protocol version', () => {
    const request = {
      ...envelope(),
      sourceFormat: 'docx',
      originalFilename: 'pilot.docx',
      limits,
    };
    expect(screenplayAdapterWorkerRequestSchema.parse(request).sourceFormat).toBe('docx');
    expect(() =>
      screenplayAdapterWorkerRequestSchema.parse({ ...request, protocolVersion: 2 }),
    ).toThrow();
  });

  it('accepts progress, result, and failure messages and nothing else', () => {
    expect(
      screenplayAdapterWorkerMessageSchema.parse({
        ...envelope(),
        type: 'progress',
        progress: { stage: 'pages', completed: 2, total: 10 },
      }).type,
    ).toBe('progress');
    expect(
      screenplayAdapterWorkerMessageSchema.parse({
        ...envelope(),
        type: 'result',
        adapter: { id: 'coda.test', version: '1' },
        convertedFountain: '!Line\n',
        elements: [],
        warnings: [],
      }).type,
    ).toBe('result');
    expect(
      screenplayAdapterWorkerMessageSchema.parse({
        ...envelope(),
        type: 'failure',
        reason: 'timeout',
        message: 'too slow',
      }).type,
    ).toBe('failure');
    expect(() =>
      screenplayAdapterWorkerMessageSchema.parse({ ...envelope(), type: 'chunk' }),
    ).toThrow();
  });

  it('rejects a failure reason outside the taxonomy', () => {
    expect(screenplayAdapterFailureReasonSchema.parse('memory')).toBe('memory');
    expect(() => screenplayAdapterFailureReasonSchema.parse('oom')).toThrow();
  });

  it('requires an artifact version on a conversion request', () => {
    expect(convertScreenplayImportArtifactSchema.parse({ version: 2 })).toEqual({ version: 2 });
    expect(() => convertScreenplayImportArtifactSchema.parse({})).toThrow();
    expect(() => convertScreenplayImportArtifactSchema.parse({ version: 0 })).toThrow();
  });
});
