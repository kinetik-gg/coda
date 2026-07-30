import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  ScreenplayRebaseCandidate,
  ScreenplayRebaseEntry,
  ScreenplayRebaseExcerpt,
  ScreenplayRebasePlan,
} from '@coda/contracts';
import { api } from '../../api';
import { ModalShell, modalButtonStyles } from '../../components/ModalShell';
import { Skeleton, SkeletonGroup } from '../../components/Skeleton';
import {
  REBASE_ATTENTION,
  REBASE_CLASSIFICATION_LABEL,
  REBASE_EXCLUSION_EXPLANATION,
  REBASE_REASON_EXPLANATION,
  rebaseSummarySentence,
} from './screenplay-rebase-language';
import styles from './Panels.styles';

/**
 * The rebase review surface (#242).
 *
 * **Opening, scrolling, deciding, and closing this dialog writes nothing.** It issues exactly one
 * `GET` for the plan and holds every decision in local component state; there is no mutation here,
 * and no request leaves this component other than the read. Applying the recorded decisions is a
 * separate, explicitly confirmed step (#243) on its own route.
 *
 * The plan already carries a `reason` for every verdict, so this component renders that reason
 * rather than inferring one, and it never re-derives `autoApplicable`: ranges the engine marked
 * auto-applicable are summarised in one line, and everything else is listed as its own decision —
 * including the cases that are easy to get wrong, where several candidate anchors are equally
 * plausible, where the text was deleted outright, and where a pin disagrees with its own revision.
 */

export function screenplayRebasePreviewQueryKey(projectId: string): [string, string] {
  return ['screenplay-rebase-preview', projectId];
}

/** What a reviewer has chosen for one entry. Held in memory only until #243 submits it. */
type Decision = { kind: 'keep' } | { kind: 'candidate'; index: number };

function Excerpt({ excerpt, label }: { excerpt: ScreenplayRebaseExcerpt; label: string }) {
  return (
    <div className={styles.rebaseExcerpt}>
      <span className={styles.rebaseExcerptLabel}>
        {label} · {excerpt.range.start}–{excerpt.range.end}
      </span>
      <pre>{excerpt.text}</pre>
      {excerpt.textTruncated && (
        <span className={styles.rebaseExcerptLabel}>Shortened for display.</span>
      )}
    </div>
  );
}

function candidateLabel(candidate: ScreenplayRebaseCandidate, isProposed: boolean): string {
  const move = candidate.shift === 0 ? 'same offset' : `moved ${String(candidate.shift)}`;
  const text = candidate.identicalText ? 'identical text' : 'different text';
  return `${isProposed ? 'Proposed · ' : ''}${text} · ${move}`;
}

function EntryDecision({
  entry,
  decision,
  onDecide,
}: {
  entry: ScreenplayRebaseEntry;
  decision: Decision | undefined;
  onDecide: (decision: Decision) => void;
}) {
  const attention = REBASE_ATTENTION[entry.classification];
  const name = `rebase-${entry.itemSourceReferenceId}`;
  return (
    <li className={styles.rebaseEntry}>
      <div className={styles.rebaseEntryHead}>
        <span className={`${styles.rebaseBadge} ${styles[`rebaseBadge_${attention}`] ?? ''}`}>
          {REBASE_CLASSIFICATION_LABEL[entry.classification]}
        </span>
        <span className={styles.rebaseEntryReason}>{REBASE_REASON_EXPLANATION[entry.reason]}</span>
      </div>
      {!entry.from.recordedTextHashMatches && (
        <p className={styles.rebaseWarning} role="alert">
          This pin&rsquo;s recorded text does not match the revision it names.
        </p>
      )}
      <Excerpt excerpt={entry.from.excerpt} label="Pinned text" />
      <fieldset className={styles.rebaseChoices}>
        <legend>What should happen to this reference?</legend>
        <label>
          <input
            type="radio"
            name={name}
            checked={decision?.kind === 'keep'}
            onChange={() => onDecide({ kind: 'keep' })}
          />
          <span>Keep the current pin</span>
        </label>
        {entry.candidates.map((candidate, index) => (
          <label key={`${String(candidate.range.start)}-${String(candidate.range.end)}`}>
            <input
              type="radio"
              name={name}
              checked={decision?.kind === 'candidate' && decision.index === index}
              onChange={() => onDecide({ kind: 'candidate', index })}
            />
            <span>
              {candidateLabel(candidate, candidate.range.start === entry.proposed?.range.start)}
              <Excerpt excerpt={candidate} label="New text" />
            </span>
          </label>
        ))}
        {!entry.candidates.length && (
          <p className={styles.empty}>
            The plan proposes no new anchor, so the pin can only be kept as it is.
          </p>
        )}
        {entry.candidatesTruncated && (
          <p className={styles.empty}>More matches exist than the plan could list.</p>
        )}
      </fieldset>
    </li>
  );
}

