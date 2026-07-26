import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { UserInitials } from '../../components/UserInitials';
import {
  Chip,
  InspectorEmpty,
  InspectorField,
  InspectorFields,
  InspectorIdentity,
  InspectorListRow,
  InspectorNote,
  InspectorPane,
  InspectorQuickActions,
  InspectorSection,
  TimeCell,
  useSettledValue,
  type ContextMenuItem,
} from '../../content-lists';
import type { ManagedProject } from '../../project-management/types';
import type { Project, SessionUser } from '../types';
import { resolveBreakdownMembers, resolveBreakdownOwnerLabel } from './breakdown-inspector-access';
import { buildBreakdownInspectorModel } from './breakdown-inspector-model';

const DETAIL_STALE_MS = 30_000;
/**
 * How long a selection must hold before the pane reads the breakdown behind it. The same discipline
 * #164 established for screenplays: an arrow-key traversal of a list is a traversal, not a series
 * of requests, so it collapses into one read.
 */
const SELECTION_SETTLE_MS = 200;

export interface BreakdownInspectorProps {
  /** The selected row, or `undefined` for the empty state. */
  breakdown?: Project;
  /** The row's actions, passed verbatim from the list's `buildMenu`. */
  actions: readonly ContextMenuItem[];
  width: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * The breakdowns list inspector: what the selected breakdown is, the shape of the hierarchy it
 * captures, who can reach it, and the same actions its row menu offers.
 *
 * The breakdown half of #164's inspector, built on the same `content-lists` primitives rather than
 * a second implementation: `InspectorPane` for chrome, `useSettledValue` for the read discipline,
 * and `InspectorQuickActions` fed the row menu verbatim so the pane cannot answer a question
 * differently from the row. The read is keyed `['project-management', id]`, the key the settings
 * surface and the share modal already invalidate, so the pane never becomes a second cache.
 */
export function BreakdownInspector({
  breakdown,
  actions,
  width,
  collapsed,
  onToggleCollapsed,
}: BreakdownInspectorProps) {
  // Everything the row already carries renders off the live selection; only the read waits for it
  // to settle, so the pane follows the keyboard without issuing a request per row traversed.
  const breakdownId = useSettledValue(breakdown?.id, SELECTION_SETTLE_MS);
  // Management is permission gated; a member without it gets a 403 that must not retry-storm.
  const management = useQuery({
    queryKey: ['project-management', breakdownId],
    queryFn: () => api<ManagedProject>(`/api/v1/projects/${breakdownId!}/management`),
    enabled: breakdownId !== undefined,
    retry: false,
    staleTime: DETAIL_STALE_MS,
  });
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<SessionUser>('/api/v1/auth/session'),
    staleTime: DETAIL_STALE_MS,
  });

  /*
   * A settled read always lags the live selection by at most one settle window, and a cached read
   * for the previous row resolves instantly. Both would paint the wrong breakdown's figures under
   * the right breakdown's name, so the read is matched to the selection it belongs to before it is
   * used. Stale-but-wrong is worse than not-yet-loaded.
   */
  const managementForSelection =
    management.data?.id === breakdown?.id ? management.data : undefined;
  const settledOnSelection = breakdownId === breakdown?.id;

  const model = useMemo(
    () =>
      managementForSelection ? buildBreakdownInspectorModel(managementForSelection) : undefined,
    [managementForSelection],
  );
  const members = useMemo(
    () => resolveBreakdownMembers(managementForSelection),
    [managementForSelection],
  );

  const pane = (body: ReactNode, busy?: boolean) => (
    <InspectorPane
      width={width}
      collapsed={collapsed}
      busy={busy}
      onToggleCollapsed={onToggleCollapsed}
    >
      {body}
    </InspectorPane>
  );

  if (!breakdown) {
    return pane(
      <InspectorEmpty message="Select a breakdown to inspect its hierarchy, contents, and collaborators." />,
    );
  }

  const ownerLabel = resolveBreakdownOwnerLabel({
    ownerUserId: breakdown.ownerUserId,
    sessionUserId: session.data?.id,
    management: managementForSelection,
  });
  const restricted = settledOnSelection && Boolean(management.error);
  const loading = !settledOnSelection || management.isPending;

  return pane(
    <>
      <InspectorIdentity name={breakdown.name} meta={breakdown.description} />
      <InspectorSection label="Metadata">
        <InspectorFields>
          <InspectorField label="Role">
            <Chip>{breakdown.currentMembership?.role.name ?? 'owner'}</Chip>
          </InspectorField>
          <InspectorField label="Levels" numeric>
            {model ? model.levels.length : '—'}
          </InspectorField>
          <InspectorField label="Items" numeric>
            {model?.itemCount ?? '—'}
          </InspectorField>
          <InspectorField label="Sources" numeric>
            {model?.sourceDocumentCount ?? '—'}
          </InspectorField>
          <InspectorField label="Roles" numeric>
            {model ? model.roleCount : '—'}
          </InspectorField>
          <InspectorField label="Owner">{ownerLabel}</InspectorField>
          <InspectorField label="Updated">
            <TimeCell iso={breakdown.updatedAt} />
          </InspectorField>
        </InspectorFields>
        {restricted && (
          <InspectorNote>
            Contents are visible to members who can manage this breakdown.
          </InspectorNote>
        )}
      </InspectorSection>
      <HierarchySection loading={loading} restricted={restricted} model={model} />
      <MembersSection loading={loading} restricted={restricted} members={members} />
      <InspectorSection label="Quick actions">
        <InspectorQuickActions items={actions} />
      </InspectorSection>
    </>,
    // A background revalidation reports busy without tearing the resolved pane down; only a first
    // read with nothing to show falls back to a load state.
    management.isFetching || !settledOnSelection,
  );
}

