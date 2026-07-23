import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import {
  ScreenplayExportCheckpointError,
  ScreenplayExportCoordinator,
  screenplayCheckpointClient,
  type ScreenplayCheckpointClient,
  type ScreenplayExportDocument,
  type ScreenplayExportSnapshot,
} from './screenplay-export-checkpoint';

afterEach(() => {
  vi.unstubAllGlobals();
});

const document: ScreenplayExportDocument = {
  sourceText: 'INT. ROOM - DAY\n\nExact checkpoint text.',
  paperSize: 'a4',
};

function checkpoint(sourceText = document.sourceText) {
  return {
    id: 'checkpoint-id',
    screenplayId: 'screenplay-id',
    screenplayVersion: 8,
    filename: 'immutable-name.fountain',
    paperSize: document.paperSize,
    sourceByteLength: new TextEncoder().encode(sourceText).byteLength,
    createdAt: '2026-07-23T00:00:00.000Z',
  };
}

function client(sourceText = document.sourceText) {
  return {
    create: vi.fn(() => Promise.resolve(checkpoint(sourceText))),
    fetchSource: vi.fn(() => Promise.resolve(sourceText)),
  } satisfies ScreenplayCheckpointClient;
}

function coordinator(
  overrides: {
    persist?: () => Promise<boolean>;
    getCurrentDocument?: () => ScreenplayExportDocument;
    client?: ScreenplayCheckpointClient;
  } = {},
) {
  return new ScreenplayExportCoordinator({
    screenplayId: 'screenplay-id',
    persist: overrides.persist ?? (() => Promise.resolve(true)),
    getCurrentDocument: overrides.getCurrentDocument ?? (() => document),
    getCurrentVersion: () => 8,
    client: overrides.client ?? client(),
  });
}

describe('ScreenplayExportCoordinator', () => {
  it('stops before checkpointing or downloading when persistence fails', async () => {
    const checkpointClient = client();
    const exporter = vi.fn();
    const task = coordinator({
      persist: () => Promise.resolve(false),
      client: checkpointClient,
    }).run('fountain', exporter);

    await expect(task).rejects.toMatchObject({ code: 'save' });
    expect(checkpointClient.create).not.toHaveBeenCalled();
    expect(checkpointClient.fetchSource).not.toHaveBeenCalled();
    expect(exporter).not.toHaveBeenCalled();
  });

  it('surfaces checkpoint conflicts and never falls back to mutable content', async () => {
    const checkpointClient = client();
    checkpointClient.create.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'Screenplay was modified by another session',
      }),
    );
    const exporter = vi.fn();
    const task = coordinator({ client: checkpointClient }).run('pdf', exporter);

    const error: unknown = await task.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ScreenplayExportCheckpointError);
    if (!(error instanceof ScreenplayExportCheckpointError)) throw error;
    expect(error.code).toBe('checkpoint');
    expect(error.message).toContain('modified by another session');
    expect(checkpointClient.fetchSource).not.toHaveBeenCalled();
    expect(exporter).not.toHaveBeenCalled();
  });

  it('rejects a checkpoint payload that differs from the exact saved draft', async () => {
    const exporter = vi.fn();
    const task = coordinator({ client: client('OLDER SERVER TEXT') }).run('final-draft', exporter);

    await expect(task).rejects.toMatchObject({ code: 'integrity' });
    expect(exporter).not.toHaveBeenCalled();
  });

  it('rejects mismatched checkpoint paper metadata before fetching source', async () => {
    const checkpointClient = client();
    checkpointClient.create.mockResolvedValue({ ...checkpoint(), paperSize: 'letter' });
    const exporter = vi.fn();

    await expect(
      coordinator({ client: checkpointClient }).run('pdf', exporter),
    ).rejects.toMatchObject({ code: 'integrity' });
    expect(checkpointClient.fetchSource).not.toHaveBeenCalled();
    expect(exporter).not.toHaveBeenCalled();
  });

  it('aborts when the writer changes the document while persistence is in flight', async () => {
    const checkpointClient = client();
    const getCurrentDocument = vi
      .fn<() => ScreenplayExportDocument>()
      .mockReturnValueOnce(document)
      .mockReturnValue({ sourceText: 'NEWER LOCAL EDIT', paperSize: 'a4' });
    const exporter = vi.fn();
    const task = coordinator({ getCurrentDocument, client: checkpointClient }).run(
      'fountain',
      exporter,
    );

    await expect(task).rejects.toMatchObject({ code: 'changed' });
    expect(checkpointClient.create).not.toHaveBeenCalled();
    expect(exporter).not.toHaveBeenCalled();
  });

  it('coalesces concurrent preparation and duplicate export clicks across every format', async () => {
    let finishSave!: (saved: boolean) => void;
    const persist = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve;
        }),
    );
    const checkpointClient = client();
    const target = coordinator({ persist, client: checkpointClient });
    const fountain = vi.fn<(snapshot: ScreenplayExportSnapshot) => void>();
    const pdf = vi.fn<(snapshot: ScreenplayExportSnapshot) => void>();
    const finalDraft = vi.fn<(snapshot: ScreenplayExportSnapshot) => void>();

    const fountainTask = target.run('fountain', fountain);
    const duplicateFountainTask = target.run('fountain', fountain);
    const pdfTask = target.run('pdf', pdf);
    const finalDraftTask = target.run('final-draft', finalDraft);
    expect(duplicateFountainTask).toBe(fountainTask);
    finishSave(true);
    await Promise.all([fountainTask, duplicateFountainTask, pdfTask, finalDraftTask]);

    expect(persist).toHaveBeenCalledOnce();
    expect(checkpointClient.create).toHaveBeenCalledWith('screenplay-id', 8);
    expect(checkpointClient.create).toHaveBeenCalledOnce();
    expect(checkpointClient.fetchSource).toHaveBeenCalledWith('screenplay-id', 'checkpoint-id');
    expect(checkpointClient.fetchSource).toHaveBeenCalledOnce();
    const expected: ScreenplayExportSnapshot = {
      checkpointId: 'checkpoint-id',
      screenplayVersion: 8,
      filename: 'immutable-name.fountain',
      sourceText: document.sourceText,
      paperSize: 'a4',
    };
    expect(fountain).toHaveBeenCalledOnce();
    expect(fountain).toHaveBeenCalledWith(expected);
    expect(pdf).toHaveBeenCalledWith(expected);
    expect(finalDraft).toHaveBeenCalledWith(expected);
  });
});

describe('screenplayCheckpointClient', () => {
  it('preserves BOM, CRLF, and Unicode bytes when decoding checkpoint Fountain source', async () => {
    const expected = '\uFEFFTitle: Café\r\n\r\nINT. RÜM - DAY\r\n';
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(new TextEncoder().encode(expected), {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          }),
        ),
      ),
    );

    await expect(
      screenplayCheckpointClient.fetchSource('screenplay-id', 'checkpoint-id'),
    ).resolves.toBe(expected);
  });

  it('rejects malformed UTF-8 checkpoint bytes instead of replacing source characters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(new Uint8Array([0xc3, 0x28]), { status: 200 }))),
    );

    await expect(
      screenplayCheckpointClient.fetchSource('screenplay-id', 'checkpoint-id'),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
