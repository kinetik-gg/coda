import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { TwoFactorController } from './two-factor.controller';

const user = { id: 'user-1', email: 'user@example.test', displayName: 'User' };

function harness() {
  const twoFactor = {
    status: vi.fn().mockResolvedValue({ enabled: false, pending: false, available: true }),
    enroll: vi.fn().mockResolvedValue({ secret: 'ABCDEF', otpauthUri: 'otpauth://totp/Coda:u' }),
    activate: vi.fn().mockResolvedValue({ recoveryCodes: ['abcde-fghij'] }),
    disable: vi.fn().mockResolvedValue({ disabled: true }),
  };
  return { twoFactor, controller: new TwoFactorController(twoFactor as never) };
}

describe('TwoFactorController', () => {
  it('returns the account 2FA status', async () => {
    const { controller, twoFactor } = harness();
    const result = await controller.status({ user } as Request);
    expect(twoFactor.status).toHaveBeenCalledWith('user-1');
    expect(result.data).toMatchObject({ available: true });
  });

  it('enrolls using the account email for the provisioning label', async () => {
    const { controller, twoFactor } = harness();
    await controller.enroll({ user } as Request);
    expect(twoFactor.enroll).toHaveBeenCalledWith('user-1', 'user@example.test');
  });

  it('activates with a parsed six-digit code', async () => {
    const { controller, twoFactor } = harness();
    const result = await controller.activate({ user } as Request, { code: '123456' });
    expect(twoFactor.activate).toHaveBeenCalledWith('user-1', '123456');
    expect(result.data.recoveryCodes).toEqual(['abcde-fghij']);
  });

  it('rejects a malformed activation code before reaching the service', async () => {
    const { controller, twoFactor } = harness();
    await expect(controller.activate({ user } as Request, { code: 'nope' })).rejects.toThrow();
    expect(twoFactor.activate).not.toHaveBeenCalled();
  });

  it('disables with a password and a second factor', async () => {
    const { controller, twoFactor } = harness();
    await controller.disable({ user } as Request, { password: 'pw', code: '123456' });
    expect(twoFactor.disable).toHaveBeenCalledWith('user-1', 'pw', '123456');
  });
});