function HierarchySection({
  loading,
  restricted,
  model,
}: {
  loading: boolean;
  restricted: boolean;
  model?: ReturnType<typeof buildBreakdownInspectorModel>;
}) {
  if (restricted) {
    return (
      <InspectorSection label="Hierarchy">
        <InspectorNote>The hierarchy needs breakdown management access.</InspectorNote>
      </InspectorSection>
    );
  }
  if (!model) {
    return (
      <InspectorSection label="Hierarchy">
        <InspectorNote>
          {loading ? 'Reading the breakdown…' : 'No hierarchy to show.'}
        </InspectorNote>
      </InspectorSection>
    );
  }
  return (
    <InspectorSection label="Hierarchy" count={model.levels.length}>
      {model.levels.map((entry) => (
        <InspectorListRow
          key={entry.id}
          leading={String(entry.level)}
          primary={entry.name}
          secondary={entry.itemCount === undefined ? undefined : <Chip>{entry.itemCount}</Chip>}
        />
      ))}
      {model.levels.length === 0 && (
        <InspectorNote>This breakdown defines no levels yet.</InspectorNote>
      )}
    </InspectorSection>
  );
}

function MembersSection({
  loading,
  restricted,
  members,
}: {
  loading: boolean;
  restricted: boolean;
  members: ReturnType<typeof resolveBreakdownMembers>;
}) {
  if (restricted) {
    return (
      <InspectorSection label="Members">
        <InspectorNote>Collaborators are visible to members who can manage sharing.</InspectorNote>
      </InspectorSection>
    );
  }
  if (loading) {
    return (
      <InspectorSection label="Members">
        <InspectorNote>Reading collaborators…</InspectorNote>
      </InspectorSection>
    );
  }
  return (
    <InspectorSection label="Members" count={members.length}>
      {members.map((member) => (
        <InspectorListRow
          key={member.id}
          leading={<UserInitials name={member.name} />}
          primary={member.name}
          secondary={<Chip>{member.role}</Chip>}
        />
      ))}
      {members.length === 0 && <InspectorNote>No collaborators yet.</InspectorNote>}
    </InspectorSection>
  );
}
