import type { Permission } from '@coda/contracts';

export interface AccountProfile {
  id: string;
  displayName: string;
  email: string;
  company: string | null;
  department: string | null;
  theme: string;
  fontSize: string;
  motionPreference: string;
  pdfAppearance: string;
}

export interface CredentialProject {
  id: string;
  name: string;
  currentMembership: {
    role: { permissions: Array<{ permission: Permission }> };
  } | null;
}

export interface ApiCredential {
  id: string;
  projectId: string;
  kind: 'API_KEY' | 'MCP_TOKEN';
  name: string;
  tokenPrefix: string;
  tokenLastFour: string;
  permissions: Permission[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  project: { id: string; name: string; deletedAt: string | null };
}

export interface ProfileFields {
  displayName: string;
  email: string;
  company: string;
  department: string;
}

export interface MutationFeedback {
  error: Error | null;
  isPending: boolean;
  isSuccess: boolean;
}
