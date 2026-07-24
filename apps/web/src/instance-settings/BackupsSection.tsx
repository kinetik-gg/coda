// #63 scheduled-backups mount point — additive, own file.
// The download/import backup UI (#62) composes into this section separately; this
// section renders the self-contained scheduling and retention panel from its own
// file so the two features never share a module boundary.
import { ScheduledBackupsPanel } from './ScheduledBackupsPanel';

export function BackupsSection() {
  return <ScheduledBackupsPanel />;
}
