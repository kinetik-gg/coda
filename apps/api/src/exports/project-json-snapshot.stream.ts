import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ProjectJsonStream } from './project-json.stream';

const SNAPSHOT_MAX_WAIT_MS = 10_000;
const SNAPSHOT_TIMEOUT_MS = 2 * 60_000;

class SnapshotStreamCancelledError extends Error {}

function snapshotError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Project snapshot export failed', { cause: error });
}

interface Receiver<T> {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
}

interface PendingValue<T> {
  value: T;
  resolve: () => void;
  reject: (error: unknown) => void;
}

class SingleValueChannel<T> {
  private receiver?: Receiver<T>;
  private pending?: PendingValue<T>;
  private inFlight?: Pick<PendingValue<T>, 'resolve' | 'reject'>;
  private closed = false;
  private failure?: Error;

  send(value: T): Promise<void> {
    if (this.closed) return Promise.reject(new SnapshotStreamCancelledError());
    if (this.receiver) {
      const receiver = this.receiver;
      this.receiver = undefined;
      return new Promise<void>((resolve, reject) => {
        this.inFlight = { resolve, reject };
        receiver.resolve({ value, done: false });
      });
    }
    return new Promise<void>((resolve, reject) => {
      this.pending = { value, resolve, reject };
    });
  }

  next(): Promise<IteratorResult<T>> {
    this.inFlight?.resolve();
    this.inFlight = undefined;
    if (this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      this.inFlight = { resolve: pending.resolve, reject: pending.reject };
      return Promise.resolve({ value: pending.value, done: false });
    }
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.receiver = { resolve, reject };
    });
  }

  close(): void {
    this.closed = true;
    this.receiver?.resolve({ value: undefined, done: true });
    this.receiver = undefined;
  }

  fail(error: unknown): void {
    const failure = snapshotError(error);
    this.failure = failure;
    this.receiver?.reject(failure);
    this.receiver = undefined;
  }

  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    const error = new SnapshotStreamCancelledError();
    this.inFlight?.reject(error);
    this.inFlight = undefined;
    this.pending?.reject(error);
    this.pending = undefined;
    this.receiver?.resolve({ value: undefined, done: true });
    this.receiver = undefined;
  }
}

async function produceSnapshot(
  client: Prisma.TransactionClient,
  projectId: string,
  channel: SingleValueChannel<string>,
): Promise<void> {
  try {
    for await (const chunk of new ProjectJsonStream(client).generate(projectId)) {
      await channel.send(chunk);
    }
    channel.close();
  } catch (error) {
    if (!(error instanceof SnapshotStreamCancelledError)) channel.fail(error);
    throw snapshotError(error);
  }
}

/**
 * Stream one repeatable-read snapshot with one-chunk backpressure. The database
 * transaction remains open until the consumer finishes or cancels the stream.
 */
export async function* projectJsonSnapshot(
  prisma: PrismaService,
  projectId: string,
): AsyncGenerator<string> {
  const channel = new SingleValueChannel<string>();
  let transactionFailure: Error | undefined;
  const transaction = prisma.$transaction((client) => produceSnapshot(client, projectId, channel), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: SNAPSHOT_MAX_WAIT_MS,
    timeout: SNAPSHOT_TIMEOUT_MS,
  });
  const settled = transaction.catch((error: unknown) => {
    transactionFailure = snapshotError(error);
    channel.fail(transactionFailure);
  });

  try {
    for (;;) {
      const next = await channel.next();
      if (next.done) break;
      yield next.value;
    }
    await settled;
    if (transactionFailure !== undefined) throw transactionFailure;
  } finally {
    channel.cancel();
    await settled;
  }
}
