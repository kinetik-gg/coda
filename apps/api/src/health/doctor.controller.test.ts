import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { DoctorController } from './doctor.controller';

describe('DoctorController', () => {
  it('delegates to the service with the authenticated user and wraps the result in `data`', async () => {
    const report = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      instanceOrigin: 'https://coda.test',
      rows: [],
      reportText: 'text',
    };
    const doctor = { report: vi.fn().mockResolvedValue(report) };
    const controller = new DoctorController(doctor as never);
    const request = { user: { id: 'owner-1' } } as Request;

    await expect(controller.report(request)).resolves.toEqual({ data: report });
    expect(doctor.report).toHaveBeenCalledWith('owner-1');
  });
});
