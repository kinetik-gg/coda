import { z } from 'zod';
import { PASSWORD_CONTAINS_EMAIL_MESSAGE, passwordContainsEmailLocalPart } from '@coda/contracts';

/**
 * The email-local-part rule needs both the password and the account email at
 * once, so it cannot live inside the standalone `passwordSchema`. Call this
 * wherever a request carries both a password to set and the email it belongs
 * to: owner setup, invitation acceptance, and password reset completion.
 *
 * Throws a ZodError on violation so it flows through the same problem-details
 * validation response shape as every other request-shape failure.
 */
export function assertPasswordDoesNotContainEmail(password: string, email: string): void {
  z.object({
    password: z.string().refine((value) => !passwordContainsEmailLocalPart(value, email), {
      message: PASSWORD_CONTAINS_EMAIL_MESSAGE,
    }),
  }).parse({ password });
}
