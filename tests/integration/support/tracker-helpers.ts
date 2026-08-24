import {
  acceptInvitation,
  api,
  request,
  required,
  tokenFromInvitationUrl,
  uniqueEmail,
  type JsonEnvelope,
  type SessionAuth,
} from './api-client';

/**
 * Tracker-side fixtures for the integration suites: thin wrappers over the tracker API surface
 * (`apps/api/src/trackers`) so every scenario reads as a product action instead of HTTP plumbing.
 * Response views mirror the Prisma selections the controllers return; they stay structural so
 * harmless server-side additions never break the suites.
 */

export type TrackerView = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  version: number;
  revision: number;
  access?: { permissions: string[] };
};

export type TrackerFieldOptionView = { id: string; label: string; color: string | null };

export type TrackerFieldView = {
  id: string;
  name: string;
  key: string;
  type: string;
  required: boolean;
  version: number;
  options: TrackerFieldOptionView[];
};

export type TrackerFieldValueView = {
  fieldId: string;
  textValue: string | null;
  integerValue: number | null;
  floatValue: number | null;
  booleanValue: boolean | null;
  dateValue: string | null;
  storageObjectId: string | null;
  option?: TrackerFieldOptionView | null;
  options?: Array<{ option: TrackerFieldOptionOptionRef }>;
};
type TrackerFieldOptionOptionRef = { id: string; label: string };

export type TrackerRecordView = {
  id: string;
  title: string;
  version: number;
  values: TrackerFieldValueView[];
};

export type TrackerRoleView = { id: string; name: string; isOwner: boolean };
export type TrackerManagementView = {
  roles: TrackerRoleView[];
  memberships: Array<{ id: string; userId: string; roleId: string; version: number }>;
};

/** One row of `GET /api/v1/trackers/:id/activity` (the contract's activity item). */
export type TrackerActivityItem = {
  id: string;
  trackerId: string;
  actorId: string | null;
  action: 'CREATED' | 'UPDATED' | 'DELETED' | 'RESTORED' | 'COMMENTED';
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  projectId?: string | null;
};

export type StoredTrackerLayout = { layout: unknown; revision: number };
export type TrackerLayoutState = {
  personal: StoredTrackerLayout;
  default: StoredTrackerLayout;
  canPublish: boolean;
};

export type TrackerCommentView = {
  id: string;
  body: string;
  version: number;
  editedAt: string | null;
  authorId: string;
  author: { id: string; displayName: string };
};

export function createTracker(
  auth: SessionAuth,
  input: { name: string; description?: string; spaceId?: string },
): Promise<TrackerView> {
  return api<JsonEnvelope<TrackerView>>(
    '/api/v1/trackers',
    201,
    { method: 'POST', body: JSON.stringify(input) },
    auth,
  ).then((result) => result.data);
}

export async function getTracker(auth: SessionAuth, trackerId: string): Promise<TrackerView> {
  return (await api<JsonEnvelope<TrackerView>>(`/api/v1/trackers/${trackerId}`, 200, {}, auth))
    .data;
}

export async function listTrackers(
  auth: SessionAuth,
  spaceId?: string,
): Promise<Array<{ id: string }>> {
  const suffix = spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : '';
  return (
    await api<JsonEnvelope<Array<{ id: string }>>>(`/api/v1/trackers${suffix}`, 200, {}, auth)
  ).data;
}

export function trashTracker(auth: SessionAuth, trackerId: string): Promise<Response> {
  return request(`/api/v1/trackers/${trackerId}`, { method: 'DELETE' }, auth);
}

export function restoreTrackerApi(auth: SessionAuth, trackerId: string): Promise<Response> {
  return request(`/api/v1/trackers/${trackerId}/restore`, { method: 'POST' }, auth);
}

export function purgeTrackerApi(auth: SessionAuth, trackerId: string): Promise<Response> {
  return request(`/api/v1/trackers/${trackerId}/purge`, { method: 'DELETE' }, auth);
}

export async function trackerManagement(
  auth: SessionAuth,
  trackerId: string,
): Promise<TrackerManagementView> {
  return (
    await api<JsonEnvelope<TrackerManagementView>>(
      `/api/v1/trackers/${trackerId}/management`,
      200,
      {},
      auth,
    )
  ).data;
}

export async function trackerRoleByName(
  auth: SessionAuth,
  trackerId: string,
  name: string,
): Promise<TrackerRoleView> {
  const management = await trackerManagement(auth, trackerId);
  return required(
    management.roles.find((role) => role.name === name && !role.isOwner),
    `Tracker has no non-owner ${name} role`,
  );
}

