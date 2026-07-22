import type { FieldType, Permission } from '@coda/contracts';

export type SectionId = 'overview' | 'entities' | 'danger';

export interface ManagedEntityType {
  id: string;
  singularName: string;
  pluralName: string;
  displayPrefix?: string | null;
  level: number;
  version: number;
  _count?: { items: number };
  fields?: Array<{ id: string; name: string; type: string; required: boolean }>;
}

export interface ManagedFieldDefinition {
  id: string;
  entityTypeId: string;
  name: string;
  key: string;
  type: string;
  required: boolean;
  version: number;
  options: Array<{ id: string; label: string; color?: string | null }>;
  configuration?: Record<string, unknown>;
}

export interface ManagedRole {
  id: string;
  name: string;
  description?: string | null;
  isOwner?: boolean;
  version?: number;
  permissions?: Array<{ permission: Permission }>;
  _count?: { memberships: number };
}

export interface ManagedMembership {
  id: string;
  version: number;
  user: { id: string; displayName: string; email: string };
  role: ManagedRole;
}

export interface ManagedProject {
  id: string;
  name: string;
  description: string | null;
  ownerUserId: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
  entityTypes: ManagedEntityType[];
  roles: ManagedRole[];
  memberships: ManagedMembership[];
  currentMembership?: { id: string; roleId: string; permissions: Permission[] };
  _count?: { items: number; sourceDocuments: number; storageObjects: number };
}

export interface AvailableUser {
  id: string;
  displayName: string;
  email: string;
  status?: string;
}

export interface ProjectImportResult {
  project: { id: string; name: string };
  counts: { entityTypes: number; fields: number; options: number; items: number; values: number };
  warnings: string[];
}

export interface FieldEditorValue {
  name: string;
  key: string;
  type: FieldType;
  required: boolean;
  options: Array<{ id?: string; label: string; color?: string | null }>;
}
