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
import type { SessionUser } from '../../projects/types';
import type { ManagedScreenplay } from '../management/types';
import type { Screenplay, ScreenplaySummary } from '../types';
import {
  resolveInspectorMembers,
  resolveScreenplayOwnerLabel,
} from './screenplay-inspector-access';
import { buildScreenplayInspectorModel } from './screenplay-inspector-model';

const DETAIL_STALE_MS = 30_000;
/**
 * How long a selection must hold before the pane reads the document behind it.
 * Long enough that an arrow-key traversal of a list collapses into one read
 * (`/api/v1/screenplays` is rate limited per client), short enough that a
 * deliberate selection resolves without feeling deferred.
 */
const SELECTION_SETTLE_MS = 200;

export interface ScreenplayInspectorProps {
  /** The selected row, or `undefined` for the empty state. */
  screenplay?: ScreenplaySummary;
  /**
   * The row's actions, passed verbatim from the list's `buildMenu`. The pane and
   * the row context menu must stay one vocabulary; see `InspectorQuickActions`.
   */
  actions: readonly ContextMenuItem[];
  width: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /**
   * Extension point for #155 collaborative presence.
   *
   * "Who is in this document right now" renders here, between the identity block
   * and the metadata section, so presence reads as a property of the selected
   * screenplay rather than a floating overlay. #155 owns the transport and the
   * avatar/roster rendering; this slot owns only the position, and nothing else
   * in the pane needs reshaping to accept it. The selected screenplay id is
   * available to the caller, so the presence subscription belongs in the caller
   * (or in a component it passes here) — the pane stays free of live transport.
   */
  presence?: ReactNode;
}

/**
 * The screenplays list inspector: what the selected screenplay is, how it has
 * been revised, who can reach it, and the same actions its row menu offers.
 *
 * Every read is keyed the way the rest of the app keys it (`['screenplay', id]`,
 * `['screenplay-management', id]`), so a rename or a membership change already
 * invalidates the pane — the inspector never becomes a second cache to keep in
 * step. Page and scene counts come from the real layout engine rather than an
 * estimate, so they agree with the preview and the exported PDF.
 */
