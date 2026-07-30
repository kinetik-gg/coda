import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ScreenplayRebaseApplyController } from './screenplay-rebase-apply.controller';

const userId = '00000000-0000-4000-8000-0000000000e1';
const projectId = '00000000-0000-4000-8000-000000000001';
const referenceId = '00000000-0000-4000-8000-0000000000a1';
const fingerprint = createHash('sha256').update('plan', 'utf8').digest('hex');

function harness(result: unknown = { planVersion: 1 }) {
  const rebase = { apply: vi.fn(() => Promise.resolve(result)) };
  const controller = new ScreenplayRebaseApplyController(rebase as never);
  const request = { user: { id: userId } } as unknown as Request;
  return { controller, rebase, request };
}

const validBody = {
  planVersion: 1,
  fingerprint,
  decisions: [{ itemSourceReferenceId: referenceId, action: 'keep' }],
};

describe('ScreenplayRebaseApplyController', () => {
  it('answers with the result in the standard envelope', async () => {
    const { controller, rebase, request } = harness();
    await expect(controller.apply(request, projectId, validBody)).resolves.toEqual({
      data: { planVersion: 1 },
    });
    expect(rebase.apply).toHaveBeenCalledWith(userId, projectId, validBody);
  });

  it('parses the body before the service ever sees it', async () => {
    const { controller, rebase, request } = harness();
    await expect(controller.apply(request, projectId, { planVersion: 1 })).rejects.toThrow();
    // A malformed body must not reach a service that opens a serializable transaction.
    expect(rebase.apply).not.toHaveBeenCalled();
  });

  it('rejects an unknown field rather than ignoring it', async () => {
    const { controller, rebase, request } = harness();
    // `.strict()` matters here: a client sending `decisions` under a misspelt key would otherwise
    // look like a caller who recorded no decisions at all, which is the shape of a silent carry.
    await expect(
      controller.apply(request, projectId, { ...validBody, decisionsList: [] }),
    ).rejects.toThrow();
    expect(rebase.apply).not.toHaveBeenCalled();
  });

  it('accepts an apply with no decisions, which authorises only auto-carries', async () => {
    const { controller, rebase, request } = harness();
    await controller.apply(request, projectId, { planVersion: 1, fingerprint, decisions: [] });
    expect(rebase.apply).toHaveBeenCalledWith(userId, projectId, {
      planVersion: 1,
      fingerprint,
      decisions: [],
    });
  });
});
