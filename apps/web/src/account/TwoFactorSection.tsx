import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { ShieldCheckIcon } from '@phosphor-icons/react/dist/csr/ShieldCheck';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import type { TwoFactorActivation } from '@coda/contracts';
import { api } from '../api';
import { Skeleton, SkeletonGroup } from '../components/Skeleton';
import styles from '../AccountScreen.module.css';
import { QrCode } from './QrCode';
import { accountErrorMessage } from './AccountSections';
import type { TwoFactorEnrollmentView, TwoFactorStatusView } from './types';

function RecoveryCodeList({ codes, title }: { codes: string[]; title: string }) {
  return (
    <div className={styles.recoveryCodes} role="status">
      <div className={styles.formHeading}>
        <h3>{title}</h3>
        <p>
          Store these somewhere safe. Each code works once if you lose your authenticator. They will
          not be shown again.
        </p>
      </div>
      <ul className={styles.recoveryCodeGrid}>
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={styles.secondaryButton}
        onClick={() => void navigator.clipboard.writeText(codes.join('\n'))}
      >
        <CopyIcon size={12} aria-hidden="true" /> Copy all codes
      </button>
    </div>
  );
}

function EnrollmentPanel({
  enrollment,
  onActivated,
  onCancel,
}: {
  enrollment: TwoFactorEnrollmentView;
  onActivated: (codes: string[]) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const activate = useMutation({
    mutationFn: () =>
      api<TwoFactorActivation>('/api/v1/account/2fa/activate', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      }),
    onSuccess: (result) => onActivated(result.recoveryCodes),
  });
  return (
    <form
      className={styles.formPanel}
      onSubmit={(event) => {
        event.preventDefault();
        activate.reset();
        if (/^\d{6}$/.test(code.trim())) activate.mutate();
      }}
    >
      <div className={styles.formHeading}>
        <h2>Set up your authenticator</h2>
        <p>
          Scan this QR code with an authenticator app, then enter the six-digit code to confirm.
        </p>
      </div>
      <div className={styles.twoFactorSetup}>
        <QrCode value={enrollment.otpauthUri} />
        <div className={styles.twoFactorSecret}>
          <span>Can’t scan? Enter this key manually:</span>
          <code>{enrollment.secret}</code>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void navigator.clipboard.writeText(enrollment.secret)}
          >
            <CopyIcon size={12} aria-hidden="true" /> Copy key
          </button>
        </div>
      </div>
      <label className={styles.field}>
        <span>Verification code</span>
        <input
          autoComplete="one-time-code"
          inputMode="numeric"
          placeholder="123456"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            if (activate.isError) activate.reset();
          }}
        />
      </label>
      <div className={styles.actions}>
        <div className={styles.formFeedback} aria-live="polite">
          {activate.error && (
            <span className={styles.error} role="alert">
              <WarningCircleIcon size={12} aria-hidden="true" />{' '}
              {accountErrorMessage(activate.error, 'That code is incorrect or expired.')}
            </span>
          )}
        </div>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={activate.isPending || !/^\d{6}$/.test(code.trim())}
        >
          <ShieldCheckIcon size={12} aria-hidden="true" />
          {activate.isPending ? 'Verifying…' : 'Turn on two-factor'}
        </button>
      </div>
    </form>
  );
}

function DisablePanel({ remaining, onDisabled }: { remaining: number; onDisabled: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const disable = useMutation({
    mutationFn: () =>
      api('/api/v1/account/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ password, code: code.trim() }),
      }),
    onSuccess: onDisabled,
  });
  return (
    <form
      className={styles.formPanel}
      onSubmit={(event) => {
        event.preventDefault();
        disable.reset();
        if (password && code.trim()) disable.mutate();
      }}
    >
      <div className={styles.formHeading}>
        <h2>Two-factor authentication is on</h2>
        <p>
          <CheckCircleIcon size={12} weight="fill" aria-hidden="true" /> Your account asks for a
          code at sign-in. {remaining} recovery {remaining === 1 ? 'code' : 'codes'} remaining.
        </p>
      </div>
      <p className={styles.fieldNote}>To turn it off, confirm your password and a current code.</p>
      <div className={styles.formGridSingle}>
        <label className={styles.field}>
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Authenticator or recovery code</span>
          <input
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <div className={styles.formFeedback} aria-live="polite">
          {disable.error && (
            <span className={styles.error} role="alert">
              <WarningCircleIcon size={12} aria-hidden="true" />{' '}
              {accountErrorMessage(disable.error, 'Two-factor could not be turned off.')}
            </span>
          )}
        </div>
        <button
          type="submit"
          className={styles.dangerButton}
          disabled={disable.isPending || !password || !code.trim()}
        >
          {disable.isPending ? 'Turning off…' : 'Turn off two-factor'}
        </button>
      </div>
    </form>
  );
}

export function TwoFactorSection() {
  const queryClient = useQueryClient();
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollmentView | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const status = useQuery({
    queryKey: ['two-factor'],
    queryFn: () => api<TwoFactorStatusView>('/api/v1/account/2fa'),
  });
  const enroll = useMutation({
    mutationFn: () =>
      api<TwoFactorEnrollmentView>('/api/v1/account/2fa/enroll', { method: 'POST' }),
    onSuccess: (result) => setEnrollment(result),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['two-factor'] });

  if (status.isLoading) {
    return (
      <SkeletonGroup label="Loading two-factor status" className={styles.formPanel}>
        <Skeleton width={180} height={14} />
        <Skeleton width="100%" height={34} radius={4} />
      </SkeletonGroup>
    );
  }
  if (recoveryCodes) {
    return (
      <section className={styles.formPanel}>
        <RecoveryCodeList codes={recoveryCodes} title="Save your recovery codes" />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              setRecoveryCodes(null);
              setEnrollment(null);
              refresh();
            }}
          >
            I’ve saved my codes
          </button>
        </div>
      </section>
    );
  }
  if (enrollment) {
    return (
      <EnrollmentPanel
        enrollment={enrollment}
        onActivated={(codes) => setRecoveryCodes(codes)}
        onCancel={() => {
          setEnrollment(null);
          enroll.reset();
        }}
      />
    );
  }
  if (status.data?.enabled) {
    return <DisablePanel remaining={status.data.recoveryCodesRemaining} onDisabled={refresh} />;
  }
  return (
    <section className={styles.formPanel}>
      <div className={styles.formHeading}>
        <h2>Two-factor authentication</h2>
        <p>Add a one-time code from an authenticator app as a second step when you sign in.</p>
      </div>
      {status.data && !status.data.available ? (
        <p className={styles.fieldNote} role="status">
          <WarningCircleIcon size={12} aria-hidden="true" /> Two-factor requires the instance to be
          started with a CONFIG_ENCRYPTION_KEY. Ask your administrator to set one.
        </p>
      ) : (
        <div className={styles.actions}>
          <div className={styles.formFeedback} aria-live="polite">
            {enroll.error && (
              <span className={styles.error} role="alert">
                <WarningCircleIcon size={12} aria-hidden="true" />{' '}
                {accountErrorMessage(enroll.error, 'Two-factor could not be started.')}
              </span>
            )}
          </div>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={enroll.isPending}
            onClick={() => {
              enroll.reset();
              enroll.mutate();
            }}
          >
            <ShieldCheckIcon size={12} aria-hidden="true" />
            {enroll.isPending ? 'Starting…' : 'Set up two-factor'}
          </button>
        </div>
      )}
    </section>
  );
}
