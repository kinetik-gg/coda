import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { PASSWORD_MIN_LENGTH } from '@coda/contracts';
import { api } from './api';
import styles from './InvitationScreen.module.css';

interface User {
  id: string;
  email: string;
  displayName: string;
}

interface InvitationDetails {
  kind: 'project' | 'screenplay' | 'space' | 'instance' | 'bulk_instance';
  email: string | null;
  expiresAt: string | null;
  project?: { id: string; name: string } | null;
  screenplay?: { id: string; title: string } | null;
  space?: { id: string; name: string } | null;
  role?: { id: string; name: string } | null;
}

interface InvitationFields {
  email: string;
  displayName: string;
  company: string;
  department: string;
  password: string;
  confirmPassword: string;
}

const initialFields: InvitationFields = {
  email: '',
  displayName: '',
  company: '',
  department: '',
  password: '',
  confirmPassword: '',
};

function invitationMessage(invitation: InvitationDetails) {
  const project = invitation.project?.name;
  const screenplay = invitation.screenplay?.title;
  const space = invitation.space?.name;
  const role = invitation.role?.name;
  if (invitation.kind === 'bulk_instance') {
    return project && role
      ? `Create your account to join ${project} as ${role}. Enter the email address you want to use.`
      : 'Create your account with this invitation. Enter the email address you want to use.';
  }
  if (screenplay && role) {
    return `This invitation is reserved for ${invitation.email} to join “${screenplay}” as ${role}.`;
  }
  if (project && role) {
    return `This invitation is reserved for ${invitation.email} to join ${project} as ${role}.`;
  }
  if (space && role) {
    return `This invitation is reserved for ${invitation.email} to join ${space} as ${role}.`;
  }
  return `This invitation is reserved for ${invitation.email}.`;
}

interface InvitationScreenProps {
  token: string;
  currentUser?: User;
  onAccepted: (redirect?: string) => void;
  onSignIn?: () => void;
  onSwitchAccount?: () => void;
}

function useAcceptInvitation(
  token: string,
  invitation: InvitationDetails,
  fields: InvitationFields,
  currentUser: User | undefined,
  onAccepted: (redirect?: string) => void,
) {
  return useMutation({
    mutationFn: () =>
      api<User>('/api/v1/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({
          token,
          ...(invitation.kind === 'bulk_instance'
            ? { email: currentUser?.email ?? fields.email }
            : {}),
          ...(!currentUser
            ? {
                displayName: fields.displayName,
                company: fields.company,
                department: fields.department,
                password: fields.password,
              }
            : {}),
        }),
      }),
    onSuccess: () => {
      const screenplayId = invitation.screenplay?.id;
      onAccepted(screenplayId ? `/screenplays/${screenplayId}` : undefined);
    },
  });
}

function SignedInInvitation({
  token,
  invitation,
  currentUser,
  onAccepted,
  onSwitchAccount,
}: Required<Pick<InvitationScreenProps, 'token' | 'currentUser' | 'onAccepted'>> & {
  invitation: InvitationDetails;
  onSwitchAccount?: () => void;
}) {
  const accept = useAcceptInvitation(token, invitation, initialFields, currentUser, onAccepted);
  const emailMismatch = Boolean(
    invitation.email && currentUser.email.toLowerCase() !== invitation.email.toLowerCase(),
  );
  return (
    <div className={styles.step}>
      <p className={styles.hint}>Signed in as {currentUser.email}</p>
      {emailMismatch ? (
        <>
          <div className={styles.error}>
            This invitation belongs to another email address. Switch accounts to accept it.
          </div>
          <button className={styles.primary} type="button" onClick={() => onSwitchAccount?.()}>
            Switch account
          </button>
        </>
      ) : (
        <button
          className={styles.primary}
          type="button"
          disabled={accept.isPending}
          onClick={() => accept.mutate()}
        >
          {accept.isPending ? 'Accepting…' : 'Accept invitation'}
        </button>
      )}
      {accept.error ? <div className={styles.error}>{accept.error.message}</div> : null}
    </div>
  );
}

