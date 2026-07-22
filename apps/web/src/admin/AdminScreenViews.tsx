import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import styles from '../AdminScreen.styles';
import { EmptyState, ListRegion, LoadingRows, type ManagementListQuery } from './AdminCommon';
import { ActivityRows, JobRows, ProjectRows, StorageRows, UserRows } from './AdminRows';
import { InvitationPage } from './InvitationPage';
import { OverviewPage } from './OverviewPage';
import { PasswordResetDialog } from './PasswordResetDialog';
import type {
  ActivityEntry,
  AdminPage,
  InstanceInvitation,
  InstanceProject,
  InstanceUser,
  StorageItem,
} from './types';
import type { AdminController } from './useAdminController';
import { errorText } from './utils';

function UserStatusFeedback({ feedback }: { feedback: AdminController['userStatusFeedback'] }) {
  if (!feedback) return null;
  const successful = feedback.kind === 'success';
  return (
    <div
      className={successful ? styles.actionSuccess : styles.actionError}
      role={successful ? 'status' : 'alert'}
    >
      {successful ? (
        <CheckCircleIcon size={12} weight="fill" aria-hidden="true" />
      ) : (
        <WarningCircleIcon size={12} weight="fill" aria-hidden="true" />
      )}
      <span>{feedback.message}</span>
    </div>
  );
}

function JobsPage({ controller }: { controller: AdminController }) {
  if (controller.jobs.isLoading) return <LoadingRows />;
  if (controller.jobs.error) {
    return (
      <EmptyState icon={<WarningCircleIcon size={22} />} title="Jobs could not be loaded.">
        Try again after checking the API connection.
      </EmptyState>
    );
  }
  return <JobRows items={controller.jobs.data ?? []} />;
}

function UsersPage({ controller }: { controller: AdminController }) {
  return (
    <>
      <UserStatusFeedback feedback={controller.userStatusFeedback} />
      <ListRegion
        list={controller.list as ManagementListQuery}
        emptyTitle="No users found"
        emptyText="There are no registered users matching this search."
      >
        <UserRows
          items={controller.listItems as InstanceUser[]}
          ownerId={controller.management.data!.owner.id}
          statusBusyUserId={controller.userStatusMutation.variables?.userId}
          onReset={(user) => {
            controller.resetMutation.reset();
            controller.setResetUser(user);
          }}
          onStatus={controller.changeUserStatus}
        />
      </ListRegion>
    </>
  );
}

function InvitationsPage({ controller }: { controller: AdminController }) {
  return (
    <InvitationPage
      list={controller.list as ManagementListQuery}
      items={controller.listItems as InstanceInvitation[]}
      options={controller.invitationOptions.data}
      optionsLoading={controller.invitationOptions.isLoading}
      inviteEmail={controller.inviteEmail}
      inviteKind={controller.inviteKind}
      inviteExpiry={controller.inviteExpiry}
      inviteMembership={controller.inviteMembership}
      inviteProjectId={controller.inviteProjectId}
      inviteRoleId={controller.inviteRoleId}
      createdInvitation={controller.createdInvitation}
      copyState={controller.copyState}
      pending={controller.inviteMutation.isPending}
      errorMessage={
        controller.inviteMutation.error
          ? errorText(controller.inviteMutation.error, 'The invitation could not be created.')
          : undefined
      }
      onSubmit={controller.submitInvite}
      onEmailChange={controller.setInviteEmail}
      onKindChange={(kind) => {
        controller.setInviteKind(kind);
        if (kind === 'bulk' && controller.inviteExpiry === 'never') {
          controller.setInviteExpiry('7_days');
        }
      }}
      onExpiryChange={controller.setInviteExpiry}
      onMembershipChange={(membership) => {
        controller.setInviteMembership(membership);
        if (membership === 'none') {
          controller.setInviteProjectId('');
          controller.setInviteRoleId('');
        }
      }}
      onProjectChange={(projectId) => {
        controller.setInviteProjectId(projectId);
        controller.setInviteRoleId('');
      }}
      onRoleChange={controller.setInviteRoleId}
      onCopy={controller.copyInvitation}
      onRevoke={controller.setRevokeInvitation}
    />
  );
}

