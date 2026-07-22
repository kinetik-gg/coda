import type { WorkspacePanel } from '@coda/contracts';

export interface EntityType {
  id: string;
  singularName: string;
  pluralName: string;
  level: number;
  version: number;
  _count?: { items: number };
}

export interface Role {
  id: string;
  name: string;
  isOwner?: boolean;
}

export interface SourceDocument {
  id: string;
  title: string;
  pageCount: number | null;
  storageObject: { id: string; originalFilename: string };
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  ownerUserId: string;
  version: number;
  revision: number;
  entityTypes: EntityType[];
  roles: Role[];
  sourceDocuments: SourceDocument[];
  memberships: Array<{
    id: string;
    user: { id: string; displayName: string; email: string };
    role: Role;
  }>;
}

export interface FieldOption {
  id: string;
  label: string;
  color?: string | null;
}
export interface FieldDefinition {
  id: string;
  name: string;
  key: string;
  type: string;
  required: boolean;
  version: number;
  options: FieldOption[];
  configuration?: Record<string, unknown>;
}

export interface FieldValue {
  fieldId: string;
  textValue: unknown;
  integerValue: number | null;
  floatValue: number | null;
  booleanValue: boolean | null;
  dateValue: string | null;
  option?: FieldOption | null;
  options: Array<{ option: FieldOption }>;
  storageObjectId?: string | null;
}

export interface BreakdownItem {
  id: string;
  entityTypeId: string;
  parentId?: string | null;
  title: string;
  displayCode: string | null;
  description: string | null;
  version: number;
  values: FieldValue[];
  sourceReferences: Array<{
    id?: string;
    sourceDocumentId: string;
    startPage: number;
    endPage: number;
  }>;
  _count?: { children: number };
  parent?: {
    id: string;
    parentId?: string | null;
    entityTypeId: string;
    displayCode: string | null;
    title: string;
    parent?: {
      id: string;
      parentId?: string | null;
      entityTypeId: string;
      displayCode: string | null;
      title: string;
    } | null;
  } | null;
}

export interface ActiveEntity {
  entityType: EntityType;
  item: BreakdownItem;
}

export interface ItemOperation {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export interface PanelContentProps {
  project: Project;
  projectId: string;
  currentUserId: string;
  panel: WorkspacePanel;
  activeEntity?: ActiveEntity;
  onSelectEntity: (entity: ActiveEntity | undefined) => void;
  onPanelChange: (panel: WorkspacePanel) => void;
  onItemOperation?: (operation: ItemOperation) => void;
}
