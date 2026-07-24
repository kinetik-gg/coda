// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminSidebar, ListRegion, SearchField } from './AdminCommon';
import {
  ActivityRows,
  InvitationRows,
  JobRows,
  ProjectRows,
  StorageRows,
  UserRows,
} from './AdminRows';
import { InvitationPage } from './InvitationPage';
import { OverviewPage } from './OverviewPage';
import { PasswordResetDialog } from './PasswordResetDialog';

afterEach(cleanup);

const user = {
  id: 'user',
  displayName: 'Member',
  email: 'member@example.com',
  company: 'Studio',
  department: 'Production',
  status: 'ACTIVE',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  _count: { memberships: 2, sessions: 1, ownedProjects: 0 },
};

const project = {
  id: 'project',
  name: 'Feature Film',
  description: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  deletedAt: null,
  owner: { id: 'owner', displayName: 'Owner', email: 'owner@example.com' },
  _count: { memberships: 2, items: 10, storageObjects: 1, sourceDocuments: 1 },
};

const invitation = {
  id: 'invitation',
  email: 'member@example.com',
  isReusable: false,
  redemptionCount: 0,
  status: 'PENDING',
  expiresAt: null,
  acceptedAt: null,
  revokedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  inviter: { id: 'owner', displayName: 'Owner' },
  acceptedBy: null,
  project: { id: 'project', name: 'Feature Film' },
  role: { id: 'role', name: 'Editor' },
};

describe('admin row behavior', () => {
  it('renders all management record kinds and delegates user and invitation actions', () => {
    const reset = vi.fn();
    const resetTwoFactor = vi.fn();
    const status = vi.fn();
    const revoke = vi.fn();
    render(
      <>
        <ProjectRows items={[project]} />
        <UserRows
          items={[
            user,
            {
              ...user,
              id: 'owner',
              displayName: 'Owner',
              company: null,
              department: null,
              status: 'DISABLED',
            },
          ]}
          ownerId="owner"
          onReset={reset}
          onResetTwoFactor={resetTwoFactor}
          onStatus={status}
          statusBusyUserId="owner"
        />
        <StorageRows
          items={[
            {
              id: 'storage',
              kind: 'SOURCE_DOCUMENT',
              status: 'READY',
              originalFilename: 'script.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 2048,
              width: 1920,
              height: 1080,
              durationMs: 2500,
              createdAt: '2026-07-01T00:00:00.000Z',
              deletedAt: null,
              project: { id: 'project', name: 'Feature Film', deletedAt: null },
            },
          ]}
        />
        <JobRows
          items={[
            {
              id: 'job',
              name: 'Retention',
              state: 'degraded',
              intervalSeconds: 60,
              lastStartedAt: null,
              lastCompletedAt: null,
              lastSucceededAt: null,
              lastFailureAt: null,
              lastFailureMessage: 'Temporary failure',
              lastPurgedProjects: 2,
              nextRunAt: null,
            },
          ]}
        />
        <InvitationRows
          items={[
            invitation,
            {
              ...invitation,
              id: 'bulk',
              email: null,
              isReusable: true,
              redemptionCount: 3,
              status: 'REVOKED',
              revokedAt: '2026-07-02T00:00:00.000Z',
              acceptedBy: { id: 'member', displayName: 'Member' },
            },
          ]}
          onRevoke={revoke}
        />
      </>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset password' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(reset).toHaveBeenCalledWith(user);
    expect(status).toHaveBeenCalledWith(user);
    expect(revoke).toHaveBeenCalledWith(invitation);
    expect(screen.getByText(/1920 × 1080/)).toHaveTextContent('3 sec');
  });

  it('virtualizes audit rows and requests another cursor page near the end', () => {
    const loadMore = vi.fn();
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: `activity-${index}`,
      action: 'ITEM_UPDATED',
      resourceType: 'BREAKDOWN_ITEM',
      resourceId: `resource-${index}`,
      metadata: index ? {} : { title: 'Scene 1' },
      createdAt: '2026-07-01T00:00:00.000Z',
      project: { id: 'project', name: 'Film', deletedAt: null },
      actor: index ? null : { id: 'user', displayName: 'Member' },
    }));
    render(<ActivityRows items={items} hasMore loadingMore={false} onLoadMore={loadMore} />);
    const list = screen.getByRole('list', { name: 'Instance activity log' });
    expect(screen.getByText(/title: Scene 1/)).toBeInTheDocument();
    Object.defineProperties(list, {
      scrollTop: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 480 },
      scrollHeight: { configurable: true, value: 1400 },
    });
    fireEvent.scroll(list);
    expect(loadMore).toHaveBeenCalled();
  });
});

