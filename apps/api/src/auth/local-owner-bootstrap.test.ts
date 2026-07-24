import { beforeEach, describe, expect, it, vi } from 'vitest';

const capabilities = { setupTokenBootstrap: 'local-owner' as 'local-owner' | 'token-ceremony' };
vi.mock('../config/runtime-capabilities', () => ({
  runtimeCapabilities: () => capabilities,
}));

import {
  LOCAL_OWNER_DISPLAY_NAME,
  LOCAL_OWNER_EMAIL,
  LocalOwnerBootstrap,
} from './local-owner-bootstrap';

function harness(ownerCount: number) {
  const prisma = { instanceSettings: { count: vi.fn().mockResolvedValue(ownerCount) } };
  const auth = { setupOwner: vi.fn().mockResolvedValue({ id: 'owner-1' }) };
  return { prisma, auth, service: new LocalOwnerBootstrap(prisma as never, auth as never) };
}

describe('LocalOwnerBootstrap', () => {
  beforeEach(() => {
    capabilities.setupTokenBootstrap = 'local-owner';
  });

  it('auto-initializes a single local owner on an uninitialized desktop instance', async () => {
    const { auth, service } = harness(0);

    await service.ensureLocalOwner();

    expect(auth.setupOwner).toHaveBeenCalledTimes(1);
    const input = auth.setupOwner.mock.calls[0]![0] as {
      email: string;
      displayName: string;
      password: string;
    };
    expect(input.email).toBe(LOCAL_OWNER_EMAIL);
    expect(input.displayName).toBe(LOCAL_OWNER_DISPLAY_NAME);
    // A high-entropy password is generated; it is never a fixed or empty value.
    expect(typeof input.password).toBe('string');
    expect(input.password.length).toBeGreaterThanOrEqual(32);
  });

  it('is idempotent — never re-creates an owner once one exists', async () => {
    const { auth, service } = harness(1);

    await service.ensureLocalOwner();

    expect(auth.setupOwner).not.toHaveBeenCalled();
  });

  it('is a no-op under the server (token-ceremony) profile', async () => {
    capabilities.setupTokenBootstrap = 'token-ceremony';
    const { prisma, auth, service } = harness(0);

    await service.ensureLocalOwner();

    expect(prisma.instanceSettings.count).not.toHaveBeenCalled();
    expect(auth.setupOwner).not.toHaveBeenCalled();
  });
});
