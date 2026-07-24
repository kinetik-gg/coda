import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { InstanceManagementController } from './instance-management.controller';

const owner = { id: 'owner-1', email: 'owner@example.test', displayName: 'Owner' };

describe('InstanceManagementController two-factor reset', () => {
  it('delegates an owner-initiated 2FA reset to the two-factor service', async () => {
    const twoFactor = { resetForUser: vi.fn().mockResolvedValue({ reset: true }) };
    const controller = new InstanceManagementController(
      {} as never,
      {} as never,
      twoFactor as never,
    );

    const result = await controller.resetUserTwoFactor({ user: owner } as Request, 'member-9');

    expect(twoFactor.resetForUser).toHaveBeenCalledWith('owner-1', 'member-9');
    expect(result).toEqual({ data: { reset: true } });
  });

  it('delegates an administrator password reset', async () => {
    const auth = { administratorResetPassword: vi.fn().mockResolvedValue({ reset: true }) };
    const controller = new InstanceManagementController({} as never, auth as never, {} as never);

    await controller.resetUserPassword({ user: owner } as Request, 'member-9', {
      password: 'a-sufficiently-long-password',
    });

    expect(auth.administratorResetPassword).toHaveBeenCalledWith(
      'owner-1',
      'member-9',
      'a-sufficiently-long-password',
    );
  });
});