function PlanBody({
  plan,
  decisions,
  onDecide,
}: {
  plan: ScreenplayRebasePlan;
  decisions: Record<string, Decision>;
  onDecide: (referenceId: string, decision: Decision) => void;
}) {
  const pending = plan.entries.filter((entry) => entry.decisionRequired);
  return (
    <div className={styles.rebasePlan}>
      <p className={styles.rebaseSummary}>{rebaseSummarySentence(plan.summary)}</p>
      <p className={styles.rebaseSummaryDetail}>
        Screenplay version {plan.target.screenplayVersion}. Nothing is written until the rebase is
        applied.
      </p>
      {!pending.length && !!plan.entries.length && (
        <p className={styles.empty}>
          Every pinned range carries over on its own. Nothing to decide.
        </p>
      )}
      <ul className={styles.rebaseEntries}>
        {pending.map((entry) => (
          <EntryDecision
            key={entry.itemSourceReferenceId}
            entry={entry}
            decision={decisions[entry.itemSourceReferenceId]}
            onDecide={(decision) => onDecide(entry.itemSourceReferenceId, decision)}
          />
        ))}
      </ul>
      {!!plan.excluded.length && (
        <div className={styles.rebaseExcluded}>
          <h3>Cannot be rebased</h3>
          <ul>
            {plan.excluded.map((excluded) => (
              <li key={excluded.itemSourceReferenceId}>
                {REBASE_EXCLUSION_EXPLANATION[excluded.reason]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ScreenplayRebasePreviewDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const plan = useQuery({
    queryKey: screenplayRebasePreviewQueryKey(projectId),
    queryFn: ({ signal }) =>
      api<ScreenplayRebasePlan>(`/api/v1/projects/${projectId}/screenplay-rebase-preview`, {
        signal,
      }),
    // A preview is a read of live text: never served from a stale cache, never retried into a loop.
    staleTime: 0,
    retry: false,
  });

  const required = plan.data?.entries.filter((entry) => entry.decisionRequired).length ?? 0;
  const recorded = Object.keys(decisions).length;

  return (
    <ModalShell
      config={{
        size: 'large',
        regions: {
          header: { title: 'Review screenplay rebase' },
          body: {
            description: (
              <p>
                How every pinned range would re-anchor onto the current screenplay. Reviewing
                changes nothing — applying is a separate step.
              </p>
            ),
            content: (
              <>
                {plan.isLoading && (
                  <SkeletonGroup label="Loading rebase preview" className={styles.listSkeleton}>
                    {Array.from({ length: 4 }, (_unused, index) => (
                      <div key={index}>
                        <Skeleton width="42%" height={9} />
                        <Skeleton width="88%" height={10} />
                      </div>
                    ))}
                  </SkeletonGroup>
                )}
                {!plan.isLoading && plan.error && (
                  <div className={styles.panelQueryState} role="alert">
                    <span>The rebase preview could not be loaded.</span>
                    <button
                      type="button"
                      className={styles.queryStateAction}
                      onClick={() => void plan.refetch()}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {!plan.isLoading && !plan.error && plan.data && (
                  <PlanBody
                    plan={plan.data}
                    decisions={decisions}
                    onDecide={(referenceId, decision) =>
                      setDecisions((current) => ({ ...current, [referenceId]: decision }))
                    }
                  />
                )}
              </>
            ),
          },
          footer: (
            <>
              <span className={styles.rebaseFooterCount}>
                {recorded} of {required} decisions recorded
              </span>
              <button type="button" className={modalButtonStyles.secondary} onClick={onClose}>
                Close
              </button>
            </>
          ),
        },
        dismissal: { onDismiss: onClose, closeButton: true, escape: true, backdrop: true },
      }}
    />
  );
}
