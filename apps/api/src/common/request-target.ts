const INVITATION_SEGMENT = 'invitations';

/**
 * Return a stable route-like value that is safe to expose in logs and problem
 * details. Query strings are intentionally discarded because they can carry
 * password-reset, invitation, signed-object, or other bearer tokens.
 */
export function sanitizeRequestTarget(target: string | undefined): string {
  if (!target) return '/';

  let pathname: string;
  try {
    pathname = new URL(target, 'http://request.invalid').pathname;
  } catch {
    return '/';
  }

  const segments = pathname.split('/');
  const invitationIndex = segments.findIndex((segment) => segment === INVITATION_SEGMENT);
  if (invitationIndex >= 0 && segments[invitationIndex + 1]) {
    segments[invitationIndex + 1] = '[redacted]';
  }

  return segments.join('/') || '/';
}
