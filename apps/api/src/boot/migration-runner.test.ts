import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, type Spawn } from './migration-runner';

class FakeChild extends EventEmitter {
  stderr = new EventEmitter();
}

describe('runMigrations', () => {
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  afterEach(() => {
    stderrWrite.mockClear();
  });

  it('resolves when prisma migrate deploy exits 0, forwarding stdout via inherit', async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child as unknown as ChildProcess) as unknown as Spawn;
    const promise = runMigrations('/app/apps/api', spawnFn);
    child.emit('exit', 0);
    await expect(promise).resolves.toBeUndefined();
    expect(spawnFn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['migrate', 'deploy', '--schema']),
      expect.objectContaining({ stdio: ['ignore', 'inherit', 'pipe'] }),
    );
    const [, args] = vi.mocked(spawnFn).mock.calls[0]!;
    expect(args.at(-1)).toBe('/app/apps/api/prisma/schema.prisma');
  });

  it('rejects with the captured stderr text on a non-zero exit', async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child as unknown as ChildProcess) as unknown as Spawn;
    const promise = runMigrations('/app/apps/api', spawnFn);
    child.stderr.emit('data', Buffer.from('P1001: Can not reach database server'));
    child.emit('exit', 1);
    await expect(promise).rejects.toThrow('P1001: Can not reach database server');
    expect(stderrWrite).toHaveBeenCalled();
  });

  it('rejects with a generic message when the process exits non-zero with no stderr', async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child as unknown as ChildProcess) as unknown as Spawn;
    const promise = runMigrations('/app/apps/api', spawnFn);
    child.emit('exit', 1);
    await expect(promise).rejects.toThrow('exited with code 1');
  });

  it('rejects when the child process itself fails to spawn', async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child as unknown as ChildProcess) as unknown as Spawn;
    const promise = runMigrations('/app/apps/api', spawnFn);
    const error = new Error('spawn failed');
    child.emit('error', error);
    await expect(promise).rejects.toBe(error);
  });
});
