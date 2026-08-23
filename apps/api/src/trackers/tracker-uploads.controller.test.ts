import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { TrackerUploadsController } from './tracker-uploads.controller';

const trackerId = '11111111-1111-4111-8111-111111111111';
const uploadId = '22222222-2222-4222-8222-222222222222';

function request(): Request {
  return { user: { id: 'user-1' } } as unknown as Request;
}

function setup() {
  const storage = {
    createUpload: vi.fn().mockResolvedValue({ id: uploadId, status: 'PENDING' }),
    completeUpload: vi.fn().mockResolvedValue({ id: uploadId, status: 'READY' }),
    readUrl: vi.fn().mockResolvedValue({ url: 'https://objects.test/signed', expiresIn: 300 }),
  };
  const realtime = { invalidateTracker: vi.fn().mockResolvedValue(undefined) };
  const controller = new TrackerUploadsController(storage as never, realtime as never);
  return { controller, storage, realtime };
}

describe('TrackerUploadsController', () => {
  it('reserves a tracker-owned upload and invalidates the tracker room after persistence', async () => {
    const { controller, storage, realtime } = setup();

    const result = await controller.create(request(), trackerId, {
      kind: 'image',
      filename: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 10,
    });

    expect(storage.createUpload).toHaveBeenCalledWith(
      'user-1',
      { kind: 'image', filename: 'photo.png', mimeType: 'image/png', sizeBytes: 10 },
      { kind: 'tracker', id: trackerId },
    );
    expect(result).toEqual({ data: { id: uploadId, status: 'PENDING' } });
    expect(realtime.invalidateTracker).toHaveBeenCalledOnce();
  });

  it('completes against the path-scoped owner and invalidates the room', async () => {
    const { controller, storage, realtime } = setup();

    await controller.complete(request(), trackerId, uploadId, { version: 2 });

    expect(storage.completeUpload).toHaveBeenCalledWith(
      'user-1',
      uploadId,
      2,
      { kind: 'tracker', id: trackerId },
    );
    expect(realtime.invalidateTracker).toHaveBeenCalledWith(trackerId, 'tracker', [uploadId]);
  });

  it('returns the read target without emitting an invalidation', async () => {
    const { controller, storage, realtime } = setup();

    const result = await controller.content(request(), trackerId, uploadId);

    expect(storage.readUrl).toHaveBeenCalledWith('user-1', uploadId, {
      kind: 'tracker',
      id: trackerId,
    });
    expect(result).toEqual({ data: { url: 'https://objects.test/signed', expiresIn: 300 } });
    expect(realtime.invalidateTracker).not.toHaveBeenCalled();
  });
});
