// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ScreenplayAnalysisRequest,
  type ScreenplayAnalysisResponse,
} from './screenplay-analysis';
import { buildScreenplayAnalysis } from './screenplay-analysis-build';
import {
  useScreenplayAnalysis,
  type ScreenplayAnalysisWorkerFactory,
  type ScreenplayAnalysisWorkerPort,
} from './useScreenplayAnalysis';

afterEach(cleanup);

class TestAnalysisWorker implements ScreenplayAnalysisWorkerPort {
  readonly requests: ScreenplayAnalysisRequest[] = [];
  readonly listeners = {
    message: new Set<EventListener>(),
    error: new Set<EventListener>(),
  };
  terminated = false;

  postMessage(message: ScreenplayAnalysisRequest): void {
    this.requests.push(message);
  }

  addEventListener(type: 'message' | 'error', listener: EventListener): void {
    this.listeners[type].add(listener);
  }

  removeEventListener(type: 'message' | 'error', listener: EventListener): void {
    this.listeners[type].delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: ScreenplayAnalysisResponse): void {
    const event = new MessageEvent('message', { data: response });
    for (const listener of this.listeners.message) listener(event);
  }
}

function AnalysisHarness({ workerFactory }: { workerFactory: ScreenplayAnalysisWorkerFactory }) {
  const [draft, setDraft] = useState('FIRST');
  const analysis = useScreenplayAnalysis(draft, 'letter', workerFactory);
  return (
    <>
      <label>
        Draft
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <output data-testid="analysis-source">{analysis.analysisDraft}</output>
      <output data-testid="analysis-words">{analysis.wordCount}</output>
    </>
  );
}

describe('useScreenplayAnalysis', () => {
  it('keeps typing synchronous and rejects out-of-order worker results', async () => {
    const worker = new TestAnalysisWorker();
    render(<AnalysisHarness workerFactory={() => worker} />);
    const editor = screen.getByLabelText('Draft');

    fireEvent.change(editor, { target: { value: 'SECOND DRAFT' } });
    fireEvent.change(editor, { target: { value: 'LATEST DRAFT NOW' } });

    expect(editor).toHaveValue('LATEST DRAFT NOW');
    expect(screen.getByTestId('analysis-source')).toHaveTextContent('');
    await waitFor(() => expect(worker.requests).toHaveLength(3));
    const [first, second, latest] = worker.requests;
    if (!first || !second || !latest) throw new Error('Expected three analysis requests');

    act(() => {
      worker.respond({
        type: 'result',
        requestId: second.requestId,
        analysis: buildScreenplayAnalysis(second.source, second.paperSize),
      });
      worker.respond({
        type: 'result',
        requestId: first.requestId,
        analysis: buildScreenplayAnalysis(first.source, first.paperSize),
      });
    });
    expect(screen.getByTestId('analysis-source')).toHaveTextContent('');

    act(() => {
      worker.respond({
        type: 'result',
        requestId: latest.requestId,
        analysis: buildScreenplayAnalysis(latest.source, latest.paperSize),
      });
    });
    expect(screen.getByTestId('analysis-source')).toHaveTextContent('LATEST DRAFT NOW');
    expect(screen.getByTestId('analysis-words')).toHaveTextContent('3');
  });

  it('terminates its worker when the editor unmounts', () => {
    const worker = new TestAnalysisWorker();
    const view = render(<AnalysisHarness workerFactory={() => worker} />);

    view.unmount();

    expect(worker.terminated).toBe(true);
  });
});
