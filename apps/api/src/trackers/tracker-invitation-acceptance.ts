import { ConflictException } from '@nestjs/common';
import type {
  AcceptInvitationUserInput,
  InvitationAcceptanceDeps,
} from '../auth/auth-invitation-user-preparation';
import {
  createInvitedUser,
  invalidInvitation,
  isUniqueConstraintError,
  prepareInvitedUser,
} from '../auth/auth-invitation-user-preparation';
import { assertInvitationTrackerRoleAvailable } from './tracker-role-lifecycle';

/** The subset of `TrackerInvitation` the acceptance path reads; active-state is asserted upstream. */
export interface TrackerInvitation {
  id: string;
  email: string;
  trackerId: string;
  roleId: string;
  status: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

export function assertActiveTrackerInvitation(invitation: TrackerInvitation): void {
  if (
    invitation.status !== 'PENDING' ||
    invitation.revokedAt ||
    invitation.expiresAt <= new Date()
  ) {
    invalidInvitation();
  }
}

/**
 * The tracker branch of public invitation acceptance, mirroring the screenplay twin: re-verify the
 * role inside the transaction (an archived role invalidates the invite), claim the invitation row
 * with a conditional update so a concurrent acceptance loses cleanly, and upsert the membership so
 * replaying a token that was already accepted is idempotent at the access layer.
 */
export async function acceptTrackerInvitation(
  deps: InvitationAcceptanceDeps,
  invitation: TrackerInvitation,
  input: AcceptInvitationUserInput,
  currentUserId?: string,
) {
  const prepared = await prepareInvitedUser(deps.prisma, invitation.email, input, currentUserId);
  try {
    return await deps.prisma.$transaction(async (tx) => {
      await assertInvitationTrackerRoleAvailable(
        deps.db,
        tx,
        invitation.trackerId,
        invitation.roleId,
      );
      const user = await createInvitedUser(tx, invitation.email, input, prepared);
      const updated = await tx.trackerInvitation.updateMany({
        where: {
          id: invitation.id,
          status: 'PENDING',
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user.id },
      });
      if (!updated.count) throw new ConflictException('Invitation was already used');
      await tx.trackerMembership.upsert({
        where: { trackerId_userId: { trackerId: invitation.trackerId, userId: user.id } },
        create: { trackerId: invitation.trackerId, userId: user.id, roleId: invitation.roleId },
        update: {},
      });
      return user;
    });
  } catch (error) {
    if (error instanceof ConflictException) throw error;
    if (isUniqueConstraintError(error)) {
      throw new ConflictException('An account already exists for this invitation email');
    }
    throw error;
  }
}
