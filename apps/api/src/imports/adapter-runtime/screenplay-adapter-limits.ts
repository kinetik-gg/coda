import {
  SCREENPLAY_CONVERSION_REPORT_SCHEMA_VERSION,
  screenplayConversionReportSchema,
} from '@coda/contracts';
import type {
  ScreenplayAdapterLimits,
  ScreenplayAdapterOutput,
  ScreenplayConversionReport,
  ScreenplaySourceFormat,
} from '@coda/contracts';
import { env } from '../../config/env';

type ScreenplayConversionSummary = ScreenplayConversionReport['summary'];

/**
 * Reads the operator-configured ceilings once per conversion. Resolving eagerly
 * and passing the result around means the worker never touches `env()` — it has
 * no configuration of its own and cannot disagree with the host about a bound.
 */
export function resolveScreenplayAdapterLimits(): ScreenplayAdapterLimits {
  const config = env();
  return {
    timeoutMs: config.SCREENPLAY_ADAPTER_TIMEOUT_MS,
    maxInputBytes: config.SCREENPLAY_ADAPTER_MAX_INPUT_BYTES,
    maxOutputCharacters: config.SCREENPLAY_ADAPTER_MAX_OUTPUT_CHARACTERS,
    maxElements: config.SCREENPLAY_ADAPTER_MAX_ELEMENTS,
    maxWarnings: config.SCREENPLAY_ADAPTER_MAX_WARNINGS,
  };
}

function summarize(elements: ScreenplayAdapterOutput['elements']): ScreenplayConversionSummary {
  const summary: ScreenplayConversionSummary = {
    total: elements.length,
    preserved: 0,
    converted: 0,
    uncertain: 0,
    unsupported: 0,
  };
  for (const element of elements) summary[element.status] += 1;
  return summary;
}

/**
 * Assembles the durable conversion report from what an adapter produced. The
 * summary is derived here rather than accepted from the adapter, so the
 * summary/elements invariant the artifact contract enforces on completion cannot
 * be broken by an adapter that miscounts.
 */
export function buildScreenplayConversionReport(input: {
  sourceFormat: ScreenplaySourceFormat;
  adapter: { id: string; version: string };
  output: ScreenplayAdapterOutput;
  generatedAt: Date;
}): ScreenplayConversionReport {
  return screenplayConversionReportSchema.parse({
    schemaVersion: SCREENPLAY_CONVERSION_REPORT_SCHEMA_VERSION,
    sourceFormat: input.sourceFormat,
    adapter: input.adapter,
    generatedAt: input.generatedAt.toISOString(),
    summary: summarize(input.output.elements),
    warnings: input.output.warnings,
    elements: input.output.elements,
  });
}