describe('admin views and controls', () => {
  it('renders system health details and routes overview actions', () => {
    const onPageChange = vi.fn();
    const system = {
      history: [
        {
          sampledAt: 'x',
          cpuPercent: 10,
          memoryPercent: 20,
          processRssBytes: 1,
          processHeapUsedBytes: 1,
        },
        {
          sampledAt: 'y',
          cpuPercent: 30,
          memoryPercent: 40,
          processRssBytes: 1,
          processHeapUsedBytes: 1,
        },
      ],
      runtime: {
        state: 'running',
        nodeVersion: 'v22',
        processUptimeSeconds: 100,
        eventLoopUtilizationPercent: 2,
        memory: { rssBytes: 1000, heapUsedBytes: 500, heapTotalBytes: 800, externalBytes: 1 },
      },
      operatingSystem: {
        platform: 'win32',
        release: '11',
        architecture: 'x64',
        uptimeSeconds: 200,
      },
      cpu: {
        usagePercent: 30,
        logicalCores: 8,
        model: 'CPU',
        loadAverage: { oneMinute: 1, fiveMinutes: 2, fifteenMinutes: 3 },
      },
      memory: { totalBytes: 1000, usedBytes: 600, freeBytes: 400, usagePercent: 60 },
      disk: { available: true, totalBytes: 1000, usedBytes: 500, freeBytes: 500, usagePercent: 50 },
    };
    const management = {
      initializedAt: '2026-01-01T00:00:00.000Z',
      retentionDays: 30,
      owner: { id: 'owner', displayName: 'Owner', email: 'owner@example.com' },
      counts: {
        users: 2,
        activeUsers: 2,
        disabledUsers: 0,
        activeProjects: 1,
        trashedProjects: 0,
        activeSessions: 1,
        storageObjects: 1,
        storageBytes: 1000,
        trashedStorageObjects: 0,
        trashedStorageBytes: 0,
        pendingInvitations: 1,
        jobs: 1,
      },
      system,
      jobs: [],
      users: [],
      projects: [project],
      storageItems: [],
      activities: [],
    };
    render(
      <OverviewPage
        management={management as never}
        system={system as never}
        readiness={{ isError: false, isFetching: false }}
        onPageChange={onPageChange}
      />,
    );
    expect(screen.getByRole('img', { name: 'CPU usage history' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View all' }));
    expect(onPageChange).toHaveBeenCalledWith('projects');
  });

  it('covers sidebar, search, pagination, invitation, and reset-dialog interactions', () => {
    const pageChange = vi.fn();
    const search = vi.fn();
    const loadMore = vi.fn();
    const submit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const revoke = vi.fn();
    const { rerender } = render(
      <>
        <AdminSidebar activePage="overview" onPageChange={pageChange} />
        <SearchField value="" onChange={search} label="Search records" />
        <ListRegion
          list={
            {
              isLoading: false,
              error: null,
              isFetchingNextPage: false,
              hasNextPage: true,
              fetchNextPage: loadMore,
              data: { pages: [{ items: [project], nextCursor: 'next' }], pageParams: [''] },
            } as never
          }
          emptyTitle="Empty"
          emptyText="Nothing here"
        >
          <span>Row</span>
        </ListRegion>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'member' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(pageChange).toHaveBeenCalledWith('users');
    expect(search).toHaveBeenCalledWith('member');
    expect(loadMore).toHaveBeenCalled();

    rerender(
      <InvitationPage
        list={
          {
            isLoading: false,
            error: null,
            isFetchingNextPage: false,
            hasNextPage: false,
            fetchNextPage: vi.fn(),
            data: { pages: [{ items: [invitation], nextCursor: null }], pageParams: [''] },
          } as never
        }
        items={[invitation]}
        optionsLoading={false}
        inviteEmail="member@example.com"
        inviteKind="email"
        inviteExpiry="never"
        inviteMembership="none"
        inviteProjectId=""
        inviteRoleId=""
        createdInvitation={{
          email: 'member@example.com',
          isReusable: false,
          url: 'https://coda.test/invite',
          expiresAt: null,
        }}
        copyState="idle"
        pending={false}
        onSubmit={submit}
        onEmailChange={vi.fn()}
        onKindChange={vi.fn()}
        onExpiryChange={vi.fn()}
        onMembershipChange={vi.fn()}
        onProjectChange={vi.fn()}
        onRoleChange={vi.fn()}
        onCopy={vi.fn().mockResolvedValue(undefined)}
        onRevoke={revoke}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(revoke).toHaveBeenCalledWith(invitation);

    rerender(
      <PasswordResetDialog
        user={user}
        password="password-one"
        confirmation="different"
        pending={false}
        errorMessage="Reset unavailable"
        onPasswordChange={vi.fn()}
        onConfirmationChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={submit}
      />,
    );
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Reset unavailable');
  });
});
