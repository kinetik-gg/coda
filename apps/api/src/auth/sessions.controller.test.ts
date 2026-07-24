import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { SessionsController } from './sessions.controller';

const user = { id: 'user-1' };

function controllerWith() {
  const sessions = {
    list: vi.fn().mockResolvedValue([]),
    revoke: vi.fn().mockResolvedValue({ revoked: true }),
    signOutEverywhere: vi.fn().mockResolvedValue({ signedOut: 2 }),
  };
  return { sessions, controller: new SessionsController(sessions as never) };
}

describe('SessionsController', () => {
  it('lists the caller sessions using their current session id', async () => {
    const { controller, sessions } = controllerWith();
    const request = { user, sessionId: 'session-1' } as Request;

    await controller.list(request);

    expect(sessions.list).toHaveBeenCalledWith('user-1', 'session-1');
  });

  it('revokes a session by id scoped to the caller', async () => {
    const { controller, sessions } = controllerWith();
    const request = { user, sessionId: 'session-1' } as Request;

    await controller.revoke(request, 'session-2');

    expect(sessions.revoke).toHaveBeenCalledWith('user-1', 'session-2');
  });

  it('defaults sign-out-everywhere to keeping the current session', async () => {
    const { controller, sessions } = controllerWith();
    const request = { user, sessionId: 'session-1' } as Request;

    await controller.signOutEverywhere(request, {});

    expect(sessions.signOutEverywhere).toHaveBeenCalledWith('user-1', 'session-1', true);
  });

  it('honors an explicit keepCurrent: false to also sign out the current session', async () => {
    const { controller, sessions } = controllerWith();
    const request = { user, sessionId: 'session-1' } as Request;

    await controller.signOutEverywhere(request, { keepCurrent: false });

    expect(sessions.signOutEverywhere).toHaveBeenCalledWith('user-1', 'session-1', false);
  });

  it('tolerates a missing request body', async () => {
    const { controller, sessions } = controllerWith();
    const request = { user, sessionId: 'session-1' } as Request;

    await controller.signOutEverywhere(request, undefined);

    expect(sessions.signOutEverywhere).toHaveBeenCalledWith('user-1', 'session-1', true);
  });
});
