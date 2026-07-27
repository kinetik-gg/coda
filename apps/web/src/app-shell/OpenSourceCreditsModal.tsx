import { useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { ModalShell, modalButtonStyles } from '../components/ModalShell';
import manifest from './generated/open-source-credits.json';
import styles from './OpenSourceCreditsModal.module.css';

interface CreditEntry {
  name: string;
  version: string;
  license: string;
  attribution: string;
  projectUrl: string;
  licenseTextUrl: string;
}

export function OpenSourceCreditsModal({
  onClose,
  restoreFocus,
}: {
  onClose: () => void;
  restoreFocus?: RefObject<HTMLElement | null>;
}) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    return (manifest.packages as CreditEntry[]).filter((entry) => {
      const text =
        `${entry.name} ${entry.version} ${entry.license} ${entry.attribution}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [query]);

  return (
    <ModalShell
      config={{
        size: 'wide',
        regions: {
          header: { title: 'Open Source Credits' },
          body: {
            description: (
              <p>
                Coda is built with open-source software. This manifest covers{' '}
                {manifest.scope.toLowerCase()}
              </p>
            ),
            content: (
              <>
                <label className={styles.search}>
                  <span>Search credits</span>
                  <input
                    ref={search}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Package, author, or license"
                  />
                </label>
                <p className={styles.count} aria-live="polite">
                  {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
                </p>
                <div className={styles.list}>
                  {filtered.map((entry) => (
                    <article className={styles.entry} key={`${entry.name}@${entry.version}`}>
                      <div className={styles.heading}>
                        <strong>{entry.name}</strong>
                        <span>{entry.version}</span>
                        <span className={styles.license}>{entry.license}</span>
                      </div>
                      <p>{entry.attribution}</p>
                      <div className={styles.links}>
                        <a href={entry.projectUrl} target="_blank" rel="noreferrer">
                          Project <ArrowSquareOutIcon size={11} aria-hidden="true" />
                        </a>
                        <a href={entry.licenseTextUrl} target="_blank" rel="noreferrer">
                          License text <ArrowSquareOutIcon size={11} aria-hidden="true" />
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ),
          },
          footer: (
            <button type="button" className={modalButtonStyles.primary} onClick={onClose}>
              Done
            </button>
          ),
        },
        dismissal: { onDismiss: onClose },
        focus: { initialFocus: search, restoreFocus },
      }}
    />
  );
}
