import { type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@coda/contracts';
import { ModalShell, modalButtonStyles, modalFormStyles } from '../components/ModalShell';
import type { InstanceUser } from './types';

/**
 * Sets a temporary password for another account, in the shared modal shell (#169).
 *
 * Administrator-only, and destructive to the target's sessions, so the shell's `busy` state gates
 * `Escape` and backdrop dismissal while the reset is in flight — an operator cannot half-close this
 * dialog and be left unsure whether the password changed.
 */
export function PasswordResetDialog({
  user,
  password,
  confirmation,
  pending,
  errorMessage,
  onPasswordChange,
  onConfirmationChange,
  onCancel,
  onSubmit,
}: {
  user: InstanceUser;
  password: string;
  confirmation: string;
  pending: boolean;
  errorMessage?: string;
  onPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const passwordsMismatch = Boolean(password && confirmation && password !== confirmation);
  return (
    <ModalShell
      config={{
        regions: {
          header: { eyebrow: 'Reset', title: 'Reset user password' },
          body: {
            description: (
              <p>
                Set a temporary password for {user.displayName}. Existing sessions will be revoked.
              </p>
            ),
            content: (
              <div className={modalFormStyles.fields}>
                <label>
                  <span>New password</span>
                  <input
                    type="password"
                    minLength={PASSWORD_MIN_LENGTH}
                    required
                    autoFocus
                    value={password}
                    onChange={(event) => onPasswordChange(event.target.value)}
                    autoComplete="new-password"
                  />
                  <small>
                    Use at least {PASSWORD_MIN_LENGTH} characters. Avoid common or previously leaked
                    passwords.
                  </small>
                </label>
                <label>
                  <span>Confirm password</span>
                  <input
                    type="password"
                    minLength={PASSWORD_MIN_LENGTH}
                    required
                    value={confirmation}
                    onChange={(event) => onConfirmationChange(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                {passwordsMismatch ? (
                  <p className={modalFormStyles.error}>Passwords do not match.</p>
                ) : null}
                {errorMessage ? (
                  <p className={modalFormStyles.error} role="alert">
                    {errorMessage}
                  </p>
                ) : null}
              </div>
            ),
          },
          footer: (
            <>
              <button
                type="button"
                className={modalButtonStyles.secondary}
                disabled={pending}
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={modalButtonStyles.primary}
                disabled={
                  pending || password.length < PASSWORD_MIN_LENGTH || password !== confirmation
                }
              >
                {pending ? 'Resetting…' : 'Reset password'}
              </button>
            </>
          ),
        },
        dismissal: { onDismiss: onCancel, busy: pending },
        form: { onSubmit },
      }}
    />
  );
}
