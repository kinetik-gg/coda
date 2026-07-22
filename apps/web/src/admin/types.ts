export type AdminPage =
  'overview' | 'projects' | 'users' | 'storage' | 'jobs' | 'audit' | 'invitations';

export type ByteValue = number | string;

export interface MetricSample {
  sampledAt: string;
  cpuPercent: number;
  memoryPercent: number;
  processRssBytes: ByteValue;
  processHeapUsedBytes: ByteValue;
}

export interface InstanceUser {
  id: string;
  displayName: string;
  email: string;
  company: string | null;
  department: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count: { memberships: number; sessions: number; ownedProjects: number };
}

export interface InstanceProject {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  owner: { id: string; displayName: string; email: string };
  _count: { memberships: number; items: number; storageObjects: number; sourceDocuments: number };
}

export interface StorageItem {
  id: string;
  kind: string;
  status: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: ByteValue;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdAt: string;
  deletedAt: string | null;
  project: { id: string; name: string; deletedAt: string | null };
}

export interface ActivityEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: unknown;
  createdAt: string;
  project: { id: string; name: string; deletedAt: string | null };
  actor: { id: string; displayName: string } | null;
}

export interface InstanceJob {
  id: string;
  name: string;
  state: 'running' | 'degraded' | 'idle';
  intervalSeconds: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastSucceededAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  lastPurgedProjects: number;
  nextRunAt: string | null;
}

export interface InstanceInvitation {
  id: string;
  email: string | null;
  isReusable: boolean;
  redemptionCount: number;
  status: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  inviter: { id: string; displayName: string };
  acceptedBy: { id: string; displayName: string } | null;
  project: { id: string; name: string } | null;
  role: { id: string; name: string } | null;
}

export type InvitationExpiry = 'never' | '30_days' | '7_days' | '24_hours';
export type InvitationKind = 'email' | 'bulk';
export type InvitationMembership = 'none' | 'project';

export interface InvitationOptions {
  delivery: 'manual_link';
  defaultExpiry: 'never';
  expiryChoices: Array<{ id: InvitationExpiry; label: string }>;
  projects: Array<{
    id: string;
    name: string;
    roles: Array<{ id: string; name: string }>;
  }>;
}

export interface CreatedInvitation {
  email: string | null;
  isReusable: boolean;
  url: string;
  expiresAt: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type ManagementListItem =
  InstanceProject | InstanceUser | StorageItem | ActivityEntry | InstanceInvitation;

export interface InstanceManagementSummary {
  initializedAt: string;
  retentionDays: number;
  owner: { id: string; displayName: string; email: string };
  counts: {
    users: number;
    activeUsers: number;
    disabledUsers: number;
    activeProjects: number;
    trashedProjects: number;
    activeSessions: number;
    storageObjects: number;
    storageBytes: ByteValue;
    trashedStorageObjects: number;
    trashedStorageBytes: ByteValue;
    pendingInvitations: number;
    jobs: number;
  };
  system: {
    sampledAt: string;
    runtime: {
      state: 'running';
      nodeVersion: string;
      processUptimeSeconds: number;
      eventLoopUtilizationPercent: number;
      memory: {
        rssBytes: ByteValue;
        heapUsedBytes: ByteValue;
        heapTotalBytes: ByteValue;
        externalBytes: ByteValue;
      };
    };
    operatingSystem: {
      platform: string;
      release: string;
      architecture: string;
      uptimeSeconds: number;
    };
    cpu: {
      usagePercent: number;
      logicalCores: number;
      model: string;
      loadAverage: { oneMinute: number; fiveMinutes: number; fifteenMinutes: number };
    };
    memory: {
      totalBytes: ByteValue;
      usedBytes: ByteValue;
      freeBytes: ByteValue;
      usagePercent: number;
    };
    disk:
      | {
          available: true;
          totalBytes: ByteValue;
          usedBytes: ByteValue;
          freeBytes: ByteValue;
          usagePercent: number;
        }
      | { available: false };
    history: MetricSample[];
  };
  jobs: InstanceJob[];
  users: InstanceUser[];
  projects: InstanceProject[];
  storageItems: StorageItem[];
  activities: ActivityEntry[];
}
