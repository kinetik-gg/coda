import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import styles from '../ProjectManagementScreen.styles';
import type { ProjectDetailsController } from './useProjectDetailsController';

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
          if (submittable) save.mutate(undefined);
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