/** Adds an existing account to the tracker under one of its seeded roles. */
export async function addTrackerMember(
  owner: SessionAuth,
  trackerId: string,
  roleName: string,
  member: SessionAuth,
): Promise<void> {
  const [role, session] = await Promise.all([
    trackerRoleByName(owner, trackerId, roleName),
    api<JsonEnvelope<{ id: string }>>('/api/v1/auth/session', 200, {}, member),
  ]);
  await api(
    `/api/v1/trackers/${trackerId}/memberships`,
    201,
    { method: 'POST', body: JSON.stringify({ userId: session.data.id, roleId: role.id }) },
    owner,
  );
}

/**
 * Provisions a brand-new second account directly on the tracker: invite by email through the
 * tracker's own invitation route, then accept as that new user.
 */
export async function provisionTrackerMember(
  owner: SessionAuth,
  trackerId: string,
  roleName: string,
  displayName: string,
): Promise<SessionAuth> {
  const role = await trackerRoleByName(owner, trackerId, roleName);
  const emailPrefix = `${displayName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const invitation = await api<JsonEnvelope<{ invitationUrl: string }>>(
    `/api/v1/trackers/${trackerId}/invitations`,
    201,
    { method: 'POST', body: JSON.stringify({ email: uniqueEmail(emailPrefix), roleId: role.id }) },
    owner,
  );
  const token = tokenFromInvitationUrl(invitation.data.invitationUrl);
  return (await acceptInvitation(token, displayName)).auth;
}

export async function createTrackerField(
  auth: SessionAuth,
  trackerId: string,
  body: {
    name: string;
    key: string;
    type: string;
    required?: boolean;
    options?: Array<{ label: string; color?: string }>;
  },
): Promise<TrackerFieldView> {
  return api<JsonEnvelope<TrackerFieldView>>(
    `/api/v1/trackers/${trackerId}/fields`,
    201,
    { method: 'POST', body: JSON.stringify({ ...body, required: body.required ?? false }) },
    auth,
  ).then((result) => result.data);
}

export async function createTrackerRecord(
  auth: SessionAuth,
  trackerId: string,
  title: string,
): Promise<TrackerRecordView> {
  return api<JsonEnvelope<TrackerRecordView>>(
    `/api/v1/trackers/${trackerId}/records`,
    201,
    { method: 'POST', body: JSON.stringify({ title }) },
    auth,
  ).then((result) => result.data);
}

export async function setTrackerRecordValue(
  auth: SessionAuth,
  trackerId: string,
  recordId: string,
  fieldId: string,
  value: unknown,
  recordVersion: number,
): Promise<TrackerRecordView> {
  return api<JsonEnvelope<TrackerRecordView>>(
    `/api/v1/trackers/${trackerId}/records/${recordId}/fields/${fieldId}`,
    200,
    {
      method: 'PUT',
      body: JSON.stringify({ value, recordVersion }),
    },
    auth,
  ).then((result) => result.data);
}

export interface TrackerRecordsQuery {
  search?: string;
  sort?: string;
  direction?: string;
  limit?: number;
  filters?: unknown;
}

export async function listTrackerRecords(
  auth: SessionAuth,
  trackerId: string,
  query: TrackerRecordsQuery = {},
): Promise<{ data: TrackerRecordView[]; meta: { nextCursor: string | null } }> {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.sort) params.set('sort', query.sort);
  if (query.direction) params.set('direction', query.direction);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.filters !== undefined) params.set('filters', JSON.stringify(query.filters));
  const suffix = params.size ? `?${params.toString()}` : '';
  return api(`/api/v1/trackers/${trackerId}/records${suffix}`, 200, {}, auth);
}

/** Value of one record cell by field id (single-select joins arrive under `option`). */
export function valueOf(record: TrackerRecordView, fieldId: string): TrackerFieldValueView {
  return required(
    record.values.find((value) => value.fieldId === fieldId),
    `Record ${record.id} carries no value for field ${fieldId}`,
  );
}

/**
 * Mints a bearer credential bound to one tracker and returns its id plus the raw token — the
 * only time the token is ever visible. Permissions must be held by the creator (the API
 * enforces the subset rule).
 */
export async function mintTrackerCredential(
  owner: SessionAuth,
  trackerId: string,
  permissions: string[],
  name = 'Integration tracker key',
): Promise<{ id: string; token: string }> {
  const created = await api<JsonEnvelope<{ id: string; token: string }>>(
    '/api/v1/account/credentials',
    201,
    {
      method: 'POST',
      body: JSON.stringify({
        resourceType: 'tracker',
        trackerId,
        name,
        kind: 'api_key',
        permissions,
      }),
    },
    owner,
  );
  return { id: created.data.id, token: created.data.token };
}

export async function bearerRequest(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  return request(path, { ...init, headers });
}
