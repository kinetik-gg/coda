import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/csr/UploadSimple';
import { api } from '../api';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { CustomSelect } from '../components/CustomSelect';
import styles from '../ProjectManagementScreen.styles';
import { MAX_PROJECT_IMPORT_BYTES, readImportFile } from './import-utils';
import type { ManagedProject, ProjectImportResult } from './types';

export function useDataOperationsController({
  projectId,
  project,
  canDeleteProject,
  isOwner,
  onDeleted,
}: {
  projectId: string;
  project: ManagedProject;
  canDeleteProject: boolean;
  isOwner: boolean;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmProjectDelete, setConfirmProjectDelete] = useState(false);
  const [importFile, setImportFile] = useState<File>();
  const [importProgress, setImportProgress] = useState(0);
  const [importFileError, setImportFileError] = useState('');
  const deleteProject = useMutation({
    mutationFn: () => api(`/api/v1/projects/${projectId}/trash`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['trashed-projects'] });
      onDeleted();
    },
  });
  const importProject = useMutation({
    mutationFn: async (file: File) => {
      setImportProgress(0);
      setImportFileError('');
      if (file.size > MAX_PROJECT_IMPORT_BYTES) {
        throw new Error('Project import exceeds the 25 MB limit.');
      }
      const raw = await readImportFile(file, setImportProgress);
      return api<ProjectImportResult>('/api/v1/projects/import', {
        method: 'POST',
        headers: { 'content-type': 'application/vnd.coda.project+json' },
        body: raw,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  return {
    projectId,
    project,
    canDeleteProject,
    isOwner,
    confirmProjectDelete,
    setConfirmProjectDelete,
    importFile,
    setImportFile,
    importProgress,
    setImportProgress,
    importFileError,
    setImportFileError,
    deleteProject,
    importProject,
  };
}

export type DataOperationsController = ReturnType<typeof useDataOperationsController>;

export function DataOperationsSection({ controller }: { controller: DataOperationsController }) {
  const {
    projectId,
    project,
    canDeleteProject,
    isOwner,
    confirmProjectDelete,
    setConfirmProjectDelete,
    importFile,
    setImportFile,
    importProgress,
    setImportProgress,
    importFileError,
    setImportFileError,
    deleteProject,
    importProject,
  } = controller;

  return (
    <>
      <header className={styles.pageIntro}>
        <h1>Data operations</h1>
        <p>Move data into or out of this project, or move the entire project to trash.</p>
      </header>
      <section className={styles.card}>
        <div className={styles.operationRow}>
          <div>
            <h2>Export project</h2>
            <p>Download the current project model as JSON, or export one level as CSV.</p>
          </div>
          <div className={styles.operationControls}>
            <a
              className={styles.secondaryButton}
              href={`/api/v1/projects/${projectId}/exports/project.json`}
            >
              <DownloadSimpleIcon size={12} aria-hidden="true" /> Project JSON
            </a>
            <CustomSelect
              className={styles.exportSelect}
              ariaLabel="Hierarchy level to export as CSV"
              value=""
              placeholder="Export level CSV…"
              onChange={(entityTypeId) => {
                if (entityTypeId) {
                  window.location.assign(
                    `/api/v1/projects/${projectId}/exports/levels/${entityTypeId}.csv`,
                  );
                }
              }}
              options={project.entityTypes.map((entityType) => ({
                value: entityType.id,
                label: `${entityType.pluralName} CSV`,
              }))}
            />
          </div>
        </div>
      </section>
      <section className={styles.card}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Import as a new project</h2>
            <p>
              Select a Coda project JSON export. Import never overwrites this project, and source
              files are not included.
            </p>
          </div>
        </div>
        <form
          className={styles.importForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (importFile) importProject.mutate(importFile);
          }}
        >
          <label className={styles.importPicker}>
            <UploadSimpleIcon size={12} aria-hidden="true" />
            <span>{importFile?.name ?? 'Choose project JSON…'}</span>
            <input
              type="file"
              accept=".json,application/json,application/vnd.coda.project+json"
              disabled={importProject.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                importProject.reset();
                setImportProgress(0);
                if (file && file.size > MAX_PROJECT_IMPORT_BYTES) {
                  setImportFile(undefined);
                  setImportFileError('Project import exceeds the 25 MB limit.');
                  return;
                }
                setImportFileError('');
                setImportFile(file);
              }}
            />
          </label>
          <button
            className={styles.secondaryButton}
            type="submit"
            disabled={!importFile || importProject.isPending}
          >
            <UploadSimpleIcon size={12} aria-hidden="true" />
            {importProject.isPending ? `Importing ${importProgress}%…` : 'Create project'}
          </button>
        </form>
        {importProject.isPending && (
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label="Import progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={importProgress}
          >
            <span style={{ width: `${importProgress}%` }} />
          </div>
        )}
        {(importFileError || importProject.error) && (
          <p className={styles.error} role="alert">
            {importFileError || importProject.error?.message}
          </p>
        )}
        {importProject.data && (
          <div className={styles.importResult} role="status">
            <div>
              <strong>{importProject.data.project.name} was created.</strong>
              <span>
                {importProject.data.counts.entityTypes} levels · {importProject.data.counts.fields}{' '}
                fields · {importProject.data.counts.items} items ·{' '}
                {importProject.data.counts.values} values
              </span>
            </div>
            {importProject.data.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() =>
                window.location.assign(`/projects/${importProject.data.project.id}/manage`)
              }
            >
              Manage imported project
            </button>
          </div>
        )}
      </section>
      <section className={`${styles.card} ${styles.dangerCard}`}>
        <div className={styles.operationRow}>
          <div>
            <h2>Move project to trash</h2>
            <p>The project remains recoverable for 30 days, then is permanently removed.</p>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={!canDeleteProject || !isOwner}
            onClick={() => setConfirmProjectDelete(true)}
          >
            <TrashIcon size={12} aria-hidden="true" /> Move to trash…
          </button>
        </div>
        {!isOwner && (
          <p className={styles.inlineHelp}>Only the project owner can delete this project.</p>
        )}
      </section>

      {confirmProjectDelete && (
        <ConfirmationDialog
          title="Move project to trash?"
          description={
            <p>
              <strong>{project.name}</strong> and all project contents will remain recoverable for
              30 days.
            </p>
          }
          confirmLabel="Move to trash"
          busyLabel="Moving…"
          busy={deleteProject.isPending}
          error={deleteProject.error?.message}
          onCancel={() => {
            setConfirmProjectDelete(false);
            deleteProject.reset();
          }}
          onConfirm={() => deleteProject.mutate()}
        />
      )}
    </>
  );
}
