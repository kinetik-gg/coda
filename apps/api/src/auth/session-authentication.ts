import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { hashToken } from '../common/crypto';
import type { PrismaService } from '../prisma/prisma.service';

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const activeSessionInclude = Prisma.validator<Prisma.SessionInclude>()({
  user: {
    select: {
      id: true,
      email: true,
      displayName: true,
      company: true,
      department: true,
      theme: true,
      fontSize: true,
      motionPreference: true,
      pdfAppearance: true,
      status: true,
    },
  },
});

export type ActiveSession = Prisma.SessionGetPayload<{ include: typeof activeSessionInclude }>;

export async function findActiveSession(
  prisma: Pick<PrismaService, 'session'>,
  token: string,
  now = new Date(),
): Promise<ActiveSession | null> {
  if (!SESSION_TOKEN_PATTERN.test(token)) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: activeSessionInclude,
  });
  if (!session || session.expiresAt <= now || session.user.status !== 'ACTIVE') return null;
  return session;
}

export function hydrateSessionRequest(request: Request, session: ActiveSession): void {
  request.user = session.user;
  request.sessionId = session.id;
  request.authenticationType = 'session';
}

// Sessions record activity at most this often; ordinary request traffic never
// writes on every hit, only after the throttle window has elapsed.
export const SESSION_LAST_SEEN_THROTTLE_MS = 5 * 60_000;

export async function touchSessionLastSeen(
  prisma: Pick<PrismaService, 'session'>,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  await prisma.session.updateMany({
    where: {
      id: sessionId,
      lastSeenAt: { lt: new Date(now.getTime() - SESSION_LAST_SEEN_THROTTLE_MS) },
    },
    data: { lastSeenAt: now },
  });
}
