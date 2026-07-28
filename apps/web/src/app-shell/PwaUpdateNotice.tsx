import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import styles from './PwaUpdateNotice.module.css';

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

export function PwaUpdateNotice() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const updateServiceWorker = useRef<UpdateServiceWorker | undefined>(undefined);

  useEffect(() => {
    updateServiceWorker.current = registerSW({
      immediate: true,
      onNeedRefresh: () => setUpdateAvailable(true),
    });
  }, []);

  if (!updateAvailable) return null;

  return (
    <aside className={styles.notice} role="status" aria-live="polite">
      <p>A new version of Coda is ready.</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => void updateServiceWorker.current?.(true)}>
          Reload now
        </button>
        <button type="button" onClick={() => setUpdateAvailable(false)}>
          Later
        </button>
      </div>
    </aside>
  );
}
