import type { ScreenplayPermission } from '@coda/contracts';
import type { ScreenplayPaperSize } from './screenplay-paper';

export interface ScreenplaySummary {
  id: string;
  ownerUserId: string;
  title: string;
  filename: string;
  paperSize: ScreenplayPaperSize;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Screenplay extends ScreenplaySummary {
  sourceText: string;
  /**
   * The caller's role permissions for this screenplay, resolved on the detail read so the editor can
   * render permission-aware states without touching the management surface (which is itself gated on
   * `manage_screenplay_settings`). Optional so older cache entries and fixtures degrade gracefully.
   */
  access?: { permissions: ScreenplayPermission[] };
}

export function screenplayCanEdit(screenplay?: Screenplay): boolean {
  // A screenplay whose access is unknown (older cache/fixtures) stays editable; only an explicit
  // absence of `edit_screenplay` renders read-only.
  const permissions = screenplay?.access?.permissions;
  return !permissions || permissions.includes('edit_screenplay');
}

export function screenplayCanManage(screenplay?: Screenplay): boolean {
  return screenplay?.access?.permissions?.includes('manage_screenplay_settings') ?? false;
}
