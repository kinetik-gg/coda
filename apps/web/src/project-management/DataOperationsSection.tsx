import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/csr/UploadSimple';
import { api } from '../api';
import { CustomSelect } from '../components/CustomSelect';
import styles from '../ProjectManagementScreen.styles';
import { MAX_PROJECT_IMPORT_BYTES, readImportFile } from './import-utils';
import type { ManagedProject, ProjectImportResult } from './types';

/**
 * Breakdown data operations: export this breakdown's model, export one hierarchy level as CSV, and
 * create a new breakdown from an exported file.
 *
 * These stay on the settings surface rather than moving into a modal or a confirmation (#176).
 * None of them is destructive and none is a focused transient task: the level export is chosen
 * per entity level, so it belongs beside the level editor, and import produces a *different*
 * breakdown from a file on disk, which is tool-shaped work. Moving the breakdown itself to trash
 * did leave — that is destructive, so it is a `ConfirmationDialog` raised from the library row
 * menu and the inspector, matching the screenplay precedent.
 */
export function useDataOperationsController({
  projectId,
  project,
}: {
  projectId: string;
  project: ManagedProject;
}) {
  const queryClient = useQueryClient();
  const [importFile, setImportFile] = useState<File>();
  const [importProgress, setImportProgress] = useState(0);
  const [importFileError, setImportFileError] = useState('');
  const importProject = useMutation({
    mutationFn: async (file: File) => {
      setImportProgress(0);
      setImportFileError('');
      if (file.size > MAX_PROJECT_IMPORT_BYTES) {
        throw new Error('Breakdown import exceeds the 25 MB limit.');
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
    importFile,
    setImportFile,
    importProgress,
    setImportProgress,
    importFileError,
    setImportFileError,
    importProject,
  };
}

export type DataOperationsController = ReturnType<typeof useDataOperationsController>;

export function DataOperationsSection({ controller }: { controller: DataOperationsController }) {
  const {
    projectId,
    project,
    importFile,
    setImportFile,
    importProgress,
    setImportProgress,
    importFileError,
    setImportFileError,
    importProject,
  } = controller;

  return (
    <section aria-labelledby="project-management-data-title">
      <header className={styles.pageIntro}>
        <h1 id="project-management-data-title">Data operations</h1>
        <p>Move data into or out of this breakdown.</p>
      </header>
      <section className={styles.section}>
        <div className={styles.operationRow}>
          <div>
            <h2>Export breakdown</h2>
            <p>Download the current breakdown model as JSON, or export one level as CSV.</p>
          </div>
          <div className={styles.operationControls}>
            <a
              className={styles.secondaryButton}
              href={`/api/v1/projects/${projectId}/exports/project.json`}
            >
              <DownloadSimpleIcon size={12} aria-hidden="true" /> Breakdown JSON
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
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Import as a new breakdown</h2>
            <p>
              Select a Coda breakdown JSON export. Import never overwrites this breakdown, and
              source files are not included.
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
            <span>{importFile?.name ?? 'Choose breakdown JSON…'}</span>
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
                  setImportFileError('Breakdown import exceeds the 25 MB limit.');
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
            {importProject.isPending ? `Importing ${importProgress}%…` : 'Create breakdown'}
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
                window.location.assign(
                  `/breakdowns/${importProject.data.project.id}/manage/structure`,
                )
              }
            >
              Open imported breakdown
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
