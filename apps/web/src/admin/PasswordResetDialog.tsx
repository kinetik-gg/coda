import { type FormEvent } from 'react';
import { KeyIcon } from '@phosphor-icons/react/dist/csr/Key';
import styles from '../AdminScreen.module.css';
import type { InstanceUser } from './types';

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
    <div
      className={styles.modalBackdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-password-title"
        onSubmit={onSubmit}
      >
        <header>
          <KeyIcon size={16} aria-hidden="true" />
          <div>
            <h2 id="reset-password-title">Reset user password</h2>
            <p>
              Set a temporary password for {user.displayName}. Existing sessions will be revoked.
            </p>
          </div>
        </header>
        <div className={styles.modalBody}>
          <label className={styles.field}>
            <span>New password</span>
            <input
              type="password"
              minLength={8}
              required
              autoFocus
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              autoComplete="new-password"
            />
            <small>Use at least 8 characters.</small>
          </label>
          <label className={styles.field}>
            <span>Confirm password</span>
            <input
              type="password"
              minLength={8}
              required
              value={confirmation}
              onChange={(event) => onConfirmationChange(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          {passwordsMismatch ? <p className={styles.formError}>Passwords do not match.</p> : null}
          {errorMessage ? (
            <p className={styles.formError} role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
        <footer>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={pending || password.length < 8 || password !== confirmation}
          >
            {pending ? 'Resetting…' : 'Reset password'}
          </button>
        </footer>
      </form>
    </div>
  );
}
