import {
  ScreenplayAdapterSourceError,
  type ScreenplayAdapter,
  type ScreenplayAdapterContext,
  type ScreenplayAdapterInput,
  type ScreenplayAdapterOutput,
  type ScreenplayConversionElement,
} from '@coda/contracts';

/**
 * The synthetic source format this adapter answers for. It is not a real file
 * format and is only registered when `SCREENPLAY_ADAPTER_TEST_FORMAT` is on.
 */
export const RUNTIME_TEST_SOURCE_FORMAT = 'coda-runtime-test';

/**
 * A directive-driven adapter whose only purpose is to let the runtime's bounds be
 * exercised for real, including the paths no honest adapter would ever take. It
 * exists because the runtime must be able to land, and be proven, before the
 * first format adapter is written; #246 replaces it as the reference
 * implementation, but it stays as the runtime's own regression fixture.
 *
 * The first line of the document may be a directive:
 *
 * - `#!spin` — a synchronous infinite loop. Never reaches its own deadline check,
 *   so only the host's hard terminate can stop it.
 * - `#!balloon` — allocates until the thread's heap ceiling destroys it.
 * - `#!sleep:<ms>` — awaits, and so observes cancellation cooperatively.
 * - `#!flood:<count>` — emits `count` characters of Fountain, to cross the output
 *   ceiling.
 * - `#!swarm:<count>` — emits `count` report elements, to cross the element ceiling.
 * - `#!reject` — throws {@link ScreenplayAdapterSourceError}.
 *
 * Anything else is converted line by line into forced Action, which is the
 * smallest conversion that still produces a complete per-element report.
 */
class RuntimeTestAdapter implements ScreenplayAdapter {
  readonly id = 'coda.runtime-test';
  readonly version = '1';
  readonly sourceFormats = [RUNTIME_TEST_SOURCE_FORMAT] as const;

  async convert(
    input: ScreenplayAdapterInput,
    context: ScreenplayAdapterContext,
  ): Promise<ScreenplayAdapterOutput> {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
    const [first, ...rest] = source.split(/\r\n|\n|\r/u);
    const directive = first?.startsWith('#!') ? first.slice(2) : undefined;
    if (directive === undefined) return this.echo(source.split(/\r\n|\n|\r/u), context);
    return this.runDirective(directive, rest, context);
  }

  private async runDirective(
    directive: string,
    rest: readonly string[],
    context: ScreenplayAdapterContext,
  ): Promise<ScreenplayAdapterOutput> {
    const [name, rawArgument] = directive.split(':');
    const argument = Number.parseInt(rawArgument ?? '', 10);
    switch (name) {
      case 'spin':
        return spinForever();
      case 'balloon':
        return balloon();
      case 'sleep':
        await sleep(Number.isSafeInteger(argument) ? argument : 1_000, context);
        return this.echo(rest, context);
      case 'flood':
        return flood(Number.isSafeInteger(argument) ? argument : 1);
      case 'swarm':
        return swarm(Number.isSafeInteger(argument) ? argument : 1);
      case 'reject':
        throw new ScreenplayAdapterSourceError('Runtime test document was rejected');
      case undefined:
      default:
        throw new ScreenplayAdapterSourceError(`Unknown runtime test directive: ${name ?? ''}`);
    }
  }

  private echo(lines: readonly string[], context: ScreenplayAdapterContext) {
    const kept = lines.filter((line) => line.trim().length > 0);
    if (kept.length === 0) throw new ScreenplayAdapterSourceError('Document has no content');
    const elements: ScreenplayConversionElement[] = [];
    let cursor = 0;
    for (const [index, line] of kept.entries()) {
      context.throwIfCancelled();
      if (index % 500 === 0) {
        context.reportProgress({ stage: 'lines', completed: index, total: kept.length });
      }
      const text = `!${line}`;
      elements.push({
        id: `line-${index + 1}`,
        status: 'converted',
        source: { kind: 'line', location: { unit: 'line', start: index, end: index + 1 } },
        target: {
          kind: 'action',
          location: { unit: 'character', start: cursor, end: cursor + text.length },
        },
        summary: `Line ${index + 1} converted to forced action`,
        warnings: [],
      });
      cursor += text.length + 2;
    }
    return {
      convertedFountain: kept.map((line) => `!${line}`).join('\n\n'),
      elements,
      warnings: [],
    };
  }
}

function spinForever(): never {
  // Deliberately unbounded and deliberately synchronous: this is the fixture that
  // proves the host's hard terminate, not the worker's cooperative deadline.
  for (;;) {
    /* empty */
  }
}

function balloon(): never {
  const held: Uint8Array[] = [];
  for (;;) {
    held.push(new Uint8Array(8 * 1_024 * 1_024).fill(1));
  }
}

async function sleep(ms: number, context: ScreenplayAdapterContext): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    context.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        try {
          context.throwIfCancelled();
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Cancelled'));
        }
      },
      { once: true },
    );
  });
}

function element(index: number): ScreenplayConversionElement {
  return {
    id: `synthetic-${index + 1}`,
    status: 'uncertain',
    source: { kind: 'line', location: { unit: 'line', start: index, end: index + 1 } },
    target: null,
    summary: `Synthetic element ${index + 1}`,
    warnings: [],
  };
}

function flood(count: number): ScreenplayAdapterOutput {
  return {
    convertedFountain: '!'.padEnd(Math.max(count, 1), 'x'),
    elements: [element(0)],
    warnings: [],
  };
}

function swarm(count: number): ScreenplayAdapterOutput {
  const elements: ScreenplayConversionElement[] = [];
  for (let index = 0; index < Math.max(count, 1); index += 1) elements.push(element(index));
  return { convertedFountain: '!swarm', elements, warnings: [] };
}

export function createRuntimeTestAdapter(): ScreenplayAdapter {
  return new RuntimeTestAdapter();
}
