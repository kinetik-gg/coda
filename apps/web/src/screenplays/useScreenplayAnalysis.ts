import { useCallback, useEffect, useRef, useState } from 'react';
import {
  emptyScreenplayAnalysis,
  type ScreenplayAnalysis,
  type ScreenplayAnalysisRequest,
  type ScreenplayAnalysisResponse,
} from './screenplay-analysis';
import type { ScreenplayPaperSize } from './screenplay-paper';

export interface ScreenplayAnalysisWorkerPort {
  postMessage: (message: ScreenplayAnalysisRequest) => void;
  addEventListener: (type: 'message' | 'error', listener: EventListener) => void;
  removeEventListener: (type: 'message' | 'error', listener: EventListener) => void;
  terminate: () => void;
}

export type ScreenplayAnalysisWorkerFactory = () => ScreenplayAnalysisWorkerPort | undefined;

interface PendingAnalysis {
  requestId: number;
  source: string;
  paperSize: ScreenplayPaperSize;
}

interface ScreenplayAnalysisState extends ScreenplayAnalysis {
  analysisDraft: string;
}

const ANALYSIS_DEBOUNCE_MS = 80;

export function useScreenplayAnalysis(
  source: string,
  paperSize: ScreenplayPaperSize,
  workerFactory: ScreenplayAnalysisWorkerFactory = createScreenplayAnalysisWorker,
): ScreenplayAnalysisState {
  const [state, setState] = useState<ScreenplayAnalysisState>({
    ...emptyScreenplayAnalysis,
    analysisDraft: '',
  });
  const worker = useRef<ScreenplayAnalysisWorkerPort | undefined>(undefined);
  const latest = useRef<PendingAnalysis>({ requestId: 0, source: '', paperSize: 'letter' });
  const analysisTimer = useRef<number | undefined>(undefined);
  const fallbackTimer = useRef<number | undefined>(undefined);

  const commit = useCallback((requestId: number, analysis: ScreenplayAnalysis) => {
    if (latest.current.requestId !== requestId) return;
    setState({ ...analysis, analysisDraft: latest.current.source });
  }, []);

  const runFallback = useCallback(
    (request: PendingAnalysis) => {
      if (fallbackTimer.current !== undefined) window.clearTimeout(fallbackTimer.current);
      fallbackTimer.current = window.setTimeout(() => {
        fallbackTimer.current = undefined;
        if (latest.current.requestId !== request.requestId) return;
        void import('./screenplay-analysis-build').then(({ buildScreenplayAnalysis }) => {
          if (latest.current.requestId !== request.requestId) return;
          commit(request.requestId, buildScreenplayAnalysis(request.source, request.paperSize));
        });
      }, 0);
    },
    [commit],
  );

  const submit = useCallback(
    (request: PendingAnalysis) => {
      try {
        if (worker.current) worker.current.postMessage({ type: 'analyze', ...request });
        else runFallback(request);
      } catch {
        worker.current?.terminate();
        worker.current = undefined;
        runFallback(request);
      }
    },
    [runFallback],
  );

  useEffect(() => {
    let port: ScreenplayAnalysisWorkerPort | undefined;
    try {
      port = workerFactory();
    } catch {
      port = undefined;
    }
    if (!port) return;
    worker.current = port;
    const onMessage: EventListener = (event) => {
      const response = (event as MessageEvent<ScreenplayAnalysisResponse>).data;
      if (response.requestId !== latest.current.requestId) return;
      if (response.type === 'result') commit(response.requestId, response.analysis);
      else runFallback(latest.current);
    };
    const onError: EventListener = () => {
      port?.terminate();
      if (worker.current === port) worker.current = undefined;
      runFallback(latest.current);
    };
    port.addEventListener('message', onMessage);
    port.addEventListener('error', onError);
    return () => {
      port.removeEventListener('message', onMessage);
      port.removeEventListener('error', onError);
      port.terminate();
      if (worker.current === port) worker.current = undefined;
    };
  }, [commit, runFallback, workerFactory]);

  useEffect(() => {
    const request = {
      type: 'analyze' as const,
      requestId: latest.current.requestId + 1,
      source,
      paperSize,
    };
    latest.current = request;
    if (analysisTimer.current !== undefined) window.clearTimeout(analysisTimer.current);
    analysisTimer.current = window.setTimeout(() => {
      analysisTimer.current = undefined;
      if (latest.current.requestId === request.requestId) submit(request);
    }, ANALYSIS_DEBOUNCE_MS);
  }, [paperSize, source, submit]);

  useEffect(
    () => () => {
      latest.current = { ...latest.current, requestId: latest.current.requestId + 1 };
      if (analysisTimer.current !== undefined) window.clearTimeout(analysisTimer.current);
      if (fallbackTimer.current !== undefined) window.clearTimeout(fallbackTimer.current);
    },
    [],
  );

  return state;
}

function createScreenplayAnalysisWorker(): ScreenplayAnalysisWorkerPort | undefined {
  if (typeof Worker === 'undefined') return undefined;
  return new Worker(new URL('./screenplay-analysis.worker.ts', import.meta.url), {
    type: 'module',
    name: 'screenplay-analysis',
  });
}
