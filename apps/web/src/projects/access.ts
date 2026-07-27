/**
 * What the caller may do with a breakdown, read from the membership the list payload already
 * carries. One predicate per capability, in one place, because four surfaces now ask the same
 * questions: the breakdowns library row menu, the properties's quick actions, the breakdown
 * workspace masthead, and the structure surface (#176).
 *
 * The permission names are the access-control ADR's, and the checks mirror the API's own guards —
 * a control the server would reject is never offered rather than being offered and then failing.
 */

export interface BreakdownMembership {
  currentMembership?: { role: { permissions: Array<{ permission: string }> } } | null;
}

function grants(project: BreakdownMembership, permission: string): boolean {
  return Boolean(
    project.currentMembership?.role.permissions.some((entry) => entry.permission === permission),
  );
}

/** Whether the caller may open this breakdown's sharing and settings surfaces. */
export function canManageProject(project: BreakdownMembership): boolean {
  return grants(project, 'manage_project_settings');
}

/**
 * Whether the caller may move this breakdown to trash. The API restricts deletion to the owner on
 * top of the permission, so the affordance does too rather than offering a control that 403s.
 */
export function canTrashProject(
  project: BreakdownMembership & { ownerUserId: string },
  sessionUserId?: string,
): boolean {
  return grants(project, 'delete_project') && project.ownerUserId === sessionUserId;
}
