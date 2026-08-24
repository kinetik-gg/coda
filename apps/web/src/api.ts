import type { ProblemDetails, ResourceType, SpacePermission } from '@coda/contracts';
import { beginApiActivity } from './api-activity';
import type {
  StoredWorkspaceLayout,
  TrackerComment,
  TrackerField,
  TrackerRecord,
  Tracker,
  TrackerSummary,
  TrashedTracker,
} from './trackers/types';
import type {
  AvailableTrackerUser,
  ManagedTracker,
  ManagedTrackerMembership,
  ManagedTrackerRole,
} from './trackers/management/types';
import type { TrackerPermission } from '@coda/contracts';

function csrfToken(): string | undefined {
  const entry = document.cookie.split('; ').find((value) => value.startsWith('coda_csrf='));
  return entry ? decodeURIComponent(entry.slice('coda_csrf='.length)) : undefined;
}

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const csrf = csrfToken();
  if (csrf && !['GET', 'HEAD'].includes(init.method ?? 'GET')) headers.set('x-coda-csrf', csrf);
  const method = (init.method ?? 'GET').toUpperCase();
  const finishActivity = beginApiActivity(
    ['GET', 'HEAD'].includes(method) ? 'loading' : 'updating',
  );
  try {
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    if (!response.ok) throw new ApiError((await response.json()) as ProblemDetails);
    const payload = (await response.json()) as { data: T };
    return payload.data;
  } finally {
    finishActivity();
  }
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export async function apiCursorPage<T>(
  path: string,
  init: RequestInit = {},
): Promise<CursorPage<T>> {
  const headers = new Headers(init.headers);
  const finishActivity = beginApiActivity('loading');
  try {
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    if (!response.ok) throw new ApiError((await response.json()) as ProblemDetails);
    const payload = (await response.json()) as {
      data: T[];
      meta?: { nextCursor?: string | null };
    };
    return { items: payload.data, nextCursor: payload.meta?.nextCursor ?? null };
  } finally {
    finishActivity();
  }
}

export interface SpaceSummary {
  id: string;
  name: string;
  /** Null for a Space reached only through a resource; `id` is null for the Default Space's
   * administrator, whose authority exists without a membership row (#334). */
  currentMembership: {
    id: string | null;
    roleId: string;
    role: { permissions: Array<{ permission: SpacePermission }> };
  } | null;
  resourceCounts: Record<ResourceType, number>;
}

/** The Spaces visible to the signed-in user, including their accessible resource counts. */
export function listSpaces(): Promise<SpaceSummary[]> {
  return api<SpaceSummary[]>('/api/v1/spaces');
}

/** The Space row returned by `POST /spaces`, before the list query refetches. */
export interface CreatedSpace {
  id: string;
  name: string;
}

/**
 * Creates a Space. The API provisions the default role set and enrols the caller as its owner in
 * the same transaction, so the Space comes back already manageable by the person who made it —
 * unlike the seeded Default Space, which holds no memberships at all.
 */
export function createSpace(input: { name: string; description?: string }): Promise<CreatedSpace> {
  return api<CreatedSpace>('/api/v1/spaces', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
    }),
  });
}

// --- Trackers -----------------------------------------------------------------

/** The trackers reachable by the signed-in user, optionally scoped to one Space. */
export function listTrackers(spaceId?: string): Promise<TrackerSummary[]> {
  return spaceId
    ? api<TrackerSummary[]>(`/api/v1/trackers?spaceId=${spaceId}`)
    : api<TrackerSummary[]>('/api/v1/trackers');
}

/** The caller's trashed trackers ("trackers I own that are trashed"), newest deletion first. */
export function listTrashedTrackers(): Promise<TrashedTracker[]> {
  return api<TrashedTracker[]>('/api/v1/trackers/trash');
}

/** Creates a tracker in the caller's Default Space; a name is its only required content. */
export function createTracker(input: { name: string }): Promise<TrackerSummary> {
  return api<TrackerSummary>('/api/v1/trackers', {
    method: 'POST',
    body: JSON.stringify({ name: input.name }),
  });
}

