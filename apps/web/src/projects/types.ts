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

/**
 * A trashed screenplay as returned by `GET /api/v1/screenplays/trash` (the
 * parity lifecycle landed in #148). Screenplays are owner-scoped, so
 * `canRestore` is always true for the lister.
 */
export interface TrashedScreenplay {
  id: string;
  ownerUserId: string;
  title: string;
  filename: string;
  deletedAt: string;
  purgeAfter: string;
  canRestore: boolean;
}

export type TrashKind = 'breakdown' | 'screenplay';

/** A unified Trash row spanning breakdowns and screenplays. */
export interface TrashEntry {
  id: string;
  kind: TrashKind;
  name: string;
  deletedAt: string;
  purgeAfter: string;
  canRestore: boolean;
}

export type ProjectsPage = 'overview' | 'deleted';
