import {
  type ScreenplayAnalysisRequest,
  type ScreenplayAnalysisResponse,
} from './screenplay-analysis';
import { buildScreenplayAnalysis } from './screenplay-analysis-build';

const COALESCE_DELAY_MS = 24;
const workerScope = self as unknown as {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<ScreenplayAnalysisRequest>) => void,
  ) => void;
  postMessage: (message: ScreenplayAnalysisResponse) => void;
};

let pendingRequest: ScreenplayAnalysisRequest | undefined;
let scheduled = false;

workerScope.addEventListener('message', ({ data }) => {
  if (data.type !== 'analyze') return;
  pendingRequest = data;
  scheduleLatest();
});

function scheduleLatest(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(runLatest, COALESCE_DELAY_MS);
}

function runLatest(): void {
  scheduled = false;
  const request = pendingRequest;
  pendingRequest = undefined;
  if (!request) return;
  try {
    workerScope.postMessage({
      type: 'result',
      requestId: request.requestId,
      analysis: buildScreenplayAnalysis(request.source, request.paperSize),
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'Screenplay analysis failed',
    });
  }
  if (pendingRequest) scheduleLatest();
}
