import type { User } from '@prisma/client';
import type { AuthenticatedCredential } from '../auth/request-auth-context';

declare global {
  namespace Express {
    interface Request {
      user?: Pick<
        User,
        | 'id'
        | 'email'
        | 'displayName'
        | 'company'
        | 'department'
        | 'theme'
        | 'fontSize'
        | 'motionPreference'
        | 'pdfAppearance'
        | 'status'
      >;
      sessionId?: string;
      apiCredential?: AuthenticatedCredential;
      authenticationType?: 'session' | 'credential';
      authenticationFailure?: string;
      requestId: string;
    }
  }
}

export {};
