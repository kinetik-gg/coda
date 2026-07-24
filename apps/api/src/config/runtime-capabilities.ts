import { z } from 'zod';

/**
 * Runtime profiles and their capability map (issue #78, informed by the #73 spike).
 *
 * The spike proved the server/desktop divergences are INDEPENDENT toggles, not a single binary
 * mode. This module is the ONE place allowed to read `RUNTIME_PROFILE` or mention a profile name:
 * every feature reads a named capability key instead, so no code branches on the profile directly
 * (the acceptance criterion). `scripts/check-runtime-profile-portability.ts` fails the build if
 * `RUNTIME_PROFILE` or a profile-name literal leaks into any other production source file.
 *
 * The `server` preset MUST reproduce today's behavior bit-for-bit; the integration and e2e suites
 * (which run under the default profile) are the proof. `desktop` is a local single-user preset for
 * the Electron shell: it auto-initializes a local owner instead of the setup-token ceremony,
 * disables the update poller (the shell owns updates), runs the scheduler single-process, trusts
 * only loopback, and degrades realtime fan-out to the single local user.
 */

export const RUNTIME_PROFILES = ['server', 'desktop'] as const;

export type RuntimeProfile = (typeof RUNTIME_PROFILES)[number];

/**
 * The independent capability keys measured by the #73 spike. Each is its own small, typed toggle
 * so a preset is just a set of choices over these keys — never a boolean the code re-derives.
 */
export interface RuntimeCapabilities {
  /** First-run owner gating: the setup-token ceremony, or an auto-initialized local owner. */
  readonly setupTokenBootstrap: 'token-ceremony' | 'local-owner';
  /** Boot DB-readiness/migration retry: serve the diagnostic web page, or retry quietly. */
  readonly databaseReadinessProbe: 'diagnostic-retry' | 'quiet-retry';
  /** Non-API dev redirect to APP_ORIGIN: follow NODE_ENV as today, or never redirect. */
  readonly devRedirect: 'follow-node-env' | 'disabled';
  /** Background release-update polling: run per UPDATE_CHECK_INTERVAL_HOURS, or never poll. */
  readonly updatePoller: 'enabled' | 'disabled';
  /** Cross-replica scheduler coordination: Postgres advisory lock, or single-process. */
  readonly schedulerCoordination: 'advisory-lock' | 'single-process';
  /** X-Forwarded-For trust model: the configured/auto CIDRs, or loopback only. */
  readonly trustedProxyHandling: 'configured' | 'loopback-only';
  /** Realtime invalidation fan-out: multi-user membership re-check, or single-user delivery. */
  readonly realtimeFanout: 'multi-user' | 'single-user';
}

const CAPABILITY_PRESETS: Record<RuntimeProfile, RuntimeCapabilities> = {
  server: {
    setupTokenBootstrap: 'token-ceremony',
    databaseReadinessProbe: 'diagnostic-retry',
    devRedirect: 'follow-node-env',
    updatePoller: 'enabled',
    schedulerCoordination: 'advisory-lock',
    trustedProxyHandling: 'configured',
    realtimeFanout: 'multi-user',
  },
  desktop: {
    setupTokenBootstrap: 'local-owner',
    databaseReadinessProbe: 'quiet-retry',
    devRedirect: 'disabled',
    updatePoller: 'disabled',
    schedulerCoordination: 'single-process',
    trustedProxyHandling: 'loopback-only',
    realtimeFanout: 'single-user',
  },
};

const profileSchema = z.enum(RUNTIME_PROFILES).default('server');

function readProfile(source: NodeJS.ProcessEnv): RuntimeProfile {
  const raw = source.RUNTIME_PROFILE;
  // An empty string is treated as unset so a blank env entry falls back to the server default.
  const candidate = typeof raw === 'string' && raw.trim() === '' ? undefined : raw;
  const result = profileSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `RUNTIME_PROFILE must be one of ${RUNTIME_PROFILES.join(', ')} (received ${JSON.stringify(
        raw,
      )})`,
    );
  }
  return result.data;
}

let cached: RuntimeCapabilities | undefined;

/** Resolve the capability map for an explicit environment; used by tests and by the cached accessor. */
export function resolveRuntimeCapabilities(source: NodeJS.ProcessEnv): RuntimeCapabilities {
  return CAPABILITY_PRESETS[readProfile(source)];
}

/** The active capability map, cached like {@link env}. Reads `RUNTIME_PROFILE` once at first use. */
export function runtimeCapabilities(): RuntimeCapabilities {
  cached ??= resolveRuntimeCapabilities(process.env);
  return cached;
}

/** Test-only: clears the cache so a later {@link runtimeCapabilities} call re-reads the environment. */
export function resetRuntimeCapabilitiesCache(): void {
  cached = undefined;
}
