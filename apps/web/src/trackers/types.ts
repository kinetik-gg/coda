import type { TrackerPermission } from '@coda/contracts';

/**
 * A tracker row as the library list and every mutation response carries it: the tracker columns
 * only, no records or fields. Dates arrive ISO-serialized.
 */
export interface TrackerSummary {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  version: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The full tracker read (`GET /api/v1/trackers/:id`). `access` carries the caller's resolved role
 * permissions so a workspace can render permission-aware states without a management call;
 * optional so older cache entries degrade gracefully.
 */
export interface Tracker extends TrackerSummary {
  access?: { permissions: TrackerPermission[] };
}

/**
 * A trashed tracker as returned by `GET /api/v1/trackers/trash`. The listing is owner-scoped
 * ("trackers I own that are trashed"), so restore is always available to the lister.
 */
export interface TrashedTracker extends TrackerSummary {
  deletedAt: string;
  purgeAfter: string;
  canRestore: boolean;
  canPurge: boolean;
}

// --- Record grid -------------------------------------------------------------

/** One option of an enum/multi-enum field, as the fields list and record values carry it. */
export interface TrackerFieldOption {
  id: string;
  label: string;
  color?: string | null;
}

/**
 * A tracker field definition (`GET /api/v1/trackers/:id/fields`). Structurally identical to the
 * breakdown `FieldDefinition`, so the shared inline editors accept it unchanged.
 */
export interface TrackerField {
  id: string;
  name: string;
  key: string;
  type: string;
  required: boolean;
  version: number;
  options: TrackerFieldOption[];
}

/** One field value of a record, mirroring the breakdown value shape (option joins included). */
export interface TrackerFieldValue {
  fieldId: string;
  textValue: unknown;
  integerValue: number | null;
  floatValue: number | null;
  booleanValue: boolean | null;
  dateValue: string | null;
  option?: TrackerFieldOption | null;
  options: Array<{ option: TrackerFieldOption }>;
  storageObjectId?: string | null;
}

/** A record row of the grid (`GET /api/v1/trackers/:id/records`). Dates arrive ISO-serialized. */
export interface TrackerRecord {
  id: string;
  trackerId: string;
  title: string;
  position: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  values: TrackerFieldValue[];
}

/**
 * A saved workspace-layout tier (`GET …/workspace-layout`), shared by the breakdown and tracker
 * layout endpoints.
 */
export interface StoredWorkspaceLayout {
  layout: unknown;
  revision: number;
}

// --- Record comments -----------------------------------------------------------

/** The signed-in identity the workspace threads down for author-owned comment affordances. */
export interface TrackerCurrentUser {
  id: string;
  displayName: string;
}

export interface TrackerCommentAuthor {
  id: string;
  displayName: string;
}

/**
 * One flat record comment (`GET /api/v1/trackers/:id/records/:recordId/comments`). Dates arrive
 * ISO-serialized; `editedAt` stays null until the author's first edit.
 */
export interface TrackerComment {
  id: string;
  recordId: string;
  authorId: string;
  body: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  author: TrackerCommentAuthor;
}
