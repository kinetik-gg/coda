import { classifyDatabaseError, hintsForErrorClass, labelForErrorClass } from './database-error';
import { parseDatabaseTarget } from './database-target';
import type { DiagnosticView } from './diagnostic-page';

export interface DatabaseReadinessOptions {
  readonly databaseUrl: string;
  readonly port: number;
  readonly retryWindowsMs: readonly number[];
}

export interface DiagnosticsHandle {
  close(): Promise<void>;
}

export interface DatabaseReadinessDeps {
  /** Resolve once the database is reachable and authenticated; otherwise reject. */
  probe(): Promise<void>;
  /**
   * Optional safety step run after `probe` succeeds but before `migrate`. Used for the pre-upgrade
   * auto-backup: a rejection here re-enters the diagnostic retry loop exactly like a probe or
   * migration failure, so an upgrade cannot apply migrations without a fresh safety backup.
   */
  preMigrate?(): Promise<void>;
  /** Apply pending migrations; otherwise reject. Only called after `probe` succeeds. */
  migrate(): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Start serving the diagnostic page on `port`, returning a handle to stop it. */
  startDiagnostics(port: number, getView: () => DiagnosticView): Promise<DiagnosticsHandle>;
  now(): number;
  /** Observability hook invoked on every failed attempt, before the retry delay. */
  onAttemptFailed?(view: DiagnosticView, error: unknown): void;
}

function retryDelayMs(windows: readonly number[], attempt: number): number {
  const index = Math.min(attempt - 1, windows.length - 1);
  return windows[index] ?? 1_000;
}

/**
 * Boot-time gate that keeps retrying the database connection and pending migrations, serving a
 * minimal diagnostic page in the meantime, and resolves once both have succeeded so the caller can
 * proceed to a normal application boot. It never throws: an unreachable database is a bounded,
 * recoverable diagnostic state, not a fatal boot error.
 */
export async function ensureDatabaseReady(
  options: DatabaseReadinessOptions,
  deps: DatabaseReadinessDeps,
): Promise<void> {
  const target = parseDatabaseTarget(options.databaseUrl);
  let attempt = 0;
  let diagnostics: DiagnosticsHandle | undefined;
  let latestView: DiagnosticView | undefined;

  try {
    for (;;) {
      try {
        await deps.probe();
        await deps.preMigrate?.();
        await deps.migrate();
        return;
      } catch (error) {
        attempt += 1;
        const errorClass = classifyDatabaseError(error);
        const delayMs = retryDelayMs(options.retryWindowsMs, attempt);
        const checkedAt = new Date(deps.now()).toISOString();
        const nextRetryAt = new Date(deps.now() + delayMs).toISOString();
        latestView = {
          host: target.host,
          port: target.port,
          errorClass,
          label: labelForErrorClass(errorClass),
          hints: hintsForErrorClass(errorClass),
          attempt,
          checkedAt,
          nextRetryAt,
        };
        deps.onAttemptFailed?.(latestView, error);
        diagnostics ??= await deps.startDiagnostics(options.port, () => {
          if (!latestView) throw new Error('Diagnostic view requested before first failure');
          return latestView;
        });
        await deps.sleep(delayMs);
      }
    }
  } finally {
    if (diagnostics) await diagnostics.close();
  }
}
