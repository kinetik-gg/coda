import { connect, type Socket } from 'node:net';

export type SocketFactory = (options: { host: string; port: number }) => Socket;

function timeoutError(host: string, port: number): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`Timed out connecting to ${host}:${port}`);
  error.code = 'ETIMEDOUT';
  return error;
}

/**
 * Attempt a raw TCP connection to `host:port` and resolve once the connection opens, or reject
 * with a Node system error (`ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`, ...) otherwise. This runs
 * ahead of the Postgres protocol handshake so DNS and network-reachability failures can be told
 * apart from TLS or authentication failures, which Prisma's own error surface does not
 * distinguish reliably.
 */
export function tcpProbe(
  host: string,
  port: number,
  timeoutMs: number,
  socketFactory: SocketFactory = connect,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = socketFactory({ host, port });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(timeoutError(host, port));
    }, timeoutMs);
    socket.once('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}
