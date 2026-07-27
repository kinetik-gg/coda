import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { ManagedProject } from './types';

export interface ProjectDetailsInput {
  name: string;
  description: string;
}

/**
 * The single project-details write path shared by the management surfaces and compact chrome.
 * Callers may submit the controller's form state or an explicit value (the masthead title uses the
 * latter), while cache synchronization and optimistic-concurrency behavior remain identical.
 */
export function useProjectDetailsController({
  projectId,
  project,
  onSaved,
}: {
  projectId: string;
  project?: ManagedProject;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDescription(project.description ?? '');
  }, [project]);

  const save = useMutation({
    mutationFn: (input?: ProjectDetailsInput) => {
      const nextName = input?.name ?? name;
      const nextDescription = input?.description ?? description;
      return api<ManagedProject>(`/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: nextName.trim(),
          description: nextDescription.trim() || null,
          version: project!.version,
        }),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-management', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
      onSaved?.();
    },
  });
  const cleanName = name.trim();
  const dirty =
    Boolean(project) &&
    (cleanName !== project!.name ||
      (description.trim() || null) !== (project!.description ?? null));

  return {
    name,
    setName,
    description,
    setDescription,
    save,
    submittable: Boolean(project) && Boolean(cleanName) && dirty,
  };
}

export type ProjectDetailsController = ReturnType<typeof useProjectDetailsController>;
