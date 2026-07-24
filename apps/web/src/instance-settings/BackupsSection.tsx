import { useState } from 'react';
import { ArchiveIcon } from '@phosphor-icons/react/dist/csr/Archive';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { ShieldCheckIcon } from '@phosphor-icons/react/dist/csr/ShieldCheck';
import styles from './BackupsSection.module.css';
// #63 scheduled-backups mount point — the scheduling and retention panel is a
// self-contained sibling feature composed from its own file so the download,
// restore, and scheduling features never share a module boundary.
import { ScheduledBackupsPanel } from './ScheduledBackupsPanel';

const DOWNLOAD_PATH = '/api/v1/instance/backups/download';

/**
 * Streams the signed instance archive to the owner's browser. A native anchor download is used so the
 * (potentially large) archive streams straight to disk rather than being buffered in the tab; the
 * request carries the session cookie same-origin, and the server enforces owner-only access.
 */
function startDownload(): void {
  const anchor = document.createElement('a');
  anchor.href = DOWNLOAD_PATH;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function BackupsSection() {
  const [started, setStarted] = useState(false);

  return (
    <div className={styles.section}>
      <section className={styles.card} aria-labelledby="backup-download-title">
        <header className={styles.cardHeader}>
          <ArchiveIcon size={20} aria-hidden="true" />
          <div>
            <h2 id="backup-download-title">Download a backup</h2>
            <p>
              Produces a single signed archive of the database and every stored object. Keep it
              somewhere safe and access-controlled — it contains all instance data.
            </p>
          </div>
        </header>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            startDownload();
            setStarted(true);
          }}
        >
          <DownloadSimpleIcon size={15} aria-hidden="true" />
          Download backup archive
        </button>
        {started && (
          <p className={styles.hint} role="status">
            Your download should begin shortly. Backups are signed with a key derived from this
            instance’s <code>CONFIG_ENCRYPTION_KEY</code>; that value must be set for downloads and
            restores to work.
          </p>
        )}
      </section>

      <section className={styles.card} aria-labelledby="backup-restore-title">
        <header className={styles.cardHeader}>
          <ArchiveIcon size={20} aria-hidden="true" />
          <div>
            <h2 id="backup-restore-title">Restore a backup</h2>
            <p>
              Restoring is done into a fresh, uninitialized instance from its first-run setup
              screen. Deploy a new instance with the same <code>CONFIG_ENCRYPTION_KEY</code>, then
              choose “Restore from a backup” instead of creating an owner account.
            </p>
          </div>
        </header>
      </section>

      <ScheduledBackupsPanel />

      <section className={styles.note} aria-labelledby="backup-safety-title">
        <ShieldCheckIcon size={18} aria-hidden="true" />
        <div>
          <h3 id="backup-safety-title">Automatic pre-upgrade backups</h3>
          <p>
            Before applying pending database migrations on boot, Coda automatically writes a safety
            backup to object storage and keeps the most recent three. An upgrade will not proceed
            without a fresh safety backup unless you set <code>PRE_UPGRADE_BACKUP=off</code>.
          </p>
        </div>
      </section>
    </div>
  );
}
