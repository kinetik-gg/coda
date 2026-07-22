export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  ownerUserId: string;
  updatedAt: string;
  currentMembership?: {
    id: string;
    role: { id: string; name: string; permissions: Array<{ permission: string }> };
  } | null;
}

export interface TrashedProject extends Project {
  deletedAt: string;
  purgeAfter: string;
  canRestore: boolean;
}

export type ProjectsPage = 'overview' | 'deleted';