/** Reads one tracker with the caller's resolved access. */
export function getTracker(trackerId: string, signal?: AbortSignal): Promise<Tracker> {
  return api<Tracker>(`/api/v1/trackers/${trackerId}`, signal ? { signal } : {});
}

/** Renames a tracker; `version` keeps the write optimistic. */
export function renameTracker(input: {
  trackerId: string;
  name: string;
  version: number;
}): Promise<TrackerSummary> {
  const { trackerId, ...body } = input;
  return api<TrackerSummary>(`/api/v1/trackers/${trackerId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Moves a tracker to trash; it stays restorable for the retention window. */
export function trashTracker(trackerId: string): Promise<unknown> {
  return api(`/api/v1/trackers/${trackerId}`, { method: 'DELETE' });
}

/** Restores a trashed tracker owned by the caller. */
export function restoreTracker(trackerId: string): Promise<unknown> {
  return api(`/api/v1/trackers/${trackerId}/restore`, { method: 'POST' });
}

/** Permanently deletes a trashed tracker and everything it holds. */
export function purgeTracker(trackerId: string): Promise<unknown> {
  return api(`/api/v1/trackers/${trackerId}/purge`, { method: 'DELETE' });
}

// --- Tracker sharing (#381) -----------------------------------------------------

/** The management payload: roles, memberships, pending invitations, and the caller's grants. */
export function getTrackerManagement(trackerId: string): Promise<ManagedTracker> {
  return api<ManagedTracker>(`/api/v1/trackers/${trackerId}/management`);
}

/** Registered users who hold no membership in this tracker yet, for the add-member picker. */
export function listTrackerAvailableUsers(trackerId: string): Promise<AvailableTrackerUser[]> {
  return api<AvailableTrackerUser[]>(`/api/v1/trackers/${trackerId}/available-users`);
}

/** Adds a registered user under an assignable role; the subset rule bounds the caller. */
export function addTrackerMember(input: {
  trackerId: string;
  userId: string;
  roleId: string;
}): Promise<ManagedTrackerMembership> {
  const { trackerId, ...body } = input;
  return api<ManagedTrackerMembership>(`/api/v1/trackers/${trackerId}/memberships`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Moves one member to another role; `version` keeps the write optimistic. */
export function changeTrackerMemberRole(input: {
  trackerId: string;
  membershipId: string;
  roleId: string;
  version: number;
}): Promise<ManagedTrackerMembership> {
  const { trackerId, membershipId, ...body } = input;
  return api<ManagedTrackerMembership>(`/api/v1/trackers/${trackerId}/memberships/${membershipId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Removes one member (never the owner); `version` keeps the write optimistic. */
export function removeTrackerMember(input: {
  trackerId: string;
  membershipId: string;
  version: number;
}): Promise<{ id: string }> {
  const { trackerId, membershipId, ...body } = input;
  return api<{ id: string }>(`/api/v1/trackers/${trackerId}/memberships/${membershipId}`, {
    method: 'DELETE',
    body: JSON.stringify(body),
  });
}

/** The invitation the API issued, with the acceptance URL to hand to the invitee. */
export interface TrackerInvitationCreated {
  id: string;
  expiresAt: string;
  invitationUrl: string;
}

/** Invites someone by email; the subset rule bounds the granted role. */
export function inviteTrackerMember(input: {
  trackerId: string;
  email: string;
  roleId: string;
}): Promise<TrackerInvitationCreated> {
  const { trackerId, ...body } = input;
  return api<TrackerInvitationCreated>(`/api/v1/trackers/${trackerId}/invitations`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Revokes a pending invitation so its link stops working. */
export function revokeTrackerInvitation(input: {
  trackerId: string;
  invitationId: string;
}): Promise<{ id: string }> {
  const { trackerId, invitationId } = input;
  return api<{ id: string }>(`/api/v1/trackers/${trackerId}/invitations/${invitationId}`, {
    method: 'DELETE',
  });
}

/** Creates a custom role; permissions must be a non-empty subset of the caller's own. */
export function createTrackerRole(input: {
  trackerId: string;
  name: string;
  description?: string | null;
  permissions: TrackerPermission[];
}): Promise<ManagedTrackerRole> {
  const { trackerId, ...body } = input;
  return api<ManagedTrackerRole>(`/api/v1/trackers/${trackerId}/roles`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Patches a custom role's name, description, or permission set against an expected version. */
export function updateTrackerRole(input: {
  trackerId: string;
  roleId: string;
  name?: string;
  description?: string | null;
  permissions?: TrackerPermission[];
  version: number;
}): Promise<ManagedTrackerRole> {
  const { trackerId, roleId, ...body } = input;
  return api<ManagedTrackerRole>(`/api/v1/trackers/${trackerId}/roles/${roleId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Archives an empty custom role. The API refuses while members or pending invitations still
 * reference it, and the 409 detail is what the surface shows.
 */
export function archiveTrackerRole(input: {
  trackerId: string;
  roleId: string;
  version: number;
}): Promise<{ id: string }> {
  const { trackerId, roleId, ...body } = input;
  return api<{ id: string }>(`/api/v1/trackers/${trackerId}/roles/${roleId}`, {
    method: 'DELETE',
    body: JSON.stringify(body),
  });
}

/** Hands ownership to another member; the previous owner is demoted before the target promoted. */
export function transferTrackerOwnership(input: {
  trackerId: string;
  newOwnerMembershipId: string;
  version: number;
}): Promise<unknown> {
  const { trackerId, ...body } = input;
  return api(`/api/v1/trackers/${trackerId}/transfer-ownership`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// --- Tracker workspace (#379) ---------------------------------------------------

/** The saved personal/default layout tiers for one tracker, plus the caller's publish authority. */
export interface TrackerLayoutResponse {
  personal: StoredWorkspaceLayout & { layout: unknown };
  default: StoredWorkspaceLayout;
  canPublish: boolean;
}

/** The active field definitions of one tracker, in manual field order. */
export function listTrackerFields(
  trackerId: string,
  signal?: AbortSignal,
): Promise<TrackerField[]> {
  return api<TrackerField[]>(`/api/v1/trackers/${trackerId}/fields`, signal ? { signal } : {});
}

export interface TrackerRecordListQuery {
  cursor?: string;
  limit?: number;
  sort?: 'manual' | 'title' | 'created_at' | 'updated_at';
  direction?: 'asc' | 'desc';
  search?: string;
  filters?: unknown[];
}

function trackerRecordsPath(trackerId: string, query: TrackerRecordListQuery): string {
  const params = new URLSearchParams({
    limit: String(query.limit ?? 100),
    sort: query.sort ?? 'manual',
    direction: query.direction ?? 'asc',
  });
  if (query.search) params.set('search', query.search);
  if (query.filters?.length) params.set('filters', JSON.stringify(query.filters));
  if (query.cursor) params.set('cursor', query.cursor);
  return `/api/v1/trackers/${trackerId}/records?${params.toString()}`;
}

/** One cursor page of the record grid; `nextCursor` is null after the last page. */
export function listTrackerRecords(
  trackerId: string,
  query: TrackerRecordListQuery = {},
  signal?: AbortSignal,
): Promise<CursorPage<TrackerRecord>> {
  return apiCursorPage(trackerRecordsPath(trackerId, query), signal ? { signal } : {});
}

/** Creates a record; `beforeId`/`afterId` slot it into the manual order. */
export function createTrackerRecord(input: {
  trackerId: string;
  title: string;
  beforeId?: string;
  afterId?: string;
}): Promise<TrackerRecord> {
  const { trackerId, ...body } = input;
  return api<TrackerRecord>(`/api/v1/trackers/${trackerId}/records`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Patches a record's title and/or position against an expected record version. */
export function updateTrackerRecord(input: {
  trackerId: string;
  recordId: string;
  title?: string;
  beforeId?: string | null;
  afterId?: string | null;
  version: number;
}): Promise<TrackerRecord> {
  const { trackerId, recordId, ...body } = input;
  return api<TrackerRecord>(`/api/v1/trackers/${trackerId}/records/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Writes one typed cell value; bumps the owning record's version on success. */
export function setTrackerRecordFieldValue(input: {
  trackerId: string;
  recordId: string;
  fieldId: string;
  value: unknown;
  recordVersion: number;
}): Promise<TrackerRecord> {
  const { trackerId, recordId, fieldId, value, recordVersion } = input;
  return api<TrackerRecord>(
    `/api/v1/trackers/${trackerId}/records/${recordId}/fields/${fieldId}`,
    { method: 'PUT', body: JSON.stringify({ value, recordVersion }) },
  );
}

/** Soft-deletes records into trash; returns the ids actually deleted plus the deletion batch id. */
export function deleteTrackerRecords(input: {
  trackerId: string;
  ids: string[];
}): Promise<{ deletedIds: string[]; deletionBatchId: string }> {
  const { trackerId, ids } = input;
  return api(`/api/v1/trackers/${trackerId}/records/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

/** The newest tracker activity events with actor display names attached. */
export function listTrackerActivity(
  trackerId: string,
  signal?: AbortSignal,
): Promise<unknown[]> {
  return api(`/api/v1/trackers/${trackerId}/activity`, signal ? { signal } : {});
}

// --- Tracker record comments (#383) ------------------------------------------------

export interface TrackerCommentListQuery {
  cursor?: string;
  limit?: number;
}

function trackerCommentsPath(trackerId: string, recordId: string): string {
  return `/api/v1/trackers/${trackerId}/records/${recordId}/comments`;
}

/** One cursor page of a record's comments, oldest first; `nextCursor` is null after the last page. */
export function listTrackerRecordComments(
  trackerId: string,
  recordId: string,
  query: TrackerCommentListQuery = {},
  signal?: AbortSignal,
): Promise<CursorPage<TrackerComment>> {
  const params = new URLSearchParams({ limit: String(query.limit ?? 100) });
  if (query.cursor) params.set('cursor', query.cursor);
  return apiCursorPage(`${trackerCommentsPath(trackerId, recordId)}?${params}`, signal ? { signal } : {});
}

/** Posts a comment on one record; the API answers the stored comment with its author attached. */
export function createTrackerRecordComment(input: {
  trackerId: string;
  recordId: string;
  body: string;
}): Promise<TrackerComment> {
  const { trackerId, recordId, ...body } = input;
  return api<TrackerComment>(trackerCommentsPath(trackerId, recordId), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Edits the caller's own comment against an expected `version`; a stale one answers `409` and
 * someone else's comment `403`.
 */
export function updateTrackerRecordComment(input: {
  trackerId: string;
  recordId: string;
  commentId: string;
  body: string;
  version: number;
}): Promise<TrackerComment> {
  const { trackerId, recordId, commentId, ...body } = input;
  return api<TrackerComment>(
    `${trackerCommentsPath(trackerId, recordId)}/${commentId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

/** Soft-deletes the caller's own comment; reports `{ id, deletedAt }`. */
export function deleteTrackerRecordComment(input: {
  trackerId: string;
  recordId: string;
  commentId: string;
}): Promise<{ id: string }> {
  const { trackerId, recordId, commentId } = input;
  return api<{ id: string }>(`${trackerCommentsPath(trackerId, recordId)}/${commentId}`, {
    method: 'DELETE',
  });
}

/** An upload target the API issued, with the capability that decides how to send it. */
export interface UploadTarget {
  uploadUrl: string;
  /**
   * True when the backend can receive the bytes directly (an S3 presigned PUT);
   * false when the upload is proxied through the app. The client selects the
   * path from this flag instead of assuming presigned S3.
   */
  directUpload: boolean;
}

/**
 * Transfers `file` to the URL the API issued, choosing the path from the
 * advertised {@link UploadTarget.directUpload} capability rather than assuming an
 * S3 presigned PUT.
 */
export async function uploadFile(target: UploadTarget, file: File): Promise<void> {
  if (target.directUpload) {
    await uploadToSignedUrl(target.uploadUrl, file);
    return;
  }
  await uploadProxied(target.uploadUrl, file);
}

/** Direct upload to a presigned object-store URL (conditional create via If-None-Match). */
export async function uploadToSignedUrl(url: string, file: File): Promise<void> {
  const finishActivity = beginApiActivity('updating');
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': file.type, 'if-none-match': '*' },
      body: file,
    });
    if (!response.ok) throw new Error('The object store rejected the upload.');
  } finally {
    finishActivity();
  }
}

/** App-proxied upload; the same-origin API enforces the size/type/conditional-create checks. */
async function uploadProxied(url: string, file: File): Promise<void> {
  const finishActivity = beginApiActivity('updating');
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error('The upload was rejected.');
  } finally {
    finishActivity();
  }
}

// --- Tracker media uploads (#382) ----------------------------------------------

/**
 * The reservation POST `/api/v1/trackers/:trackerId/uploads` returns: the storage-object row it
 * created plus the capability-negotiated transfer target (`uploadUrl`/`directUpload`), mirroring
 * the project upload family.
 */
export interface TrackerUploadTarget {
  id: string;
  version: number;
  status: string;
  uploadUrl: string;
  directUpload: boolean;
}

/** The READY storage object POST `…/uploads/:id/complete` returns once the bytes verified. */
export interface TrackerStorageObject {
  id: string;
  kind: string;
  status: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

/** Reserves a tracker-owned upload; `kind` must match the target field's type vocabulary. */
export function createTrackerUpload(input: {
  trackerId: string;
  kind: 'file' | 'image' | 'video';
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<TrackerUploadTarget> {
  const { trackerId, ...body } = input;
  return api<TrackerUploadTarget>(`/api/v1/trackers/${trackerId}/uploads`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Marks a transferred upload READY; rejects when the stored bytes contradict the reservation. */
export function completeTrackerUpload(input: {
  trackerId: string;
  uploadId: string;
  version: number;
}): Promise<TrackerStorageObject> {
  const { trackerId, uploadId, ...body } = input;
  return api<TrackerStorageObject>(
    `/api/v1/trackers/${trackerId}/uploads/${uploadId}/complete`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** A short-lived read URL for one tracker-owned storage object. */
export function getTrackerStorageObjectContent(
  trackerId: string,
  objectId: string,
  signal?: AbortSignal,
): Promise<{ url: string }> {
  return api<{ url: string }>(
    `/api/v1/trackers/${trackerId}/storage-objects/${objectId}/content`,
    signal ? { signal } : {},
  );
}

export interface TransferOptions {
  /** Upload progress as a 0..1 fraction of total bytes. */
  onProgress?: (fraction: number) => void;
  /** Aborting the signal cancels the in-flight transfer. */
  signal?: AbortSignal;
}

/**
 * XHR-based counterpart of {@link uploadFile} for flows that need byte-level progress and
 * mid-flight cancellation; the request shape matches per {@link UploadTarget.directUpload}.
 */
export function uploadFileWithProgress(
  target: UploadTarget,
  file: File,
  options: TransferOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', target.uploadUrl);
    request.setRequestHeader('content-type', file.type);
    if (target.directUpload) request.setRequestHeader('if-none-match', '*');
    const finishActivity = beginApiActivity('updating');
    const fail = (message: string) => {
      finishActivity();
      reject(new Error(message));
    };
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        finishActivity();
        resolve();
        return;
      }
      fail(target.directUpload ? 'The object store rejected the upload.' : 'The upload was rejected.');
    };
    request.onerror = () => fail('The upload could not be sent.');
    request.onabort = () => fail('The upload was cancelled.');
    options.signal?.addEventListener('abort', () => request.abort(), { once: true });
    request.send(file);
  });
}
