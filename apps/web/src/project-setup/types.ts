import type { ProjectTemplateId, WorkspaceLayout } from '@coda/contracts';

export interface EntityType {
  id: string;
  level: number;
  singularName: string;
  pluralName: string;
  version: number;
}

export interface Project {
  id: string;
  name: string;
  entityTypes: EntityType[];
  roles: Array<{ id: string; name: string; isOwner: boolean }>;
  memberships: Array<{ user: { id: string } }>;
  sourceDocuments: Array<{ id: string }>;
}

export interface LayoutState {
  personal: { layout: WorkspaceLayout; revision: number };
  default: { revision: number };
}

export interface CreationOptions {
  users: Array<{ id: string; email: string; displayName: string }>;
  roles: Array<{ name: string }>;
  templates: Array<{
    id: ProjectTemplateId;
    name: string;
    description: string;
    levels: Array<{ singularName: string; pluralName: string }>;
  }>;
}

export interface PendingSetup {
  projectId?: string;
  upload?: {
    id: string;
    version: number;
    uploadUrl: string;
    directUpload: boolean;
    transferred: boolean;
    completed: boolean;
  };
}

export interface EntityLevelName {
  singular: string;
  plural: string;
}

export type StepId = 'details' | 'entities' | 'source' | 'member' | 'summary';