export function ScreenplayInspector({
  screenplay,
  actions,
  width,
  collapsed,
  onToggleCollapsed,
  presence,
}: ScreenplayInspectorProps) {
  // Everything the row already carries renders off the live selection; only the
  // reads wait for it to settle, so the pane follows the keyboard immediately
  // without issuing a request per row traversed.
  const screenplayId = useSettledValue(screenplay?.id, SELECTION_SETTLE_MS);
  const detail = useQuery({
    queryKey: ['screenplay', screenplayId],
    queryFn: () => api<Screenplay>(`/api/v1/screenplays/${screenplayId!}`),
    enabled: screenplayId !== undefined,
    staleTime: DETAIL_STALE_MS,
  });
  // Management is gated on `manage_screenplay_settings`; a member without it gets
  // a 403 that must not retry-storm while the user roves rows.
  const management = useQuery({
    queryKey: ['screenplay-management', screenplayId],
    queryFn: () => api<ManagedScreenplay>(`/api/v1/screenplays/${screenplayId!}/management`),
    enabled: screenplayId !== undefined,
    retry: false,
    staleTime: DETAIL_STALE_MS,
  });
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<SessionUser>('/api/v1/auth/session'),
    staleTime: DETAIL_STALE_MS,
  });

  /*
   * A settled read always lags the live selection by at most one settle window,
   * and a cached read for the previous row resolves instantly. Both would paint
   * the wrong document's figures under the right document's title, so every read
   * is matched to the selection it belongs to before it is used. Stale-but-wrong
   * is worse than not-yet-loaded.
   */
  const detailForSelection = detail.data?.id === screenplay?.id ? detail.data : undefined;
  const managementForSelection =
    management.data?.id === screenplay?.id ? management.data : undefined;
  const settledOnSelection = screenplayId === screenplay?.id;

  const model = useMemo(
    () => (detailForSelection ? buildScreenplayInspectorModel(detailForSelection) : undefined),
    [detailForSelection],
  );
  const members = useMemo(
    () => resolveInspectorMembers(managementForSelection),
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

  if (!screenplay) {
    return pane(
      <InspectorEmpty message="Select a screenplay to inspect its format, revisions, and collaborators." />,
    );
  }

  const ownerLabel = resolveScreenplayOwnerLabel({
    ownerUserId: screenplay.ownerUserId,
    sessionUserId: session.data?.id,
    management: managementForSelection,
  });

  return pane(
    <>
      <InspectorIdentity name={screenplay.title} meta={screenplay.filename} />
      {presence}
      <InspectorSection label="Metadata">
        <InspectorFields>
          <InspectorField label="Format">
            <Chip title={`Page size ${screenplay.paperSize}`}>{screenplay.paperSize}</Chip>
          </InspectorField>
          <InspectorField label="Pages" numeric>
            {model?.metrics ? model.metrics.pageCount : '—'}
          </InspectorField>
          <InspectorField label="Scenes" numeric>
            {model?.metrics ? model.metrics.sceneCount : '—'}
          </InspectorField>
          <InspectorField label="Revision" numeric>
            {screenplay.version}
          </InspectorField>
          <InspectorField label="Owner">{ownerLabel}</InspectorField>
          <InspectorField label="Updated">
            <TimeCell iso={screenplay.updatedAt} />
          </InspectorField>
          <InspectorField label="Created">
            <TimeCell iso={screenplay.createdAt} />
          </InspectorField>
        </InspectorFields>
        {settledOnSelection && detail.error && (
          <InspectorNote
            alert
            action={{ label: 'Try again', onClick: () => void detail.refetch() }}
          >
            Document details could not be read.
          </InspectorNote>
        )}
      </InspectorSection>
      <RevisionsSection loading={!settledOnSelection || detail.isPending} model={model} />
      <MembersSection
        loading={!settledOnSelection || management.isPending}
        restricted={settledOnSelection && Boolean(management.error)}
        members={members}
      />
      <InspectorSection label="Quick actions">
        <InspectorQuickActions items={actions} />
      </InspectorSection>
    </>,
    // A background revalidation reports busy without tearing the resolved pane
    // down; only a first read with nothing to show falls back to a load state.
    detail.isFetching || !settledOnSelection,
  );
}

function RevisionsSection({
  loading,
  model,
}: {
  loading: boolean;
  model?: ReturnType<typeof buildScreenplayInspectorModel>;
}) {
  if (!model) {
    return (
      <InspectorSection label="Recent revisions">
        <InspectorNote>
          {loading ? 'Reading the document…' : 'Revisions need the document to be readable.'}
        </InspectorNote>
      </InspectorSection>
    );
  }
  return (
    <InspectorSection label="Recent revisions" count={model.revisions.length}>
      {model.revisions.map((entry) => (
        <InspectorListRow
          key={entry.generation}
          leading={entry.marker}
          primary={`Generation ${entry.generation + 1}`}
          secondary={`+${entry.additions} −${entry.removals}`}
        />
      ))}
      {model.revisions.length === 0 && (
        <InspectorNote>This draft carries no revision marks.</InspectorNote>
      )}
      {model.revisionMode && <InspectorNote>Revision marking is on for this draft.</InspectorNote>}
      {!model.metrics && (
        <InspectorNote>The document is too large to measure on this surface.</InspectorNote>
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
  members: ReturnType<typeof resolveInspectorMembers>;
}) {
  if (loading) {
    return (
      <InspectorSection label="Members">
        <InspectorNote>Reading collaborators…</InspectorNote>
      </InspectorSection>
    );
  }
  if (restricted) {
    return (
      <InspectorSection label="Members">
        <InspectorNote>Collaborators are visible to members who can manage sharing.</InspectorNote>
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
