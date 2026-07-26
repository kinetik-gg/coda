import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { api } from '../api';
import styles from '../ProjectManagementScreen.styles';
import type { ManagedProject } from './types';

export function useProjectDetailsController({
  projectId,
  project,
}: {
  projectId: string;
  project: ManagedProject;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');

  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? '');
  }, [project]);

  const save = useMutation({
    mutationFn: () =>
      api<ManagedProject>(`/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          version: project.version,
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-management', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
    },
  });
  const cleanName = name.trim();
  const dirty =
    cleanName !== project.name || (description.trim() || null) !== (project.description ?? null);

  return {
    name,
    setName,
    description,
    setDescription,
    save,
    submittable: Boolean(cleanName) && dirty,
  };
}

export type ProjectDetailsController = ReturnType<typeof useProjectDetailsController>;

export function ProjectDetailsSection({ controller }: { controller: ProjectDetailsController }) {
  const { name, setName, description, setDescription, save, submittable } = controller;
  return (
    <section aria-labelledby="project-management-details-title">
      <header className={styles.pageIntro}>
        <h1 id="project-management-details-title">Details</h1>
        <p>Update the name and description shown in breakdown lists, selectors, and exports.</p>
      </header>
      <form
        className={styles.detailsForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (submittable) save.mutate();
        }}
      >
        <label className={styles.field}>
          <span>Name</span>
          <input
            required
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Description</span>
          <textarea
            rows={5}
            maxLength={4000}
            value={description}
            placeholder="Describe the purpose of this breakdown."
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className={styles.formActions}>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={save.isPending || !submittable}
          >
            <FloppyDiskIcon size={12} aria-hidden="true" />
            {save.isPending ? 'Saving…' : 'Save details'}
          </button>
        </div>
        {save.error && (
          <p className={styles.error} role="alert">
            {save.error.message}
          </p>
        )}
      </form>
    </section>
  );
}
