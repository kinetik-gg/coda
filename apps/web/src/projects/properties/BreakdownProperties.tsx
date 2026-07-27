import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { UserInitials } from '../../components/UserInitials';
import {
  Chip,
  PropertiesEmpty,
  PropertiesField,
  PropertiesFields,
  PropertiesIdentity,
  PropertiesListRow,
  PropertiesNote,
  PropertiesPane,
  PropertiesQuickActions,
  PropertiesSection,
  TimeCell,
  type ContextMenuItem,
} from '../../content-lists';
import type { ManagedProject } from '../../project-management/types';
import type { Project, SessionUser } from '../types';
import { resolveBreakdownMembers, resolveBreakdownOwnerLabel } from './breakdown-properties-access';
import { buildBreakdownPropertiesModel } from './breakdown-properties-model';

const DETAIL_STALE_MS = 30_000;
/**
 * How long a selection must hold before the pane reads the breakdown behind it. The same discipline
 * #164 established for screenplays: an arrow-key traversal of a list is a traversal, not a series
 * of requests, so it collapses into one read.
 */
export interface BreakdownPropertiesProps {
  /** The selected row. The pane does not render without one (#193). */
  breakdown?: Project;
  /** The debounced selection id, resolved by the split — see `ScreenplayPropertiesProps`. */
  breakdownId?: string;
  /** The row's actions, passed verbatim from the list's `buildMenu`. */
  actions: readonly ContextMenuItem[];
  width: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * The breakdowns list properties: what the selected breakdown is, the shape of the hierarchy it
 * captures, who can reach it, and the same actions its row menu offers.
 *
 * The breakdown half of #164's properties, built on the same `content-lists` primitives rather than
 * a second implementation: `PropertiesPane` for chrome, `useSettledValue` for the read discipline,
 * and `PropertiesQuickActions` fed the row menu verbatim so the pane cannot answer a question
 * differently from the row. The read is keyed `['project-management', id]`, the key the settings
 * surface and the share modal already invalidate, so the pane never becomes a second cache.
 */
export function BreakdownProperties({
  breakdown,
  actions,
  width,
  collapsed,
  onToggleCollapsed,
  breakdownId,
}: BreakdownPropertiesProps) {
  // Everything the row already carries renders off the live selection; only the read waits for it
  // to settle, so the pane follows the keyboard without issuing a request per row traversed.
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
      managementForSelection ? buildBreakdownPropertiesModel(managementForSelection) : undefined,
    [managementForSelection],
  );
  const members = useMemo(
    () => resolveBreakdownMembers(managementForSelection),
    [managementForSelection],
  );

  const pane = (body: ReactNode, busy?: boolean) => (
    <PropertiesPane
      width={width}
      collapsed={collapsed}
      busy={busy}
      onToggleCollapsed={onToggleCollapsed}
    >
      {body}
    </PropertiesPane>
  );

  if (!breakdown) {
    return pane(
      <PropertiesEmpty message="Select a breakdown to inspect its hierarchy, contents, and collaborators." />,
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
      <PropertiesIdentity name={breakdown.name} meta={breakdown.description} />
      <PropertiesSection label="Metadata">
        <PropertiesFields>
          <PropertiesField label="Role">
            <Chip>{breakdown.currentMembership?.role.name ?? 'owner'}</Chip>
          </PropertiesField>
          <PropertiesField label="Levels" numeric>
            {model ? model.levels.length : '—'}
          </PropertiesField>
          <PropertiesField label="Items" numeric>
            {model?.itemCount ?? '—'}
          </PropertiesField>
          <PropertiesField label="Sources" numeric>
            {model?.sourceDocumentCount ?? '—'}
          </PropertiesField>
          <PropertiesField label="Roles" numeric>
            {model ? model.roleCount : '—'}
          </PropertiesField>
          <PropertiesField label="Owner">{ownerLabel}</PropertiesField>
          <PropertiesField label="Updated">
            <TimeCell iso={breakdown.updatedAt} />
          </PropertiesField>
        </PropertiesFields>
        {restricted && (
          <PropertiesNote>
            Contents are visible to members who can manage this breakdown.
          </PropertiesNote>
        )}
      </PropertiesSection>
      <HierarchySection loading={loading} restricted={restricted} model={model} />
      <MembersSection loading={loading} restricted={restricted} members={members} />
      <PropertiesSection label="Quick actions">
        <PropertiesQuickActions items={actions} />
      </PropertiesSection>
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
  model?: ReturnType<typeof buildBreakdownPropertiesModel>;
}) {
  if (restricted) {
    return (
      <PropertiesSection label="Hierarchy">
        <PropertiesNote>The hierarchy needs breakdown management access.</PropertiesNote>
      </PropertiesSection>
    );
  }
  if (!model) {
    return (
      <PropertiesSection label="Hierarchy">
        <PropertiesNote>
          {loading ? 'Reading the breakdown…' : 'No hierarchy to show.'}
        </PropertiesNote>
      </PropertiesSection>
    );
  }
  return (
    <PropertiesSection label="Hierarchy" count={model.levels.length}>
      {model.levels.map((entry) => (
        <PropertiesListRow
          key={entry.id}
          leading={String(entry.level)}
          primary={entry.name}
          secondary={entry.itemCount === undefined ? undefined : <Chip>{entry.itemCount}</Chip>}
        />
      ))}
      {model.levels.length === 0 && (
        <PropertiesNote>This breakdown defines no levels yet.</PropertiesNote>
      )}
    </PropertiesSection>
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
      <PropertiesSection label="Members">
        <PropertiesNote>
          Collaborators are visible to members who can manage sharing.
        </PropertiesNote>
      </PropertiesSection>
    );
  }
  if (loading) {
    return (
      <PropertiesSection label="Members">
        <PropertiesNote>Reading collaborators…</PropertiesNote>
      </PropertiesSection>
    );
  }
  return (
    <PropertiesSection label="Members" count={members.length}>
      {members.map((member) => (
        <PropertiesListRow
          key={member.id}
          leading={<UserInitials name={member.name} />}
          primary={member.name}
          secondary={<Chip>{member.role}</Chip>}
        />
      ))}
      {members.length === 0 && <PropertiesNote>No collaborators yet.</PropertiesNote>}
    </PropertiesSection>
  );
}
