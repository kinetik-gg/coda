import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { UpgradeCeremonyController } from './upgrade-ceremony.controller';

const request = { user: { id: 'owner-1' } } as Request;

function makeService() {
  return {
    describe: vi.fn().mockResolvedValue({ phase: 'ready_to_backup' }),
    startBackup: vi.fn().mockResolvedValue({ phase: 'ready_to_deploy' }),
    triggerRedeploy: vi.fn().mockResolvedValue({ phase: 'ready_to_backup' }),
    runCoolifyUpgrade: vi.fn().mockResolvedValue({ phase: 'ready_to_backup' }),
    setRedeployWebhook: vi.fn().mockResolvedValue({ redeployWebhookConfigured: true }),
    clearRedeployWebhook: vi.fn().mockResolvedValue({ redeployWebhookConfigured: false }),
    setCoolify: vi.fn().mockResolvedValue({ coolify: { configured: true } }),
    clearCoolify: vi.fn().mockResolvedValue({ coolify: { configured: false } }),
  };
}

describe('UpgradeCeremonyController', () => {
  it('delegates describe and backup to the authenticated owner', async () => {
    const service = makeService();
    const controller = new UpgradeCeremonyController(service as never);
    await expect(controller.describe(request)).resolves.toEqual({
      data: { phase: 'ready_to_backup' },
    });
    await expect(controller.startBackup(request)).resolves.toEqual({
      data: { phase: 'ready_to_deploy' },
    });
    expect(service.describe).toHaveBeenCalledWith('owner-1');
    expect(service.startBackup).toHaveBeenCalledWith('owner-1');
  });

  it('requires an explicit env-update confirmation for the redeploy', async () => {
    const service = makeService();
    const controller = new UpgradeCeremonyController(service as never);
    await expect(
      controller.triggerRedeploy(request, { confirmedEnvUpdated: false }),
    ).rejects.toThrow();
    await expect(controller.triggerRedeploy(request, {})).rejects.toThrow();
    expect(service.triggerRedeploy).not.toHaveBeenCalled();

    await controller.triggerRedeploy(request, { confirmedEnvUpdated: true });
    expect(service.triggerRedeploy).toHaveBeenCalledWith('owner-1', true);
  });

  it('runs the Coolify deploy for the owner', async () => {
    const service = makeService();
    const controller = new UpgradeCeremonyController(service as never);
    await controller.runCoolifyUpgrade(request);
    expect(service.runCoolifyUpgrade).toHaveBeenCalledWith('owner-1');
  });

  it('parses and forwards the webhook body and rejects a malformed URL', async () => {
    const service = makeService();
    const controller = new UpgradeCeremonyController(service as never);
    await controller.setWebhook(request, { url: 'https://deploy.example/hook' });
    expect(service.setRedeployWebhook).toHaveBeenCalledWith('owner-1', {
      url: 'https://deploy.example/hook',
    });
    await expect(controller.setWebhook(request, { url: 'not-a-url' })).rejects.toThrow();
    await controller.clearWebhook(request);
    expect(service.clearRedeployWebhook).toHaveBeenCalledWith('owner-1');
  });

  it('parses and forwards the Coolify body and rejects a missing token', async () => {
    const service = makeService();
    const controller = new UpgradeCeremonyController(service as never);
    const input = {
      baseUrl: 'https://coolify.example',
      apiToken: 'fixture-token-not-a-secret',
      applicationUuid: 'app-uuid-1234',
    };
    await controller.setCoolify(request, input);
    expect(service.setCoolify).toHaveBeenCalledWith('owner-1', input);
    await expect(controller.setCoolify(request, { ...input, apiToken: '' })).rejects.toThrow();
    await controller.clearCoolify(request);
    expect(service.clearCoolify).toHaveBeenCalledWith('owner-1');
  });
});
