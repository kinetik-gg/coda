import type { ProblemDetails, ScreenplayCheckpoint } from '@coda/contracts';
import { api, ApiError } from '../api';
import type { ScreenplayPaperSize } from './screenplay-paper';

export type ScreenplayExportKind = 'fountain' | 'pdf' | 'final-draft';

export interface ScreenplayExportDocument {
  sourceText: string;
  paperSize: ScreenplayPaperSize;
}

export interface ScreenplayExportSnapshot extends ScreenplayExportDocument {
  checkpointId: string;
  screenplayVersion: number;
  filename: string;
}

export interface ScreenplayCheckpointClient {
  create(screenplayId: string, version: number): Promise<ScreenplayCheckpoint>;
  fetchSource(screenplayId: string, checkpointId: string): Promise<string>;
}

interface ScreenplayExportCoordinatorOptions {
  screenplayId: string;
  persist: () => Promise<boolean>;
  getCurrentDocument: () => ScreenplayExportDocument;
  getCurrentVersion: () => number;
  client?: ScreenplayCheckpointClient;
}

export class ScreenplayExportCheckpointError extends Error {
  constructor(
    readonly code: 'save' | 'changed' | 'checkpoint' | 'fetch' | 'integrity',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScreenplayExportCheckpointError';
  }
}

export class ScreenplayExportCoordinator {
  private readonly client: ScreenplayCheckpointClient;
  private snapshotFlight: Promise<ScreenplayExportSnapshot> | undefined;
  private readonly exportFlights = new Map<ScreenplayExportKind, Promise<void>>();

  constructor(private readonly options: ScreenplayExportCoordinatorOptions) {
    this.client = options.client ?? screenplayCheckpointClient;
  }

  run(
    kind: ScreenplayExportKind,
    exporter: (snapshot: ScreenplayExportSnapshot) => void | Promise<void>,
  ): Promise<void> {
    const current = this.exportFlights.get(kind);
    if (current) return current;
    const task = this.prepare()
      .then(exporter)
      .finally(() => {
        if (this.exportFlights.get(kind) === task) this.exportFlights.delete(kind);
        if (!this.exportFlights.size) this.snapshotFlight = undefined;
      });
    this.exportFlights.set(kind, task);
    return task;
  }

  private prepare(): Promise<ScreenplayExportSnapshot> {
    if (this.snapshotFlight) return this.snapshotFlight;
    const requested = Object.freeze({ ...this.options.getCurrentDocument() });
    this.snapshotFlight = this.createSnapshot(requested);
    return this.snapshotFlight;
  }

  private async createSnapshot(
    requested: ScreenplayExportDocument,
  ): Promise<ScreenplayExportSnapshot> {
    const saved = await this.options.persist();
    if (!saved) {
      throw new ScreenplayExportCheckpointError(
        'save',
        'The screenplay could not be saved, so no export was created. Resolve the save error and retry.',
      );
    }
    if (!sameDocument(requested, this.options.getCurrentDocument())) {
      throw new ScreenplayExportCheckpointError(
        'changed',
        'The screenplay changed while the export was being prepared. No file was created; retry to export the latest draft.',
      );
    }
    const version = this.options.getCurrentVersion();
    const checkpoint = await this.createCheckpoint(version);
    if (checkpoint.screenplayVersion !== version) {
      throw new ScreenplayExportCheckpointError(
        'integrity',
        'The export checkpoint did not match the saved screenplay version. No file was created.',
      );
    }
    if (checkpoint.paperSize !== requested.paperSize) {
      throw new ScreenplayExportCheckpointError(
        'integrity',
        'The export checkpoint paper size did not match the saved draft. No file was created.',
      );
    }
    const sourceText = await this.fetchSource(checkpoint.id);
    if (
      sourceText !== requested.sourceText ||
      new TextEncoder().encode(sourceText).byteLength !== checkpoint.sourceByteLength
    ) {
      throw new ScreenplayExportCheckpointError(
        'integrity',
        'The immutable export snapshot did not match the saved draft. No file was created.',
      );
    }
    return Object.freeze({
      checkpointId: checkpoint.id,
      screenplayVersion: checkpoint.screenplayVersion,
      filename: checkpoint.filename,
      sourceText,
      paperSize: checkpoint.paperSize,
    });
  }

  private async createCheckpoint(version: number): Promise<ScreenplayCheckpoint> {
    try {
      return await this.client.create(this.options.screenplayId, version);
    } catch (error) {
      const detail = error instanceof ApiError ? error.problem.detail : undefined;
      throw new ScreenplayExportCheckpointError(
        'checkpoint',
        detail
          ? `Coda could not create an immutable export checkpoint: ${detail}`
          : 'Coda could not create an immutable export checkpoint. No file was created; retry after checking your connection.',
        { cause: error },
      );
    }
  }

  private async fetchSource(checkpointId: string): Promise<string> {
    try {
      return await this.client.fetchSource(this.options.screenplayId, checkpointId);
    } catch (error) {
      throw new ScreenplayExportCheckpointError(
        'fetch',
        'Coda created the checkpoint but could not retrieve its Fountain source. No file was created; retry the export.',
        { cause: error },
      );
    }
  }
}

export const screenplayCheckpointClient: ScreenplayCheckpointClient = {
  create(screenplayId, version) {
    return api<ScreenplayCheckpoint>(
      `/api/v1/screenplays/${encodeURIComponent(screenplayId)}/checkpoints`,
      { method: 'POST', body: JSON.stringify({ version }) },
    );
  },

  async fetchSource(screenplayId, checkpointId) {
    const response = await fetch(
      `/api/v1/screenplays/${encodeURIComponent(screenplayId)}/checkpoints/${encodeURIComponent(checkpointId)}/export.fountain`,
      { credentials: 'same-origin' },
    );
    if (!response.ok) throw await checkpointFetchError(response);
    const bytes = await response.arrayBuffer();
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  },
};

function sameDocument(left: ScreenplayExportDocument, right: ScreenplayExportDocument): boolean {
  return left.sourceText === right.sourceText && left.paperSize === right.paperSize;
}

async function checkpointFetchError(response: Response): Promise<Error> {
  try {
    return new ApiError((await response.json()) as ProblemDetails);
  } catch {
    return new Error(`Checkpoint download failed with status ${String(response.status)}`);
  }
}
