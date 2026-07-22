import { api, uploadToSignedUrl } from '../api';
import { createWorkspaceRecipe } from '../workspace/recipes';
import type { EntityLevelName, LayoutState, PendingSetup, Project } from './types';

export async function configureEntityTypes({
  projectId,
  levelCount,
  levels,
  onProgress,
}: {
  projectId: string;
  levelCount: number;
  levels: EntityLevelName[];
  onProgress: (message: string) => void;
}): Promise<Project> {
  onProgress('Configuring entity structure…');
  let detail = await api<Project>(`/api/v1/projects/${projectId}`);
  for (let index = 0; index < levelCount; index += 1) {
    const desired = levels[index]!;
    const existing = detail.entityTypes[index];
    const names = {
      singularName: desired.singular.trim(),
      pluralName: desired.plural.trim(),
    };
    if (!existing) {
      await api(`/api/v1/projects/${projectId}/entity-types`, {
        method: 'POST',
        body: JSON.stringify(names),
      });
    } else if (
      existing.singularName !== names.singularName ||
      existing.pluralName !== names.pluralName
    ) {
      await api(`/api/v1/projects/${projectId}/entity-types/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...names, version: existing.version }),
      });
    }
    detail = await api<Project>(`/api/v1/projects/${projectId}`);
  }
  return detail;
}

export async function publishProjectWorkspace({
  projectId,
  detail,
  onProgress,
}: {
  projectId: string;
  detail: Project;
  onProgress: (message: string) => void;
}): Promise<void> {
  onProgress('Preparing the workspace…');
  const state = await api<LayoutState>(`/api/v1/projects/${projectId}/workspace-layout`);
  const saved = await api<{ revision: number }>(`/api/v1/projects/${projectId}/workspace-layout`, {
    method: 'PUT',
    body: JSON.stringify({
      layout: createWorkspaceRecipe(detail.entityTypes),
      expectedRevision: state.personal.revision,
    }),
  });
  await api(`/api/v1/projects/${projectId}/workspace-layout/publish`, {
    method: 'POST',
    body: JSON.stringify({
      personalRevision: saved.revision,
      defaultRevision: state.default.revision,
    }),
  });
}

export async function uploadProjectSource({
  projectId,
  sourceFile,
  pending,
  onProgress,
}: {
  projectId: string;
  sourceFile?: File;
  pending: { current: PendingSetup };
  onProgress: (message: string) => void;
}): Promise<void> {
  if (!sourceFile) return;
  onProgress('Uploading source document…');
  const detail = await api<Project>(`/api/v1/projects/${projectId}`);
  if (detail.sourceDocuments.length) return;
  if (!pending.current.upload) {
    const upload = await api<{ id: string; version: number; uploadUrl: string }>(
      '/api/v1/uploads',
      {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          kind: 'source_document',
          filename: sourceFile.name,
          mimeType: 'application/pdf',
          sizeBytes: sourceFile.size,
        }),
      },
    );
    pending.current.upload = { ...upload, transferred: false, completed: false };
  }
  const upload = pending.current.upload;
  if (!upload.transferred) {
    await uploadToSignedUrl(upload.uploadUrl, sourceFile);
    upload.transferred = true;
  }
  if (!upload.completed) {
    await api(`/api/v1/projects/${projectId}/uploads/${upload.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ version: upload.version }),
    });
    upload.completed = true;
  }
  const refreshed = await api<Project>(`/api/v1/projects/${projectId}`);
  if (refreshed.sourceDocuments.length) return;
  await api(`/api/v1/projects/${projectId}/source-documents`, {
    method: 'POST',
    body: JSON.stringify({
      storageObjectId: upload.id,
      title: sourceFile.name.replace(/\.pdf$/i, ''),
    }),
  });
}

export async function addProjectMember({
  projectId,
  selectedUserId,
  selectedRoleName,
  onProgress,
}: {
  projectId: string;
  selectedUserId: string;
  selectedRoleName: string;
  onProgress: (message: string) => void;
}): Promise<void> {
  if (!selectedUserId) return;
  onProgress('Adding the project member…');
  const detail = await api<Project>(`/api/v1/projects/${projectId}`);
  if (detail.memberships.some((membership) => membership.user.id === selectedUserId)) return;
  const role = detail.roles.find((entry) => entry.name === selectedRoleName && !entry.isOwner);
  if (!role) throw new Error('The selected project role is no longer available.');
  await api(`/api/v1/projects/${projectId}/memberships`, {
    method: 'POST',
    body: JSON.stringify({ userId: selectedUserId, roleId: role.id }),
  });
}