export function AdminPageBody({
  activePage,
  controller,
  onPageChange,
}: {
  activePage: AdminPage;
  controller: AdminController;
  onPageChange: (page: AdminPage) => void;
}) {
  if (controller.management.isLoading) return <LoadingRows />;
  if (controller.management.error || !controller.management.data) {
    return (
      <EmptyState
        icon={<WarningCircleIcon size={22} aria-hidden="true" />}
        title="Instance management is unavailable."
      >
        Only the instance administrator can open this area. Check the API connection, then try
        again.
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void controller.management.refetch()}
        >
          Try again
        </button>
      </EmptyState>
    );
  }

  switch (activePage) {
    case 'overview':
      return (
        <OverviewPage
          management={controller.management.data}
          system={controller.liveStatus.data?.system ?? controller.management.data.system}
          readiness={controller.readiness}
          onPageChange={onPageChange}
        />
      );
    case 'projects':
      return (
        <ListRegion
          list={controller.list as ManagementListQuery}
          emptyTitle="No projects found"
          emptyText="There are no projects matching this search."
        >
          <ProjectRows items={controller.listItems as InstanceProject[]} />
        </ListRegion>
      );
    case 'users':
      return <UsersPage controller={controller} />;
    case 'storage':
      return (
        <ListRegion
          list={controller.list as ManagementListQuery}
          emptyTitle="No storage objects found"
          emptyText="No active or retained objects match this search."
        >
          <StorageRows items={controller.listItems as StorageItem[]} />
        </ListRegion>
      );
    case 'audit':
      return (
        <ListRegion
          list={controller.list as ManagementListQuery}
          emptyTitle="No activity found"
          emptyText="No audit events match this search."
          automaticPagination
        >
          <ActivityRows
            items={controller.listItems as ActivityEntry[]}
            hasMore={Boolean(controller.list.hasNextPage)}
            loadingMore={controller.list.isFetchingNextPage}
            onLoadMore={() => void controller.list.fetchNextPage()}
          />
        </ListRegion>
      );
    case 'jobs':
      return <JobsPage controller={controller} />;
    case 'invitations':
      return <InvitationsPage controller={controller} />;
  }
}

export function AdminDialogs({ controller }: { controller: AdminController }) {
  return (
    <>
      {controller.resetUser && (
        <PasswordResetDialog
          user={controller.resetUser}
          password={controller.resetPassword}
          confirmation={controller.resetConfirmation}
          pending={controller.resetMutation.isPending}
          errorMessage={
            controller.resetMutation.error
              ? errorText(controller.resetMutation.error, 'The password could not be reset.')
              : undefined
          }
          onPasswordChange={controller.setResetPassword}
          onConfirmationChange={controller.setResetConfirmation}
          onCancel={() => controller.setResetUser(null)}
          onSubmit={controller.submitReset}
        />
      )}
      {controller.revokeInvitation && (
        <ConfirmationDialog
          title="Revoke invitation link?"
          description={
            controller.revokeInvitation.isReusable ? (
              <>This reusable invitation link will stop working immediately.</>
            ) : (
              <>
                The magic link for <strong>{controller.revokeInvitation.email}</strong> will stop
                working immediately.
              </>
            )
          }
          confirmLabel="Revoke link"
          busy={controller.revokeMutation.isPending}
          error={
            controller.revokeMutation.error
              ? errorText(controller.revokeMutation.error, 'The invitation could not be revoked.')
              : undefined
          }
          onCancel={() => {
            controller.revokeMutation.reset();
            controller.setRevokeInvitation(null);
          }}
          onConfirm={() => controller.revokeMutation.mutate(controller.revokeInvitation!.id)}
        />
      )}
      {controller.disableUser && (
        <ConfirmationDialog
          title="Disable this account?"
          description={
            <>
              <strong>{controller.disableUser.displayName}</strong> will be unable to sign in, and
              all of their current sessions will be revoked. Their project memberships and data are
              preserved.
            </>
          }
          confirmLabel="Disable account"
          busyLabel="Disabling…"
          busy={controller.userStatusMutation.isPending}
          error={
            controller.userStatusMutation.error
              ? errorText(controller.userStatusMutation.error, 'The account could not be disabled.')
              : undefined
          }
          onCancel={() => {
            controller.userStatusMutation.reset();
            controller.setUserStatusFeedback(null);
            controller.setDisableUser(null);
          }}
          onConfirm={() =>
            controller.userStatusMutation.mutate({
              userId: controller.disableUser!.id,
              status: 'DISABLED',
            })
          }
        />
      )}
    </>
  );
}
