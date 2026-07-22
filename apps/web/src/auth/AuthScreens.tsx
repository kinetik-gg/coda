import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../api';
import { messages } from '../messages';
import styles from '../App.styles';

interface AuthFields {
  displayName: string;
  email: string;
  password: string;
  setupToken?: string;
}

function AuthBrand() {
  return (
    <section className={styles.authIntro} aria-labelledby="auth-brand">
      <h1 id="auth-brand">
        <span className={styles.authLogoMark} aria-hidden="true" />
        <span className={styles.visuallyHidden}>{messages.brand}</span>
      </h1>
      <p>{messages.strapline}</p>
    </section>
  );
}

export function ResetPasswordScreen({ token, onReset }: { token: string; onReset: () => void }) {
  const { register, handleSubmit } = useForm<{ password: string }>();
  const reset = useMutation({
    mutationFn: ({ password }: { password: string }) =>
      api<{ reset: true }>('/api/v1/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      }),
    onSuccess: onReset,
  });

  return (
    <div className={styles.authPage}>
      <AuthBrand />
      <main className={styles.authPanel}>
        <div className={styles.card}>
          <h2>Choose a new password</h2>
          <form className={styles.form} onSubmit={handleSubmit((values) => reset.mutate(values))}>
            <label className={styles.field}>
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                {...register('password', { required: true })}
              />
            </label>
            {reset.error && <div className={styles.error}>{reset.error.message}</div>}
            <button className={styles.primary} disabled={reset.isPending}>
              {reset.isPending ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export function AuthScreen({
  initialized,
  setupTokenRequired,
  onAuthenticated,
}: {
  initialized: boolean;
  setupTokenRequired: boolean;
  onAuthenticated: () => void;
}) {
  const { register, handleSubmit } = useForm<AuthFields>();
  const mutation = useMutation({
    mutationFn: (values: AuthFields) => {
      const { setupToken, ...body } = values;
      return api(initialized ? '/api/v1/auth/login' : '/api/v1/setup/owner', {
        method: 'POST',
        headers: setupToken ? { 'x-coda-setup-token': setupToken } : undefined,
        body: JSON.stringify(body),
      });
    },
    onSuccess: onAuthenticated,
  });
  return (
    <div className={styles.authPage}>
      <AuthBrand />
      <main className={styles.authPanel}>
        <div className={`${styles.card} ${initialized ? styles.loginCard : ''}`}>
          <h2 className={initialized ? styles.visuallyHidden : undefined}>
            {initialized ? messages.loginTitle : messages.setupTitle}
          </h2>
          <form
            className={styles.form}
            onSubmit={handleSubmit((values) => mutation.mutate(values))}
          >
            {!initialized && (
              <>
                <label className={styles.field}>
                  <span>Display name</span>
                  <input autoComplete="name" {...register('displayName', { required: true })} />
                </label>
                {setupTokenRequired && (
                  <label className={styles.field}>
                    <span>Instance setup token</span>
                    <input
                      type="password"
                      autoComplete="off"
                      {...register('setupToken', { required: true })}
                    />
                  </label>
                )}
              </>
            )}
            <label className={styles.field}>
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                placeholder={initialized ? 'you@email.com' : undefined}
                {...register('email', { required: true })}
              />
            </label>
            <label className={styles.field}>
              <span>Password</span>
              <input
                type="password"
                autoComplete={initialized ? 'current-password' : 'new-password'}
                minLength={initialized ? undefined : 8}
                placeholder={initialized ? 'password' : undefined}
                {...register('password', { required: true })}
              />
            </label>
            {mutation.error && <div className={styles.error}>{mutation.error.message}</div>}
            <button className={styles.primary} disabled={mutation.isPending}>
              {mutation.isPending ? 'Working…' : initialized ? 'Log in' : 'Create owner account'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
