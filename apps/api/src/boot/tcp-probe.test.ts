import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { tcpProbe } from './tcp-probe';

class FakeSocket extends EventEmitter {
  destroy = vi.fn();
}

describe('tcpProbe', () => {
  it('resolves when the socket connects', async () => {
    const socket = new FakeSocket();
    const factory = vi.fn(() => socket as unknown as Socket);
    const promise = tcpProbe('db.example.com', 5432, 1_000, factory);
    socket.emit('connect');
    await expect(promise).resolves.toBeUndefined();
    expect(factory).toHaveBeenCalledWith({ host: 'db.example.com', port: 5432 });
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('rejects with the underlying error when the socket errors', async () => {
    const socket = new FakeSocket();
    const factory = vi.fn(() => socket as unknown as Socket);
    const promise = tcpProbe('db.example.com', 5432, 1_000, factory);
    const error = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    socket.emit('error', error);
    await expect(promise).rejects.toBe(error);
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('rejects with an ETIMEDOUT error once the timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const factory = vi.fn(() => socket as unknown as Socket);
      const promise = tcpProbe('db.example.com', 5432, 50, factory);
      const assertion = expect(promise).rejects.toMatchObject({ code: 'ETIMEDOUT' });
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
      expect(socket.destroy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a late error after the timeout has already settled the promise', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const factory = vi.fn(() => socket as unknown as Socket);
      const promise = tcpProbe('db.example.com', 5432, 10, factory);
      const assertion = expect(promise).rejects.toMatchObject({ code: 'ETIMEDOUT' });
      await vi.advanceTimersByTimeAsync(10);
      socket.emit('error', new Error('too late'));
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a late connect after the timeout has already settled the promise', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const factory = vi.fn(() => socket as unknown as Socket);
      const promise = tcpProbe('db.example.com', 5432, 10, factory);
      const assertion = expect(promise).rejects.toMatchObject({ code: 'ETIMEDOUT' });
      await vi.advanceTimersByTimeAsync(10);
      socket.emit('connect');
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults to the real net.connect factory', async () => {
    await expect(tcpProbe('127.0.0.1', 1, 100)).rejects.toBeTruthy();
  });
});