function ProfileStep({
  invitation,
  fields,
  update,
}: {
  invitation: InvitationDetails;
  fields: InvitationFields;
  update: (key: keyof InvitationFields, value: string) => void;
}) {
  return (
    <div className={styles.step}>
      {invitation.kind === 'bulk_instance' ? (
        <label className={styles.field}>
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={fields.email}
            onChange={(event) => update('email', event.target.value)}
            autoFocus
          />
        </label>
      ) : null}
      <label className={styles.field}>
        <span>Name</span>
        <input
          autoComplete="name"
          value={fields.displayName}
          onChange={(event) => update('displayName', event.target.value)}
          autoFocus={invitation.kind !== 'bulk_instance'}
        />
      </label>
      <label className={styles.field}>
        <span>
          Company <small>Optional</small>
        </span>
        <input
          autoComplete="organization"
          value={fields.company}
          onChange={(event) => update('company', event.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span>
          Department <small>Optional</small>
        </span>
        <input
          autoComplete="organization-title"
          value={fields.department}
          onChange={(event) => update('department', event.target.value)}
        />
      </label>
      <button className={styles.primary} type="submit">
        Continue <ArrowRightIcon size={14} weight="bold" />
      </button>
    </div>
  );
}

function PasswordStep({
  fields,
  update,
  back,
  pending,
}: {
  fields: InvitationFields;
  update: (key: keyof InvitationFields, value: string) => void;
  back: () => void;
  pending: boolean;
}) {
  return (
    <div className={styles.step}>
      <label className={styles.field}>
        <span>Password</span>
        <input
          type="password"
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          value={fields.password}
          onChange={(event) => update('password', event.target.value)}
          autoFocus
        />
      </label>
      <label className={styles.field}>
        <span>Confirm password</span>
        <input
          type="password"
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          value={fields.confirmPassword}
          onChange={(event) => update('confirmPassword', event.target.value)}
        />
      </label>
      <p className={styles.hint}>
        Use {PASSWORD_MIN_LENGTH} or more characters. Avoid common or previously leaked passwords.
      </p>
      <div className={styles.actions}>
        <button className={styles.secondary} type="button" onClick={back}>
          <ArrowLeftIcon size={14} /> Back
        </button>
        <button className={styles.primary} type="submit" disabled={pending}>
          {pending ? 'Creating account…' : 'Accept invitation'}
        </button>
      </div>
    </div>
  );
}

function NewAccountInvitation({
  token,
  invitation,
  onAccepted,
  onSignIn,
}: Pick<InvitationScreenProps, 'token' | 'onAccepted' | 'onSignIn'> & {
  invitation: InvitationDetails;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [fields, setFields] = useState(initialFields);
  const [validationError, setValidationError] = useState<string>();
  const accept = useAcceptInvitation(token, invitation, fields, undefined, onAccepted);

  const update = (key: keyof InvitationFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setValidationError(undefined);
  };

  const continueToPassword = () => {
    if (!fields.displayName.trim()) {
      setValidationError('Enter your name to continue.');
      return;
    }
    if (invitation.kind === 'bulk_instance' && !/^\S+@\S+\.\S+$/.test(fields.email)) {
      setValidationError('Enter a valid email address to continue.');
      return;
    }
    setValidationError(undefined);
    setStep(2);
  };

  const submit = () => {
    if (fields.password.length < PASSWORD_MIN_LENGTH) {
      setValidationError(`Use at least ${PASSWORD_MIN_LENGTH} characters for your password.`);
      return;
    }
    if (fields.password !== fields.confirmPassword) {
      setValidationError('The passwords do not match.');
      return;
    }
    setValidationError(undefined);
    accept.mutate();
  };

  return (
    <>
      <div className={styles.progress} aria-label={`Step ${step} of 2`}>
        <span className={styles.complete} />
        <span className={step === 2 ? styles.complete : undefined} />
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (step === 1) continueToPassword();
          else submit();
        }}
      >
        {step === 1 ? (
          <ProfileStep invitation={invitation} fields={fields} update={update} />
        ) : (
          <PasswordStep
            fields={fields}
            update={update}
            back={() => setStep(1)}
            pending={accept.isPending}
          />
        )}
        {validationError ? <div className={styles.error}>{validationError}</div> : null}
        {accept.error ? <div className={styles.error}>{accept.error.message}</div> : null}
      </form>
      {onSignIn ? (
        <button className={styles.secondary} type="button" onClick={onSignIn}>
          Already have an account? Sign in
        </button>
      ) : null}
    </>
  );
}

export function InvitationScreen({
  token,
  currentUser,
  onAccepted,
  onSignIn,
  onSwitchAccount,
}: InvitationScreenProps) {
  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<InvitationDetails>(`/api/v1/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });

  return (
    <div className={styles.page}>
      <div className={styles.brand} aria-label="Coda">
        <span aria-hidden="true" />
      </div>
      <main className={styles.panel} aria-busy={invitation.isLoading}>
        {invitation.isLoading ? <p className={styles.message}>Checking invitation…</p> : null}
        {invitation.error ? <div className={styles.error}>{invitation.error.message}</div> : null}
        {invitation.data ? (
          <>
            <p className={styles.message}>{invitationMessage(invitation.data)}</p>
            {currentUser ? (
              <SignedInInvitation
                token={token}
                invitation={invitation.data}
                currentUser={currentUser}
                onAccepted={onAccepted}
                onSwitchAccount={onSwitchAccount}
              />
            ) : (
              <NewAccountInvitation
                token={token}
                invitation={invitation.data}
                onAccepted={onAccepted}
                onSignIn={onSignIn}
              />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
