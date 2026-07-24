import { z } from 'zod';

// Sign-out-everywhere revokes every session belonging to the caller. `keepCurrent`
// (default true when omitted) spares the session that issued the request so the
// caller is not immediately logged out of the device they are using.
export const signOutEverywhereSchema = z.object({
  keepCurrent: z.boolean().optional(),
});
export type SignOutEverywhereInput = z.infer<typeof signOutEverywhereSchema>;

/**
 * One active session as surfaced to its owner. Deliberately excludes token
 * material -- `userAgentClass` is a coarse browser/OS label parsed once at
 * session creation, never the raw User-Agent string.
 */
export interface SessionView {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgentClass: string | null;
  isCurrent: boolean;
}
