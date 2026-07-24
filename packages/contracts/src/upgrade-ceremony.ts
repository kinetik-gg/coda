import { z } from 'zod';

// --- Upgrade ceremony --------------------------------------------------------
// The opt-in, owner-driven upgrade flow layered over the release checker: a
// backup gate, then either the generic tier (show the target image reference and
// optionally fire a redeploy webhook after the operator confirms they updated the
// platform env) or the optional Coolify adapter (update CODA_IMAGE and trigger a
// deployment in one click). Secrets (webhook URL, Coolify token) are persisted
// encrypted by the API's config store and are never echoed back to the browser.

/** A deploy target URL. Kept liberal (http or https) so self-hosted platforms on a private network work. */
const deployUrlSchema = z.string().trim().url().max(2_048);

/** Operator-supplied redeploy webhook. Fired only after explicit env-update confirmation. */
export const redeployWebhookInputSchema = z.object({
  url: deployUrlSchema,
});
export type RedeployWebhookInput = z.infer<typeof redeployWebhookInputSchema>;

/**
 * Coolify adapter credentials. The API base URL and application UUID are not
 * secret and may be surfaced back for display; the API token is write-only and
 * never returned once saved.
 */
export const coolifyConfigInputSchema = z.object({
  baseUrl: deployUrlSchema,
  apiToken: z.string().trim().min(1).max(512),
  applicationUuid: z.string().trim().min(1).max(128),
});
export type CoolifyConfigInput = z.infer<typeof coolifyConfigInputSchema>;

/**
 * The generic-tier redeploy request. The operator must explicitly confirm they
 * updated the platform's CODA_IMAGE env before the webhook is allowed to fire.
 */
export const triggerRedeploySchema = z.object({
  confirmedEnvUpdated: z.literal(true),
});
export type TriggerRedeploy = z.infer<typeof triggerRedeploySchema>;

export const upgradeCeremonyOutcomeSchema = z.enum(['SUCCESS', 'FAILURE']);
export type UpgradeCeremonyOutcome = z.infer<typeof upgradeCeremonyOutcomeSchema>;

/** Which tier carried out (or attempted) the upgrade. */
export const upgradeCeremonyTierSchema = z.enum(['backup', 'generic', 'coolify']);
export type UpgradeCeremonyTier = z.infer<typeof upgradeCeremonyTierSchema>;

/** One recorded ceremony step: a backup gate, a generic redeploy, or a Coolify deploy. */
export interface UpgradeHistoryEntry {
  id: string;
  tier: UpgradeCeremonyTier;
  fromVersion: string;
  toVersion: string;
  /** Object-storage key of the fresh backup taken for this upgrade, when one exists. */
  backupRef: string | null;
  outcome: UpgradeCeremonyOutcome;
  at: string;
  error: string | null;
}

/**
 * Where the ceremony is right now. Server-computed from the release-checker
 * target, whether the encryption key is present, and whether a fresh pending
 * backup exists:
 * - `unavailable`      no newer release is known; nothing to do.
 * - `needs_encryption_key` an update exists but CONFIG_ENCRYPTION_KEY is unset,
 *   so the backup gate cannot run. Managed upgrades require the key.
 * - `ready_to_backup`  an update is available and the key is present; the next
 *   step is the mandatory backup.
 * - `ready_to_deploy`  a fresh backup for the current target exists; the deploy
 *   actions (generic and/or Coolify) are unlocked.
 */
export const upgradeCeremonyPhaseSchema = z.enum([
  'unavailable',
  'needs_encryption_key',
  'ready_to_backup',
  'ready_to_deploy',
]);
export type UpgradeCeremonyPhase = z.infer<typeof upgradeCeremonyPhaseSchema>;

/** The resolved image reference for the target release. */
export interface UpgradeTarget {
  version: string;
  /** The image repository, e.g. `ghcr.io/kinetik-gg/coda`. */
  image: string;
  /** The immutable digest, e.g. `sha256:…`. */
  digest: string;
  /** Convenience: the version-tagged reference, `image:version`. */
  taggedRef: string;
  /** Convenience: the digest-pinned reference, `image@digest`. */
  digestRef: string;
}

/** Non-secret view of the configured Coolify adapter. The token is never included. */
export interface CoolifyConfigView {
  configured: boolean;
  baseUrl: string | null;
  applicationUuid: string | null;
}

/** The fresh backup captured for the current in-flight upgrade, if any. */
export interface UpgradePendingBackup {
  backupRef: string;
  takenAt: string;
  toVersion: string;
}

/** Everything the Updates section's ceremony panel renders in one read. */
export interface UpgradeCeremonyView {
  phase: UpgradeCeremonyPhase;
  currentVersion: string;
  target: UpgradeTarget | null;
  pendingBackup: UpgradePendingBackup | null;
  redeployWebhookConfigured: boolean;
  coolify: CoolifyConfigView;
  history: UpgradeHistoryEntry[];
  /** Set when the most recent Coolify attempt failed; the generic tier remains available. */
  lastCoolifyError: string | null;
}
