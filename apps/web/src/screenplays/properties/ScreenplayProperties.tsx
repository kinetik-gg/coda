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
  useSettledValue,
  type ContextMenuItem,
} from '../../content-lists';
import type { SessionUser } from '../../projects/types';
import type { ManagedScreenplay } from '../management/types';
import type { Screenplay, ScreenplaySummary } from '../types';
import {
  resolvePropertiesMembers,
  resolveScreenplayOwnerLabel,
} from './screenplay-properties-access';
import { buildScreenplayPropertiesModel } from './screenplay-properties-model';

const DETAIL_STALE_MS = 30_000;
/**
 * How long a selection must hold before the pane reads the document behind it.
 * Long enough that an arrow-key traversal of a list collapses into one read
 * (`/api/v1/screenplays` is rate limited per client), short enough that a
 * deliberate selection resolves without feeling deferred.
 */
const SELECTION_SETTLE_MS = 200;

export interface ScreenplayPropertiesProps {
  /** The selected row, or `undefined` for the empty state. */
  screenplay?: ScreenplaySummary;
  /**
   * The row's actions, passed verbatim from the list's `buildMenu`. The pane and
   * the row context menu must stay one vocabulary; see `PropertiesQuickActions`.
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
 * The screenplays list properties: what the selected screenplay is, how it has
 * been revised, who can reach it, and the same actions its row menu offers.
 *
 * Every read is keyed the way the rest of the app keys it (`['screenplay', id]`,
 * `['screenplay-management', id]`), so a rename or a membership change already
 * invalidates the pane — the properties never becomes a second cache to keep in
 * step. Page and scene counts come from the real layout engine rather than an
 * estimate, so they agree with the preview and the exported PDF.
 */
export function ScreenplayProperties({
  screenplay,
  actions,
  width,
  collapsed,
  onToggleCollapsed,
  presence,
}: ScreenplayPropertiesProps) {
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
    () => (detailForSelection ? buildScreenplayPropertiesModel(detailForSelection) : undefined),
    [detailForSelection],
  );
  const members = useMemo(
    () => resolvePropertiesMembers(managementForSelection),
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

  if (!screenplay) {
    return pane(
      <PropertiesEmpty message="Select a screenplay to inspect its format, revisions, and collaborators." />,
    );
  }

  const ownerLabel = resolveScreenplayOwnerLabel({
    ownerUserId: screenplay.ownerUserId,
    sessionUserId: session.data?.id,
    management: managementForSelection,
  });

  return pane(
    <>
      <PropertiesIdentity name={screenplay.title} meta={screenplay.filename} />
      {presence}
      <PropertiesSection label="Metadata">
        <PropertiesFields>
          <PropertiesField label="Format">
            <Chip title={`Page size ${screenplay.paperSize}`}>{screenplay.paperSize}</Chip>
          </PropertiesField>
          <PropertiesField label="Pages" numeric>
            {model?.metrics ? model.metrics.pageCount : '—'}
          </PropertiesField>
          <PropertiesField label="Scenes" numeric>
            {model?.metrics ? model.metrics.sceneCount : '—'}
          </PropertiesField>
          <PropertiesField label="Revision" numeric>
            {screenplay.version}
          </PropertiesField>
          <PropertiesField label="Owner">{ownerLabel}</PropertiesField>
          <PropertiesField label="Updated">
            <TimeCell iso={screenplay.updatedAt} />
          </PropertiesField>
          <PropertiesField label="Created">
            <TimeCell iso={screenplay.createdAt} />
          </PropertiesField>
        </PropertiesFields>
        {settledOnSelection && detail.error && (
          <PropertiesNote
            alert
            action={{ label: 'Try again', onClick: () => void detail.refetch() }}
          >
            Document details could not be read.
          </PropertiesNote>
        )}
      </PropertiesSection>
      <RevisionsSection loading={!settledOnSelection || detail.isPending} model={model} />
      <MembersSection
        loading={!settledOnSelection || management.isPending}
        restricted={settledOnSelection && Boolean(management.error)}
        members={members}
      />
      <PropertiesSection label="Quick actions">
        <PropertiesQuickActions items={actions} />
      </PropertiesSection>
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
  model?: ReturnType<typeof buildScreenplayPropertiesModel>;
}) {
  if (!model) {
    return (
      <PropertiesSection label="Recent revisions">
        <PropertiesNote>
          {loading ? 'Reading the document…' : 'Revisions need the document to be readable.'}
        </PropertiesNote>
      </PropertiesSection>
    );
  }
  return (
    <PropertiesSection label="Recent revisions" count={model.revisions.length}>
      {model.revisions.map((entry) => (
        <PropertiesListRow
          key={entry.generation}
          leading={entry.marker}
          primary={`Generation ${entry.generation + 1}`}
          secondary={`+${entry.additions} −${entry.removals}`}
        />
      ))}
      {model.revisions.length === 0 && (
        <PropertiesNote>This draft carries no revision marks.</PropertiesNote>
      )}
      {model.revisionMode && (
        <PropertiesNote>Revision marking is on for this draft.</PropertiesNote>
      )}
      {!model.metrics && (
        <PropertiesNote>The document is too large to measure on this surface.</PropertiesNote>
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
  members: ReturnType<typeof resolvePropertiesMembers>;
}) {
  if (loading) {
    return (
      <PropertiesSection label="Members">
        <PropertiesNote>Reading collaborators…</PropertiesNote>
      </PropertiesSection>
    );
  }
  if (restricted) {
    return (
      <PropertiesSection label="Members">
        <PropertiesNote>
          Collaborators are visible to members who can manage sharing.
        </PropertiesNote>
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
