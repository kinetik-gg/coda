// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeTrackerUpload,
  createTrackerUpload,
  uploadFileWithProgress,
  type TransferOptions,
} from '../../api';
import { trackerMediaMeta } from './tracker-media-model';
import {
  MAX_CONCURRENT_MEDIA_UPLOADS,
  useTrackerMediaUpload,
} from './use-tracker-media-upload';

vi.mock('../../api', () => ({
  createTrackerUpload: vi.fn(),
  completeTrackerUpload: vi.fn(),
  uploadFileWithProgress: vi.fn(),
}));

const mockedCreate = vi.mocked(createTrackerUpload);
const mockedTransfer = vi.mocked(uploadFileWithProgress);
const mockedComplete = vi.mocked(completeTrackerUpload);

const target = {
  id: 'object-1',
  version: 1,
  status: 'PENDING',
  uploadUrl: 'https://objects.test/presigned',
  directUpload: true,
};

function file(name = 'board.png'): File {
  return new File(['bytes'], name, { type: 'image/png' });
}

function setup(onReady = vi.fn()) {
  const hook = renderHook(() =>
    useTrackerMediaUpload({ trackerId: 't1', kind: 'image', onReady }),
  );
  return { ...hook, onReady };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  [mockedCreate, mockedTransfer, mockedComplete].forEach((fn) => fn.mockReset());
});

afterEach(cleanup);

describe('tracker media upload flow', () => {
  it('runs reserve → PUT → complete and hands the READY id to onReady', async () => {
    mockedCreate.mockResolvedValue(target);
    mockedTransfer.mockResolvedValue(undefined);
    mockedComplete.mockResolvedValue({
      id: 'object-1',
      kind: 'IMAGE',
      status: 'READY',
      originalFilename: 'board.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
    const { onReady, result } = setup();
    act(() => result.current.start(file()));
    expect(result.current.busy).toBe(true);
    await vi.waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(mockedCreate).toHaveBeenCalledWith({
      trackerId: 't1',
      kind: 'image',
      filename: 'board.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
    expect(mockedTransfer).toHaveBeenCalledWith(target, expect.anything(), expect.anything());
    const transferred = mockedTransfer.mock.calls[0]?.[1];
    expect(transferred).toBeInstanceOf(File);
    const options = mockedTransfer.mock.calls[0]?.[2] as TransferOptions;
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(mockedComplete).toHaveBeenCalledWith({
      trackerId: 't1',
      uploadId: 'object-1',
      version: 1,
    });
    expect(onReady).toHaveBeenCalledWith('object-1');
    // The chip metadata is remembered for the read-only renders.
    expect(trackerMediaMeta('object-1')).toMatchObject({
      filename: 'board.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
  });

  it('forwards the driver-negotiated target untouched for proxied uploads', async () => {
    const proxied = { ...target, uploadUrl: '/api/v1/trackers/t1/uploads/x', directUpload: false };
    mockedCreate.mockResolvedValue(proxied);
    mockedTransfer.mockResolvedValue(undefined);
    mockedComplete.mockResolvedValue({
      id: proxied.id,
      kind: 'IMAGE',
      status: 'READY',
      originalFilename: 'board.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
    const { result } = setup(vi.fn());
    act(() => result.current.start(file()));
    await vi.waitFor(() => expect(mockedComplete).toHaveBeenCalled());
    // The capability flag rides along; the XHR layer picks the request shape from it.
    expect(mockedTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ directUpload: false }),
      expect.any(File),
      expect.anything(),
    );
  });

  it('reports byte progress while transferring', async () => {
    mockedCreate.mockResolvedValue(target);
    mockedTransfer.mockImplementation((_target, _file, options?: TransferOptions) => {
      options?.onProgress?.(0.5);
      return Promise.resolve();
    });
    mockedComplete.mockResolvedValue({
      id: 'object-1',
      kind: 'IMAGE',
      status: 'READY',
      originalFilename: 'board.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
    const { result } = setup(vi.fn());
    act(() => result.current.start(file()));
    await vi.waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(result.current.progress).toBe(0.5);
  });

  it('surfaces API rejections verbatim and skips complete', async () => {
    mockedCreate.mockRejectedValue(new Error('Upload exceeds the 10485760-byte limit'));
    const { result } = setup(vi.fn());
    act(() => result.current.start(file()));
    await vi.waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error).toBe('Upload exceeds the 10485760-byte limit');
    expect(result.current.busy).toBe(false);
    expect(mockedTransfer).not.toHaveBeenCalled();
    expect(mockedComplete).not.toHaveBeenCalled();
  });

  it('reports transfer failures without calling complete', async () => {
    mockedCreate.mockResolvedValue(target);
    mockedTransfer.mockRejectedValue(new Error('The object store rejected the upload.'));
    const { result } = setup(vi.fn());
    act(() => result.current.start(file()));
    await vi.waitFor(() => expect(result.current.error).toBeDefined());
    expect(mockedComplete).not.toHaveBeenCalled();
  });

  it('cancel aborts the transfer and completes nothing', async () => {
    const pending = deferred<void>();
    let observedSignal: AbortSignal | undefined;
    mockedCreate.mockResolvedValue(target);
    mockedTransfer.mockImplementation((_target, _file, options?: TransferOptions) => {
      observedSignal = options?.signal;
      return pending.promise;
    });
    const { onReady, result } = setup();
    act(() => result.current.start(file()));
    await vi.waitFor(() => expect(mockedTransfer).toHaveBeenCalled());
    act(() => result.current.cancel());
    expect(result.current.busy).toBe(false);
    expect(observedSignal?.aborted).toBe(true);
    act(() => pending.resolve());
    await Promise.resolve();
    expect(mockedComplete).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(result.current.error).toBeUndefined();
  });

  it('cleans up a still-pending upload when the editor unmounts', async () => {
    const pending = deferred<typeof target>();
    mockedCreate.mockReturnValue(pending.promise);
    const { onReady, result, unmount } = setup();
    await act(async () => {
      result.current.start(file());
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      pending.resolve(target);
      await pending.promise;
    });
    expect(mockedComplete).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
});

describe('upload concurrency cap', () => {
  it(`queues starts beyond ${MAX_CONCURRENT_MEDIA_UPLOADS} concurrent transfers`, async () => {
    const creations = [deferred<typeof target>(), deferred<typeof target>(), deferred<typeof target>()];
    let created = 0;
    mockedCreate.mockImplementation(() => creations[created++]!.promise);
    mockedTransfer.mockResolvedValue(undefined);
    mockedComplete.mockResolvedValue({
      id: 'done',
      kind: 'IMAGE',
      status: 'READY',
      originalFilename: 'x',
      mimeType: 'image/png',
      sizeBytes: 1,
    });
    const { result } = setup(vi.fn());
    await act(async () => {
      result.current.start(file('one.png'));
      result.current.start(file('two.png'));
      result.current.start(file('three.png'));
      await Promise.resolve();
    });
    expect(mockedCreate).toHaveBeenCalledTimes(2);
    act(() => creations[0]!.resolve(target));
    await vi.waitFor(() => expect(mockedComplete).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(3));
    act(() => creations[1]!.resolve(target));
    act(() => creations[2]!.resolve(target));
    await vi.waitFor(() => expect(mockedComplete).toHaveBeenCalledTimes(3));
  });
});
